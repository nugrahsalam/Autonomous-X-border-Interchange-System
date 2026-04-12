import { Request, Response, NextFunction } from "express";
import { getAxisTreasuryKeypair, verifyPayment } from "../lib/stellar";
import { logger } from "../lib/logger";

export const AXIS_SERVICE_FEE_XLM = "0.001";

interface PendingSession {
  nonce: string;
  createdAt: number;
}

const pendingSessions = new Map<string, PendingSession>();
const usedNonces = new Set<string>();

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of pendingSessions.entries()) {
    if (now - session.createdAt > 5 * 60 * 1000) {
      pendingSessions.delete(key);
    }
  }
}

export function generateNonce(): string {
  return `axis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerNonce(nonce: string): void {
  pendingSessions.set(nonce, { nonce, createdAt: Date.now() });
}

function toBase64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fromBase64url(str: string): unknown {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}

export interface X402Request extends Request {
  feeHash: string;
  feePayerAddress: string;
}

/**
 * x402 fee middleware (https://x402.org)
 *
 * 402 response: sets X-Payment-Required header with base64url-encoded JSON containing
 * the payment requirement (scheme, amount, destination, nonce).
 *
 * Client retry: sends X-Payment header with base64url-encoded JSON containing
 * the transaction hash, sender address, and the nonce from the original challenge.
 */
export function x402FeeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  cleanExpiredSessions();

  const xPaymentHeader = req.headers["x-payment"] as string | undefined;

  if (!xPaymentHeader) {
    const nonce = generateNonce();
    const axisAddress = getAxisTreasuryKeypair().publicKey();
    const networkId = process.env["STELLAR_NETWORK"] === "mainnet" ? "mainnet" : "testnet";

    registerNonce(nonce);

    const paymentRequiredPayload = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          networkId,
          maxAmountRequired: AXIS_SERVICE_FEE_XLM,
          resource: `${req.method} ${req.path}`,
          description: "AXIS cross-border liquidity service fee",
          mimeType: "application/json",
          payTo: axisAddress,
          asset: "native",
          extra: {
            nonce,
            memo: nonce,
            instructions: `Send exactly ${AXIS_SERVICE_FEE_XLM} XLM to ${axisAddress} with memo text: ${nonce}`,
          },
        },
      ],
    };

    res.setHeader("X-Payment-Required", toBase64url(paymentRequiredPayload));

    res.status(402).json({
      x402Version: 1,
      error: "Payment Required",
      accepts: paymentRequiredPayload.accepts,
      payment: {
        destination: axisAddress,
        amount: AXIS_SERVICE_FEE_XLM,
        asset: "XLM",
        nonce,
        instructions: `Send ${AXIS_SERVICE_FEE_XLM} XLM to ${axisAddress} with memo: ${nonce}. Then retry with X-Payment: base64url({"x402Version":1,"scheme":"exact","networkId":"${networkId}","payload":{"transactionHash":"<txhash>","from":"<yourAddress>","nonce":"${nonce}"}}).`,
      },
    });
    return;
  }

  let paymentPayload: {
    x402Version?: number;
    scheme?: string;
    networkId?: string;
    payload?: {
      transactionHash?: string;
      from?: string;
      nonce?: string;
    };
  };

  try {
    paymentPayload = fromBase64url(xPaymentHeader) as typeof paymentPayload;
  } catch {
    res.status(402).json({
      error: "Invalid X-Payment header",
      detail: "X-Payment must be a base64url-encoded JSON payload.",
    });
    return;
  }

  const txHash = paymentPayload.payload?.transactionHash;
  const fromAddress = paymentPayload.payload?.from;
  const nonce = paymentPayload.payload?.nonce;

  if (!txHash || !fromAddress || !nonce) {
    res.status(402).json({
      error: "Invalid X-Payment payload",
      detail: "payload.transactionHash, payload.from, and payload.nonce are required.",
    });
    return;
  }

  if (!pendingSessions.has(nonce)) {
    req.log.warn({ nonce }, "Nonce not found — possibly invalid, expired, or already used");
    res.status(402).json({
      error: "Invalid or expired nonce",
      detail: "This nonce was not issued, has expired (5 min TTL), or was already consumed. Request a new 402 challenge.",
    });
    return;
  }

  if (usedNonces.has(nonce)) {
    req.log.warn({ nonce }, "Nonce replay attempt detected");
    res.status(402).json({
      error: "Nonce already consumed",
      detail: "Each nonce may only be used once. Request a new 402 challenge.",
    });
    return;
  }

  pendingSessions.delete(nonce);
  usedNonces.add(nonce);

  const axisAddress = getAxisTreasuryKeypair().publicKey();

  verifyPayment(txHash, axisAddress, AXIS_SERVICE_FEE_XLM, nonce)
    .then((result) => {
      if (!result.valid || !result.sourceAddress) {
        usedNonces.delete(nonce);
        pendingSessions.set(nonce, { nonce, createdAt: Date.now() });
        req.log.warn({ txHash, nonce }, "Payment verification failed");
        res.status(402).json({
          error: "Payment verification failed",
          detail: "Transaction not found, insufficient amount, or memo mismatch. Nonce restored — retry with a valid payment.",
        });
        return;
      }

      req.log.info({ txHash, nonce, feePayer: result.sourceAddress }, "x402 payment verified");
      (req as X402Request).feeHash = txHash;
      (req as X402Request).feePayerAddress = result.sourceAddress;
      next();
    })
    .catch((err: unknown) => {
      usedNonces.delete(nonce);
      pendingSessions.set(nonce, { nonce, createdAt: Date.now() });
      logger.error({ err }, "Error verifying payment — nonce restored");
      res.status(500).json({ error: "Internal error during payment verification" });
    });
}

/**
 * Build the X-Payment header value for a Stellar payment.
 * The nonce must match what was returned in the original X-Payment-Required challenge.
 */
export function buildX402PaymentHeader(txHash: string, fromAddress: string, nonce: string): string {
  const networkId = process.env["STELLAR_NETWORK"] === "mainnet" ? "mainnet" : "testnet";
  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      networkId,
      payload: {
        transactionHash: txHash,
        from: fromAddress,
        nonce,
      },
    }),
  ).toString("base64url");
}
