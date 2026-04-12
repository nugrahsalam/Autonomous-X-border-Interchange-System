import { Mppx, Store, Request as MppxRequest, NodeListener } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * XLM SAC contract address on Stellar Testnet.
 * The Stellar Asset Contract (SAC) wraps native XLM as a Soroban token,
 * enabling MPP Charge payments using the @stellar/mpp SDK.
 */
export const XLM_SAC_TESTNET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Default AXIS service fee in XLM (overridable per-request via X-Axis-Fee header) */
export const AXIS_MPP_FEE_XLM = "0.0010000";

export interface MppRequest extends Request {
  feeHash: string;
  feePayerAddress: string;
  totalCharged: string;
}

let _mppxServer: ReturnType<typeof Mppx.create> | null = null;

function getMppxServer(axisAddress: string): ReturnType<typeof Mppx.create> {
  if (!_mppxServer) {
    const secretKey =
      process.env["MPP_SECRET_KEY"] ??
      Buffer.from(`axis-mpp-${axisAddress}`).toString("hex").slice(0, 64);

    _mppxServer = Mppx.create({
      secretKey,
      methods: [
        stellar.charge({
          recipient: axisAddress,
          currency: XLM_SAC_TESTNET,
          decimals: 7,
          network: "stellar:testnet",
          store: Store.memory(),
        }),
      ],
    });
    logger.info({ axisAddress }, "MPP server initialized with Soroban SAC charge method");
  }
  return _mppxServer;
}

/**
 * MPP (Machine Payments Protocol) fee middleware using @stellar/mpp.
 *
 * Issues HTTP 402 challenges via WWW-Authenticate: Payment header.
 * The Demo Agent responds with a Soroban SAC XLM transfer credential.
 * Supports dynamic per-request fee via X-Axis-Fee request header.
 *
 * Protocol: https://paymentauth.org/draft-stellar-charge-00
 */
export function mppFeeMiddleware(axisAddress: string) {
  return async function mppMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const mppx = getMppxServer(axisAddress);

    const fee = (req.headers["x-axis-fee"] as string | undefined) ?? AXIS_MPP_FEE_XLM;

    const webReq = MppxRequest.fromNodeListener(req, res);

    const result = await mppx.stellar.charge({ amount: fee })(webReq);

    if (result.status === 402) {
      await NodeListener.sendResponse(res, result.challenge);
      return;
    }

    const hash = extractHashFromAuthHeader(
      (req.headers["authorization"] as string | undefined) ?? "",
    );

    const bodyAddress = (req.body as Record<string, string> | undefined)?.agentAddress;
    const feePayerAddress =
      bodyAddress ??
      (req.headers["x-agent-address"] as string | undefined) ??
      (req.headers["x-demo-agent"] as string | undefined) ??
      "mpp-demo-agent";

    logger.info({ hash, fee, feePayerAddress }, "MPP Soroban SAC payment verified");
    (req as MppRequest).feeHash = hash;
    (req as MppRequest).feePayerAddress = feePayerAddress;
    (req as MppRequest).totalCharged = fee;

    next();
  };
}

function extractHashFromAuthHeader(authHeader: string): string {
  try {
    const token = authHeader.split(" ")[1];
    if (!token) return "mpp-verified";
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      payload?: { hash?: string; type?: string; transaction?: string };
      hash?: string;
    };
    return decoded?.payload?.hash ?? decoded?.hash ?? "mpp-verified";
  } catch {
    return "mpp-verified";
  }
}
