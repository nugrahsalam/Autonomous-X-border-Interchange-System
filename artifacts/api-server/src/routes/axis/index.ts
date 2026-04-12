import { Router, type IRouter } from "express";
import { Asset } from "@stellar/stellar-sdk";
import { Mppx } from "mppx/client";
import { stellar as stellarMppClient } from "@stellar/mpp/charge/client";
import {
  getAxisTreasuryKeypair,
  checkAgentTrustline,
  getDemoAgentKeypair,
  getWalletBalance,
  usdcAsset,
  initWallets,
  ensureTrustline,
  parseAsset,
  assetLabel,
  resolveAssetByCode,
} from "../../lib/stellar";
import { findBestPath, executePathPayment } from "../../lib/pathPayment";
import { scanLiquidityPools, describeBestPool } from "../../lib/liquidityPools";
import {
  mppFeeMiddleware,
  AXIS_MPP_FEE_XLM,
  XLM_SAC_TESTNET,
  type MppRequest,
} from "../../middlewares/mpp";
import {
  addTransaction,
  getRecentTransactions,
  getNodeStats,
} from "../../lib/transactionStore";
import { negotiateTrustline } from "../../lib/trustline";
import { consultBrain, consultDemoAgentBrain } from "../../lib/brain";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

function getApiBaseUrl(): string {
  const port = process.env["PORT"] ?? "8080";
  return `http://localhost:${port}/api`;
}

/**
 * Smart async asset resolver.
 * 1. Try parseAsset() — handles XLM, USDC, CODE:ISSUER immediately.
 * 2. If bare code (no issuer), query Stellar Horizon /assets to discover
 *    the most-adopted issuer on-network. Returns { asset, discovered } so
 *    the caller knows if a network lookup was needed.
 * 3. Returns null if the asset cannot be found anywhere.
 */
async function smartResolveAsset(
  assetStr?: string,
  fallback?: Asset,
): Promise<{ asset: Asset; discovered: boolean; issuer?: string } | null> {
  if (!assetStr) {
    const f = fallback ?? Asset.native();
    return { asset: f, discovered: false };
  }
  try {
    const asset = parseAsset(assetStr);
    return { asset, discovered: false };
  } catch {
    const found = await resolveAssetByCode(assetStr);
    if (!found) return null;
    const issuer = found.isNative() ? undefined : found.getIssuer();
    return { asset: found, discovered: true, issuer };
  }
}

router.get("/axis/status", async (_req, res): Promise<void> => {
  const stats = await getNodeStats();
  const axisAddress = getAxisTreasuryKeypair().publicKey();
  res.json({
    status: "online",
    network: "testnet",
    axisAddress,
    serviceFee: AXIS_MPP_FEE_XLM,
    paymentProtocol: "MPP Stellar Charge (draft-stellar-charge-00)",
    paymentMethod: "Soroban SAC XLM transfer",
    feeAsset: "XLM",
    supportedConversions: [
      { from: "XLM", to: "USDC" },
      { from: "XLM", to: "any" },
      { from: "any", to: "any" },
    ],
    ...stats,
  });
});

router.get("/axis/balance", async (req, res): Promise<void> => {
  await initWallets();
  const axisAddress = getAxisTreasuryKeypair().publicKey();
  const demoAddress = getDemoAgentKeypair().publicKey();

  const [axisBalance, demoBalance] = await Promise.all([
    getWalletBalance(axisAddress),
    getWalletBalance(demoAddress),
  ]);

  req.log.info({ axisAddress, demoAddress }, "Balance fetched");
  res.json({
    axis: {
      address: axisAddress,
      xlm: axisBalance.xlm,
      usdc: axisBalance.usdc,
      balances: axisBalance.balances,
    },
    demoAgent: {
      address: demoAddress,
      xlm: demoBalance.xlm,
      usdc: demoBalance.usdc,
      balances: demoBalance.balances,
    },
  });
});

router.get("/axis/transactions", async (req, res): Promise<void> => {
  const rawLimit = req.query["limit"];
  const limit = Math.min(Number(rawLimit ?? 20), 50);
  const txs = await getRecentTransactions(isNaN(limit) ? 20 : limit, true);
  res.json({ transactions: txs, count: txs.length });
});

/**
 * GET /axis/quote
 * Returns the source amount required for a swap without executing anything.
 * External agents should call this first to learn how much XLM they need to
 * send (sourceAmount + AXIS_MPP_FEE_XLM) before calling POST /axis/convert.
 *
 * Query params: srcAsset, destAsset, destAmount, agentAddress
 * Response: { sourceAmount, fee, totalRequired, route, validUntil }
 */
router.get("/axis/quote", async (req, res): Promise<void> => {
  const {
    srcAsset: srcAssetStr,
    destAsset: destAssetStr,
    destAmount = "1",
    agentAddress,
  } = req.query as Record<string, string | undefined>;

  if (!agentAddress) {
    res.status(400).json({
      success: false,
      error: "Missing required query param: agentAddress (your Stellar public key G...)",
    });
    return;
  }

  const [destResolved, srcResolved] = await Promise.all([
    smartResolveAsset(destAssetStr, usdcAsset),
    smartResolveAsset(srcAssetStr, Asset.native()),
  ]);

  if (!destResolved) {
    res.status(400).json({ success: false, error: `Unknown destAsset: "${destAssetStr}"` });
    return;
  }
  if (!srcResolved) {
    res.status(400).json({ success: false, error: `Unknown srcAsset: "${srcAssetStr}"` });
    return;
  }

  const destAsset = destResolved.asset;
  const srcAsset = srcResolved.asset;
  const destLabel = assetLabel(destAsset);
  const srcLabel = assetLabel(srcAsset);

  try {
    const { sourceAmount, pathLabels } = await findBestPath(
      destAmount,
      destAsset,
      srcAsset,
      agentAddress,
    );

    const fee = AXIS_MPP_FEE_XLM;
    const totalRequired = (parseFloat(sourceAmount) + parseFloat(fee)).toFixed(7);
    const route = [srcLabel, ...pathLabels, destLabel].join(" → ");
    const validUntil = new Date(Date.now() + 30_000).toISOString();

    req.log.info({ srcLabel, destLabel, destAmount, sourceAmount, totalRequired, agentAddress }, "Quote generated");

    res.json({
      success: true,
      quote: {
        srcAsset: srcLabel,
        destAsset: destLabel,
        destAmount,
        sourceAmount,
        fee,
        totalRequired,
        route,
        axisAddress: getAxisTreasuryKeypair().publicKey(),
        validUntil,
        instructions: [
          `Call POST /axis/convert with X-Axis-Fee: ${totalRequired}`,
          `Include agentAddress: "${agentAddress}" in request body`,
          "Pay via MPP Soroban SAC XLM transfer (mppx handles this automatically)",
        ],
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(400).json({
      success: false,
      error: `Could not find a path from ${srcLabel} to ${destLabel}: ${errMsg}`,
    });
  }
});

router.post(
  "/axis/convert",
  (req, res, next) => {
    const axisAddress = getAxisTreasuryKeypair().publicKey();
    return mppFeeMiddleware(axisAddress)(req, res, next);
  },
  async (req: MppRequest, res): Promise<void> => {
    await initWallets();
    const {
      destAmount = "1",
      destAsset: destAssetStr,
      srcAsset: srcAssetStr,
      agentAddress: agentAddressBody,
    } = req.body as {
      destAmount?: string;
      destAsset?: string;
      srcAsset?: string;
      agentAddress?: string;
    };

    const agentAddress = agentAddressBody ?? req.feePayerAddress;
    const feeHash = req.feeHash;
    const totalCharged = req.totalCharged;
    const axisKeypair = getAxisTreasuryKeypair();
    const axisAddress = axisKeypair.publicKey();

    if (!agentAddress || agentAddress === "mpp-demo-agent") {
      res.status(400).json({
        success: false,
        error: "Missing agentAddress: include it in the request body or X-Agent-Address header (your Stellar public key G...)",
      });
      return;
    }

    const [destResolved, srcResolved] = await Promise.all([
      smartResolveAsset(destAssetStr, usdcAsset),
      smartResolveAsset(srcAssetStr, Asset.native()),
    ]);

    if (!destResolved) {
      res.status(400).json({
        success: false,
        error: `Asset "${destAssetStr}" not found on Stellar Testnet. Use "XLM", "USDC", or "CODE:ISSUER".`,
      });
      return;
    }
    if (!srcResolved) {
      res.status(400).json({
        success: false,
        error: `Source asset "${srcAssetStr}" not found on Stellar Testnet. Use "XLM", "USDC", or "CODE:ISSUER".`,
      });
      return;
    }

    const destAsset = destResolved.asset;
    const srcAsset = srcResolved.asset;
    const destLabel = assetLabel(destAsset);
    const srcLabel = assetLabel(srcAsset);

    if (destResolved.discovered) {
      req.log.info({ destLabel, issuer: destResolved.issuer }, "Destination asset discovered via Horizon");
    }

    req.log.info(
      { destAmount, destAsset: destLabel, srcAsset: srcLabel, agentAddress, axisAddress, totalCharged },
      "Convert request received — agent funds collected via MPP",
    );

    // ── Trustline pre-check: agent must have a trustline for destAsset ────────
    // (AXIS cannot create a trustline on behalf of an external agent)
    if (!destAsset.isNative()) {
      const trustCheck = await checkAgentTrustline(agentAddress, destAsset);
      if (trustCheck.error) {
        res.status(400).json({
          success: false,
          error: trustCheck.error,
          detail: `Your agentAddress (${agentAddress}) does not exist on Stellar Testnet. Fund it via: https://friendbot.stellar.org/?addr=${agentAddress}`,
        });
        return;
      }
      if (!trustCheck.hasTrustline) {
        res.status(400).json({
          success: false,
          error: `Agent has no trustline for ${destLabel}`,
          detail: [
            `Your account (${agentAddress}) must have a trustline for ${destLabel} before AXIS can send it to you.`,
            `Add the trustline on Stellar Testnet using stellar-sdk:`,
            `  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: "Test SDF Network ; September 2015" })`,
            `    .addOperation(Operation.changeTrust({ asset: new Asset("${destAsset.getCode()}", "${destAsset.getIssuer()}") }))`,
            `    .setTimeout(30).build();`,
            `  tx.sign(agentKeypair); server.submitTransaction(tx);`,
            `Or use the Stellar Laboratory: https://laboratory.stellar.org/`,
          ].join("\n"),
        });
        return;
      }
    }

    await ensureTrustline(axisKeypair, destAsset);
    await ensureTrustline(axisKeypair, srcAsset);

    const { sourceAmount, path: pathStrings, pathLabels } = await findBestPath(
      destAmount,
      destAsset,
      srcAsset,
      agentAddress,
    );

    const agentSourceAmount = totalCharged
      ? (parseFloat(totalCharged) - parseFloat(AXIS_MPP_FEE_XLM)).toFixed(7)
      : (parseFloat(sourceAmount) * 1.02).toFixed(7);
    const sendMax = agentSourceAmount;

    const pathAssets = pathStrings.map((p) => {
      if (p === "native") return Asset.native();
      const [code, issuer] = p.split(":");
      return new Asset(code, issuer);
    });

    let result;
    try {
      result = await executePathPayment(
        axisKeypair,
        agentAddress,
        destAmount,
        destAsset,
        srcAsset,
        sendMax,
        pathAssets,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      req.log.error({ err, destAsset: destLabel, srcAsset: srcLabel }, "PathPayment failed");
      res.status(400).json({
        success: false,
        error: `PathPaymentStrictReceive failed: ${errMsg.replace(/<[^>]*>/g, "").slice(0, 300)}`,
        detail: "No DEX path found or insufficient liquidity for this asset pair on Stellar Testnet",
      });
      return;
    }

    const routeDisplay = [srcLabel, ...pathLabels, destLabel].join(" → ");

    const txRecord = {
      id: `tx-${Date.now()}`,
      timestamp: new Date().toISOString(),
      hash: result.hash,
      inputAmount: result.sourceAmount,
      inputAsset: srcLabel,
      outputAmount: result.destAmount,
      outputAsset: destLabel,
      path: [srcLabel, ...pathLabels, destLabel],
      fee: AXIS_MPP_FEE_XLM,
      feeHash,
      demoAgentAddress: agentAddress,
      axisAddress,
      status: "success" as const,
    };

    await addTransaction(txRecord);

    res.status(201).json({
      success: true,
      conversion: {
        inputAmount: result.sourceAmount,
        inputAsset: srcLabel,
        outputAmount: result.destAmount,
        outputAsset: destLabel,
        route: routeDisplay,
        fee: AXIS_MPP_FEE_XLM,
        feeHash,
        hash: result.hash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.hash}`,
      },
    });
  },
);

router.post("/axis/demo/trigger", async (req, res): Promise<void> => {
  await initWallets();
  const {
    destAmount = "1",
    destAsset: destAssetStr,
    srcAsset: srcAssetStr,
  } = req.body as {
    destAmount?: string;
    destAsset?: string;
    srcAsset?: string;
  };

  const [destResolved, srcResolved] = await Promise.all([
    smartResolveAsset(destAssetStr, usdcAsset),
    smartResolveAsset(srcAssetStr, Asset.native()),
  ]);

  if (!destResolved) {
    res.status(400).json({
      success: false,
      error: `Asset "${destAssetStr}" not found on Stellar Testnet. Try a different token or use "CODE:ISSUER" format.`,
    });
    return;
  }
  if (!srcResolved) {
    res.status(400).json({
      success: false,
      error: `Source asset "${srcAssetStr}" not found on Stellar Testnet.`,
    });
    return;
  }

  const destAsset = destResolved.asset;
  const srcAsset = srcResolved.asset;
  const destLabel = assetLabel(destAsset);
  const srcLabel = assetLabel(srcAsset);

  let effectiveDestAssetStr = destResolved.discovered && destResolved.issuer
    ? `${destLabel}:${destResolved.issuer}`
    : (destAssetStr ?? "USDC");
  const effectiveSrcAssetStr = srcResolved.discovered && srcResolved.issuer
    ? `${srcLabel}:${srcResolved.issuer}`
    : (srcAssetStr ?? "XLM");

  const axisAddress = getAxisTreasuryKeypair().publicKey();
  const demoKeypair = getDemoAgentKeypair();
  const demoAddress = demoKeypair.publicKey();
  const apiBase = getApiBaseUrl();

  const steps: Array<{ step: string; status: string; detail?: string }> = [];

  req.log.info({ destAmount, destAsset: destLabel, srcAsset: srcLabel, discovered: destResolved.discovered }, "Demo trigger started");

  await ensureTrustline(demoKeypair, srcAsset);

  const [beforeBalance, axisBalance] = await Promise.all([
    getWalletBalance(demoAddress),
    getWalletBalance(axisAddress),
  ]);
  const beforeDestBalance = beforeBalance.balances.find((b) => b.asset === destLabel)?.balance ?? "0";

  const discoveryNote = destResolved.discovered && destResolved.issuer
    ? ` [AXIS] Token "${destLabel}" discovered via Stellar Horizon — issuer: ${destResolved.issuer.slice(0, 8)}...`
    : "";

  steps.push({
    step: "BALANCE",
    status: "Balance checked",
    detail: `Demo Agent: ${beforeBalance.xlm} XLM | ${beforeDestBalance} ${destLabel}. Requesting ${destAmount} ${destLabel}.${discoveryNote}`,
  });

  // ── Trustline Negotiation ──────────────────────────────────────────────────
  // AXIS proactively checks if Demo Agent has a trustline for the destination
  // asset. If not, AXIS signals Demo Agent to create it, Demo Agent creates the
  // trustline on-chain, and sends back proof (tx hash) to AXIS before proceeding.
  const trustResult = await negotiateTrustline(demoKeypair, destAsset, destLabel);
  if (trustResult.needed) {
    if (!trustResult.created) {
      steps.push({
        step: "TRUSTLINE",
        status: "Trustline creation failed",
        detail: trustResult.detail,
      });
      res.status(500).json({
        success: false,
        steps,
        error: `Demo Agent could not create trustline for ${destLabel}: ${trustResult.detail}`,
      });
      return;
    }

    steps.push({
      step: "TRUSTLINE",
      status: "Trustline negotiated",
      detail: [
        `AXIS → Demo Agent: "You need a trustline for ${destLabel} before I can send you tokens."`,
        `Demo Agent: Creating trustline for ${destLabel} on Stellar Testnet...`,
        trustResult.trustlineHash
          ? `Demo Agent → AXIS: "Trustline created. Proof tx: ${trustResult.trustlineHash}"`
          : `Demo Agent → AXIS: "Trustline created and verified on Horizon."`,
        `AXIS: Verified trustline on Horizon. Proceeding with swap.`,
      ].join("\n"),
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  let pathInfo = await findBestPath(destAmount, destAsset, srcAsset, demoAddress).catch(() => ({
    sourceAmount: (parseFloat(destAmount) * 8).toFixed(7),
    path: [],
    pathLabels: [],
    hasPath: false,
  }));

  const isCustomAsset = !destAsset.isNative() && destAsset.getCode() !== "USDC";
  // noLiquidityFound = Horizon truly found no route (not just a direct-hop route).
  // A direct-hop path (XLM→CAT via AMM pool) has pathLabels=[] but hasPath=true.
  const noLiquidityFound = !pathInfo.hasPath && isCustomAsset;

  let effectiveDestAsset = destAsset;
  let effectiveDestLabel = destLabel;

  // ── AMM Pool Retry + Agent-to-Agent Negotiation ──────────────────────────
  if (noLiquidityFound) {
    req.log.warn({ destLabel, srcLabel }, "No direct DEX path — scanning AMM pools for alternate issuer");

    const pools = await scanLiquidityPools(destAsset);

    // ── Pass 1: Try pathfinding with each pool's actual issuer ─────────────
    // The initial resolveAssetByCode may pick a different issuer than the one
    // actually used in the AMM pool. Retry with the pool issuer to find a real route.
    let poolRoutePath: PathInfo | null = null;
    let poolRouteAsset: Asset | null = null;
    let poolRouteAssetStr: string | null = null;

    for (const pool of pools) {
      const destReserve = pool.reserves.find(
        (r) => r.asset.toUpperCase() === destLabel.toUpperCase() && r.rawAsset !== "native",
      );
      if (!destReserve) continue;
      const parts = destReserve.rawAsset.split(":");
      if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
      const [code, issuer] = parts as [string, string];
      const correctedAsset = new Asset(code, issuer);
      const retry = await findBestPath(destAmount, correctedAsset, srcAsset, demoAddress).catch(() => null);
      if (retry?.hasPath) {
        poolRoutePath = retry;
        poolRouteAsset = correctedAsset;
        poolRouteAssetStr = `${code}:${issuer}`;
        req.log.info({ destLabel, issuer }, "AMM pool issuer retry succeeded — found valid path");
        break;
      }
    }

    if (poolRoutePath && poolRouteAsset && poolRouteAssetStr) {
      // ── Pool route found — execute swap directly through AMM, skip NEGOTIATE ─
      const poolDesc = describeBestPool(pools);

      // Ensure Demo Agent has trustline for the pool issuer's asset
      await ensureTrustline(demoKeypair, poolRouteAsset);

      steps.push({
        step: "SCAN",
        status: "AMM pool route discovered",
        detail: [
          `[AXIS] Initial pathfinder returned no route for ${destLabel} (issuer mismatch).`,
          `[AXIS Scanning] Queried Stellar AMM pools — found ${pools.length} pool${pools.length !== 1 ? "s" : ""} for ${destLabel}.`,
          poolDesc ? `[Pool Found] Best pool: ${poolDesc}` : "",
          `[AXIS] Retried pathfinding with pool issuer → valid route found. Proceeding directly.`,
        ].filter(Boolean).join("\n"),
      });
      pathInfo = poolRoutePath;
      effectiveDestAsset = poolRouteAsset;
      effectiveDestAssetStr = poolRouteAssetStr;
      effectiveDestLabel = destLabel;
    } else {
      // ── No pool route — enter Agent-to-Agent negotiation ───────────────────
      const reasonMsg = `No Stellar Testnet DEX path found for ${destLabel}/${srcLabel}. ${pools.length > 0 ? "AMM pools exist but could not be routed." : "No AMM liquidity pools found either."}`;

      const altPathInfo = await findBestPath(destAmount, usdcAsset, srcAsset, demoAddress).catch(() => ({
        sourceAmount: (parseFloat(destAmount) * 6).toFixed(7),
        path: [],
        pathLabels: [],
        hasPath: false,
      }));

      const bestPoolDesc = describeBestPool(pools);
      const poolScanLines: string[] = pools.length > 0
        ? [
            `[AXIS Scanning] Found ${pools.length} AMM pool${pools.length > 1 ? "s" : ""} for ${destLabel} on Stellar Testnet (route unavailable):`,
            ...pools.map((p) =>
              `[Pool Found] ${p.pairLabel} — ${p.reserves.map((r) => `${r.amount} ${r.asset}`).join(" + ")} | fee ${p.feeBp / 100}%`,
            ),
          ]
        : [`[AXIS Scanning] No AMM liquidity pools found for ${destLabel} on Stellar Testnet.`];

      const proposedAlternative = bestPoolDesc
        ? `USDC (route: ${srcLabel}→USDC→${destLabel} via AMM pool: ${bestPoolDesc})`
        : "USDC";

      const agentDecision = await consultDemoAgentBrain({
        originalAsset: destLabel,
        originalAmount: destAmount,
        proposedAlternative,
        proposedAmount: destAmount,
        reasonNoLiquidity: reasonMsg,
        poolsFound: pools,
      });

      const negotiationDetail = [
        `[AXIS] Pathfinder result: No viable route found for ${destLabel} on Stellar Testnet.`,
        ...poolScanLines,
        `[AXIS → Demo Agent] "Unable to source ${destAmount} ${destLabel}. ${bestPoolDesc ? `AMM pool found but route unavailable: ${bestPoolDesc}. Proposing USDC as alternative.` : `Proposing alternative: ${destAmount} USDC instead.`} Do you accept?"`,
        `[Demo Agent mandate] ${agentDecision.mandate}`,
        ...agentDecision.reasoning.map((r) => `[Demo Agent thinking] ${r}`),
        `[Demo Agent → AXIS] "${agentDecision.response}"`,
        agentDecision.accepted
          ? bestPoolDesc
            ? `[AXIS] Negotiation accepted. Proceeding via USDC intermediate hop.`
            : `[AXIS] Negotiation accepted. Proceeding with USDC alternative swap.`
          : `[AXIS] Negotiation rejected. Demo Agent cannot accept the proposed alternative. Cancelling swap.`,
      ].join("\n");

      steps.push({
        step: "NEGOTIATE",
        status: agentDecision.accepted ? "Alternative accepted" : "Negotiation rejected — swap cancelled",
        detail: negotiationDetail,
      });

      if (!agentDecision.accepted) {
        await addTransaction({
          id: `tx-${Date.now()}`,
          timestamp: new Date().toISOString(),
          hash: "",
          inputAmount: "?",
          inputAsset: srcLabel,
          outputAmount: destAmount,
          outputAsset: destLabel,
          path: [srcLabel, destLabel],
          fee: "0",
          status: "failed",
        });
        res.status(200).json({
          success: false,
          cancelled: true,
          steps,
          error: `Swap cancelled: Demo Agent rejected alternative. No viable route for ${destLabel} on Stellar Testnet.`,
        });
        return;
      }

      effectiveDestAsset = usdcAsset;
      effectiveDestAssetStr = "USDC";
      effectiveDestLabel = "USDC";
      pathInfo = altPathInfo;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  req.log.info({ srcLabel, effectiveDestLabel, destAmount, pathLabels: pathInfo.pathLabels }, "Path info for brain");

  const brainDecision = await consultBrain({
    srcAsset: srcLabel,
    destAsset: effectiveDestLabel,
    destAmount,
    axisXlmBalance: axisBalance.xlm,
    demoXlmBalance: beforeBalance.xlm,
    demoDestBalance: beforeDestBalance,
    estimatedSourceAmount: pathInfo.sourceAmount,
    pathLabels: pathInfo.pathLabels,
    networkId: "testnet",
  });

  const thinkingDetail = brainDecision.thinkingLog.map((t) => `[AI BRAIN] ${t}`).join("\n");

  steps.push({
    step: "THINK",
    status: brainDecision.approved ? "Decision: APPROVED" : "Decision: REJECTED",
    detail: `${thinkingDetail}\n[AI BRAIN] ${brainDecision.summary}\n[AI BRAIN] Dynamic fee: ${brainDecision.dynamicFee} XLM (${brainDecision.feeReason}) | Risk: ${brainDecision.riskLevel.toUpperCase()}`,
  });

  if (!brainDecision.approved) {
    res.status(500).json({
      success: false,
      steps,
      error: `AXIS Brain rejected this transaction: ${brainDecision.summary}`,
    });
    return;
  }

  const serviceFee = Math.max(
    parseFloat(brainDecision.dynamicFee),
    parseFloat(AXIS_MPP_FEE_XLM),
  ).toFixed(7);

  // ── Quote: ask AXIS how much sourceAmount the Demo Agent needs to send ──────
  // The correct flow: agent sends (sourceAmount + fee) to AXIS via MPP,
  // AXIS uses the sourceAmount for PathPayment → sends destination tokens to agent.
  let totalRequired = serviceFee;
  let quoteSourceAmount = "0";
  try {
    const quoteUrl = `${apiBase}/axis/quote?srcAsset=${effectiveSrcAssetStr}&destAsset=${effectiveDestAssetStr}&destAmount=${destAmount}&agentAddress=${demoAddress}`;
    const quoteRes = await fetch(quoteUrl);
    if (quoteRes.ok) {
      const quoteBody = await quoteRes.json() as { success: boolean; quote?: { sourceAmount: string; totalRequired: string } };
      if (quoteBody.success && quoteBody.quote) {
        quoteSourceAmount = quoteBody.quote.sourceAmount;
        totalRequired = quoteBody.quote.totalRequired;
        steps.push({
          step: "QUOTE",
          status: "Swap quote received",
          detail: `AXIS quoted: ${quoteSourceAmount} ${srcLabel} needed to receive ${destAmount} ${destLabel}. Total to pay: ${totalRequired} XLM (source + ${serviceFee} XLM service fee).`,
        });
        req.log.info({ quoteSourceAmount, totalRequired, serviceFee }, "Quote received from AXIS");
      }
    }
  } catch (quoteErr) {
    req.log.warn({ quoteErr }, "Quote request failed — falling back to fee-only amount");
    steps.push({
      step: "QUOTE",
      status: "Quote skipped (fallback)",
      detail: `Could not get quote from AXIS, using estimated amount.`,
    });
  }

  // ── MPP (Machine Payments Protocol) — @stellar/mpp Charge intent ───────────
  // Agent sends totalRequired XLM to AXIS treasury via Soroban SAC:
  //   sourceAmount XLM → used by AXIS for PathPayment → sent as destAsset to agent
  //   serviceFee XLM  → kept by AXIS as service revenue
  let feeHash = "";
  const mppxClient = Mppx.create({
    methods: [
      stellarMppClient.charge({
        keypair: demoKeypair,
        mode: "push",
        onProgress: (event) => {
          if (event.type === "challenge") {
            const isXlm = event.currency === XLM_SAC_TESTNET;
            steps.push({
              step: "402",
              status: "MPP Payment Required",
              detail: [
                `POST /api/axis/convert → 402 (MPP Stellar Charge, draft-stellar-charge-00).`,
                `WWW-Authenticate: Payment received. AXIS requires ${event.amount} ${isXlm ? "XLM" : event.currency} via Soroban SAC.`,
                `Breakdown: ${quoteSourceAmount} XLM (swap source) + ${serviceFee} XLM (AXIS fee) = ${event.amount} XLM total.`,
                `[Demo Agent] Sending ${event.amount} XLM to AXIS treasury via Soroban SAC transfer...`,
              ].join("\n"),
            });
          } else if (event.type === "paid") {
            feeHash = event.hash;
            steps.push({
              step: "PAYMENT",
              status: "Agent funds sent to AXIS via Soroban SAC",
              detail: `Demo Agent sent ${totalRequired} XLM to AXIS Treasury (${quoteSourceAmount} for swap + ${serviceFee} service fee) | Stellar tx: ${event.hash}`,
            });
          }
        },
      }),
    ],
  });

  req.log.info({ totalRequired, serviceFee, quoteSourceAmount, demoAddress }, "Initiating MPP payment flow");

  let convertRes: Response;
  try {
    convertRes = await mppxClient.fetch(`${apiBase}/axis/convert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Axis-Fee": totalRequired,
      },
      body: JSON.stringify({
        destAmount,
        destAsset: effectiveDestAssetStr,
        srcAsset: effectiveSrcAssetStr,
        agentAddress: demoAddress,
      }),
    });
  } catch (err) {
    logger.error({ err }, "MPP payment or convert failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!steps.find((s) => s.step === "PAYMENT")) {
      steps.push({ step: "PAYMENT", status: "MPP payment failed", detail: errMsg });
    }
    res.status(500).json({ success: false, steps, error: `MPP payment failed: ${errMsg}` });
    return;
  }

  if (!convertRes.ok) {
    const errBody = await convertRes.text();
    const errMsg = `Convert failed with HTTP ${convertRes.status}: ${errBody}`;
    req.log.error({ status: convertRes.status, body: errBody }, "Convert endpoint failed");
    steps.push({ step: "SWAP", status: "Swap failed", detail: errMsg });

    await addTransaction({
      id: `tx-${Date.now()}`,
      timestamp: new Date().toISOString(),
      hash: "",
      inputAmount: "?",
      inputAsset: srcLabel,
      outputAmount: destAmount,
      outputAsset: destLabel,
      path: [srcLabel, destLabel],
      fee: serviceFee,
      feeHash,
      demoAgentAddress: demoAddress,
      axisAddress,
      status: "failed",
      errorMessage: errMsg,
    });

    res.status(500).json({ success: false, steps, error: errMsg });
    return;
  }

  const convertBody = await convertRes.json() as {
    success: boolean;
    conversion: {
      inputAmount: string;
      outputAmount: string;
      route: string;
      hash: string;
      explorerUrl: string;
    };
  };
  const conversion = convertBody.conversion;

  steps.push({
    step: "SWAP",
    status: "PathPaymentStrictReceive executed",
    detail: `${conversion.inputAmount} ${srcLabel} → ${conversion.outputAmount} ${destLabel} via ${conversion.route} | tx: ${conversion.hash}`,
  });

  const afterBalance = await getWalletBalance(demoAddress).catch(() => ({ xlm: "?", usdc: "?", balances: [] }));
  const afterDestBalance = afterBalance.balances.find((b) => b.asset === destLabel)?.balance ?? afterBalance.usdc;

  steps.push({
    step: "DONE",
    status: `${destLabel} received`,
    detail: `Demo Agent now has ${afterDestBalance} ${destLabel} (+${conversion.outputAmount}) and ${afterBalance.xlm} XLM | Explorer: ${conversion.explorerUrl}`,
  });

  res.json({
    success: true,
    steps,
    brainDecision: {
      thinkingLog: brainDecision.thinkingLog,
      dynamicFee: serviceFee,
      feeReason: brainDecision.feeReason,
      riskLevel: brainDecision.riskLevel,
      pathRecommendation: brainDecision.pathRecommendation,
      summary: brainDecision.summary,
    },
    result: {
      inputAmount: conversion.inputAmount,
      inputAsset: srcLabel,
      outputAmount: conversion.outputAmount,
      outputAsset: destLabel,
      route: conversion.route,
      sourceAmount: quoteSourceAmount,
      fee: serviceFee,
      totalPaid: totalRequired,
      feeHash,
      swapHash: conversion.hash,
      explorerUrl: conversion.explorerUrl,
    },
    rawRequest: {
      endpoint: "POST /api/axis/convert",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Payment <MPP Stellar Charge credential>",
        "X-Axis-Fee": totalRequired,
      },
      body: {
        destAmount,
        destAsset: destAssetStr ?? "USDC",
        srcAsset: srcAssetStr ?? "XLM",
        agentAddress: demoAddress,
      },
    },
  });
});

export default router;
