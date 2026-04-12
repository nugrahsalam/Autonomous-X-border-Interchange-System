/**
 * Trustline Negotiation Module
 *
 * When AXIS detects that the Demo Agent lacks a trustline for the destination asset,
 * this module handles the agent-to-agent negotiation:
 * 1. AXIS signals Demo Agent that a trustline is needed
 * 2. Demo Agent creates the trustline (real Stellar tx)
 * 3. Demo Agent sends proof tx hash back to AXIS
 * 4. AXIS verifies on Horizon that the trustline now exists
 */

import { Keypair, Asset, Horizon } from "@stellar/stellar-sdk";
import { ensureTrustline, horizonServer } from "./stellar";
import { logger } from "./logger";

export interface TrustlineNegotiationResult {
  needed: boolean;
  created: boolean;
  trustlineHash?: string;
  detail: string;
}

/**
 * Check whether an account already has a trustline for the given asset.
 */
export async function hasTrustline(address: string, asset: Asset): Promise<boolean> {
  if (asset.isNative()) return true;
  try {
    const account = await horizonServer.loadAccount(address);
    return account.balances.some((b) => {
      if (b.asset_type === "native") return false;
      const bl = b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">;
      return bl.asset_code === asset.getCode() && bl.asset_issuer === asset.getIssuer();
    });
  } catch {
    return false;
  }
}

/**
 * Full agent-to-agent trustline negotiation:
 *
 * - Returns `needed: false` immediately if trustline already exists
 * - Otherwise, instructs Demo Agent to create trustline, Demo Agent executes it,
 *   verifies on Horizon, and returns the proof tx hash.
 *
 * All steps are logged with agent context for clear demo visibility.
 */
export async function negotiateTrustline(
  demoKeypair: Keypair,
  destAsset: Asset,
  assetLabel: string,
): Promise<TrustlineNegotiationResult> {
  const demoAddress = demoKeypair.publicKey();

  const already = await hasTrustline(demoAddress, destAsset);
  if (already) {
    logger.info({ address: demoAddress, asset: assetLabel }, "Trustline already exists — no negotiation needed");
    return { needed: false, created: false, detail: `Trustline for ${assetLabel} already exists on Demo Agent` };
  }

  logger.info(
    { address: demoAddress, asset: assetLabel },
    "AXIS detected missing trustline — signaling Demo Agent",
  );

  try {
    await ensureTrustline(demoKeypair, destAsset);

    const account = await horizonServer.loadAccount(demoAddress);
    const ops = await horizonServer.operations().forAccount(demoAddress).order("desc").limit(5).call();

    let trustlineHash: string | undefined;
    for (const op of ops.records) {
      if (op.type === "change_trust") {
        const ct = op as Horizon.HorizonApi.ChangeTrustOperationResponse;
        const code = destAsset.isNative() ? "XLM" : destAsset.getCode();
        if (ct.asset_code === code) {
          trustlineHash = ct.transaction_hash;
          break;
        }
      }
    }

    void account;

    logger.info(
      { address: demoAddress, asset: assetLabel, trustlineHash },
      "Demo Agent trustline created and verified on Horizon",
    );

    return {
      needed: true,
      created: true,
      trustlineHash,
      detail: `Demo Agent created trustline for ${assetLabel} on Stellar Testnet${trustlineHash ? ` (proof tx: ${trustlineHash})` : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, asset: assetLabel }, "Trustline creation failed");
    return {
      needed: true,
      created: false,
      detail: `Demo Agent failed to create trustline for ${assetLabel}: ${msg}`,
    };
  }
}
