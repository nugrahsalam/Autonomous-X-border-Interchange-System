import { Asset } from "@stellar/stellar-sdk";
import { HORIZON_URL } from "./stellar";
import { logger } from "./logger";

export interface PoolReserve {
  asset: string;   // display code: "XLM", "CAT", etc.
  amount: string;
  rawAsset: string; // Horizon format: "native" or "CODE:ISSUER"
}

export interface LiquidityPoolInfo {
  poolId: string;
  reserves: PoolReserve[];
  totalShares: string;
  feeBp: number;
  pairLabel: string;
}

interface HorizonPoolReserve {
  asset: string;
  amount: string;
}

interface HorizonPool {
  id: string;
  fee_bp: number;
  total_shares: string;
  reserves: HorizonPoolReserve[];
}

function formatReserveLabel(reserve: HorizonPoolReserve): string {
  if (reserve.asset === "native") return "XLM";
  const parts = reserve.asset.split(":");
  return parts[0] ?? reserve.asset;
}

function mapPool(pool: HorizonPool): LiquidityPoolInfo {
  const pairLabel = pool.reserves.map(formatReserveLabel).join("/");
  return {
    poolId: pool.id.slice(0, 12) + "...",
    reserves: pool.reserves.map((r) => ({
      asset: formatReserveLabel(r),
      amount: parseFloat(r.amount).toLocaleString("en-US", { maximumFractionDigits: 2 }),
      rawAsset: r.asset, // preserve "native" or "CODE:ISSUER" for pathfinding retry
    })),
    totalShares: parseFloat(pool.total_shares).toLocaleString("en-US", { maximumFractionDigits: 2 }),
    feeBp: pool.fee_bp,
    pairLabel,
  };
}

/**
 * Scans Stellar Testnet Horizon for AMM liquidity pools that hold the given asset.
 *
 * Strategy (two-pass for robustness):
 * 1. Fast path: query Horizon by exact CODE:ISSUER — works when the resolved issuer
 *    matches the pool's issuer.
 * 2. Fallback: fetch all pools (testnet has < 200) and filter client-side by asset
 *    code only — catches pools where a different issuer was used to create the pool.
 *
 * Returns pools sorted by total_shares descending (highest TVL first).
 */
export async function scanLiquidityPools(asset: Asset): Promise<LiquidityPoolInfo[]> {
  if (asset.isNative()) return [];

  const assetCode = asset.getCode().toUpperCase();
  const issuer = asset.getIssuer();
  const reserveParam = `${assetCode}:${issuer}`;

  try {
    // ── Pass 1: exact CODE:ISSUER query ──────────────────────────────────────
    const exactUrl = `${HORIZON_URL}/liquidity_pools?reserves=${encodeURIComponent(reserveParam)}&limit=10&order=desc`;
    const exactRes = await fetch(exactUrl);
    if (exactRes.ok) {
      const exactData = await exactRes.json() as { _embedded?: { records?: HorizonPool[] } };
      const exactRecords = exactData._embedded?.records ?? [];
      if (exactRecords.length > 0) {
        logger.info({ asset: reserveParam, count: exactRecords.length }, "AMM pools found (exact issuer match)");
        return exactRecords
          .sort((a, b) => parseFloat(b.total_shares) - parseFloat(a.total_shares))
          .map(mapPool);
      }
    }

    // ── Pass 2: broad scan — filter all pools by asset code client-side ──────
    logger.info({ assetCode }, "No pools by exact issuer — scanning all pools by code");
    const allUrl = `${HORIZON_URL}/liquidity_pools?limit=200&order=desc`;
    const allRes = await fetch(allUrl);
    if (!allRes.ok) {
      logger.warn({ status: allRes.status }, "Broad pool scan HTTP error");
      return [];
    }

    const allData = await allRes.json() as { _embedded?: { records?: HorizonPool[] } };
    const allRecords = allData._embedded?.records ?? [];

    const matching = allRecords.filter((pool) =>
      pool.reserves.some((r) => {
        if (r.asset === "native") return assetCode === "XLM";
        const parts = r.asset.split(":");
        return parts[0]?.toUpperCase() === assetCode;
      }),
    );

    if (matching.length === 0) {
      logger.info({ assetCode }, "No AMM pools found for asset (broad scan)");
      return [];
    }

    logger.info({ assetCode, count: matching.length }, "AMM pools found (broad code scan)");
    return matching
      .sort((a, b) => parseFloat(b.total_shares) - parseFloat(a.total_shares))
      .slice(0, 10)
      .map(mapPool);
  } catch (err) {
    logger.error({ err }, "Error scanning liquidity pools");
    return [];
  }
}

/**
 * Picks the best pool for a given token and returns a human-readable description.
 * "Best" = highest total_shares (proxy for TVL).
 */
export function describeBestPool(pools: LiquidityPoolInfo[]): string | null {
  if (pools.length === 0) return null;
  const best = pools[0];
  const reserves = best.reserves.map((r) => `${r.amount} ${r.asset}`).join(" + ");
  return `${best.pairLabel} pool (${reserves}, fee ${best.feeBp / 100}%)`;
}
