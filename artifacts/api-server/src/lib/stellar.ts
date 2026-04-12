import {
  Keypair,
  Networks,
  Asset,
  Horizon,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Memo,
} from "@stellar/stellar-sdk";
import { logger } from "./logger";

const STELLAR_NETWORK = process.env["STELLAR_NETWORK"] ?? "testnet";

export const HORIZON_URL =
  STELLAR_NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export const FRIENDBOT_URL = "https://friendbot.stellar.org";

export const USDC_ISSUER =
  STELLAR_NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export const horizonServer = new Horizon.Server(HORIZON_URL);
export const usdcAsset = new Asset("USDC", USDC_ISSUER);

/**
 * Parse an asset string into a Stellar Asset object.
 * Accepts:
 *   "XLM" | "native"           → native XLM
 *   "CODE:ISSUER"               → issued asset (e.g. "USDC:GBBD47...")
 *   "USDC"                      → shorthand for USDC on the configured network
 */
const CANONICAL_ALIASES: Record<string, Asset> = {
  USDC: new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
};

export function parseAsset(assetStr: string): Asset {
  const upper = assetStr.trim().toUpperCase();
  if (upper === "XLM" || upper === "NATIVE") return Asset.native();
  const canonical = CANONICAL_ALIASES[upper];
  if (canonical) return canonical;
  const colonIdx = assetStr.indexOf(":");
  if (colonIdx !== -1) {
    const code = assetStr.slice(0, colonIdx).trim();
    const issuer = assetStr.slice(colonIdx + 1).trim();
    return new Asset(code, issuer);
  }
  throw new Error(`Cannot resolve "${assetStr}" — unknown bare code. Needs "CODE:ISSUER" or Horizon lookup.`);
}

interface HorizonAssetRecord {
  asset_code: string;
  asset_issuer: string;
  num_accounts: number;
  amount: string;
}

/**
 * Discover the best issuer for a bare asset code by querying Stellar Horizon.
 * Picks the issuer with the most active accounts (most adopted / most legitimate).
 * Returns null if no issuer found on the network.
 */
export async function resolveAssetByCode(code: string): Promise<Asset | null> {
  const upper = code.trim().toUpperCase();
  if (upper === "XLM" || upper === "NATIVE") return Asset.native();
  const canonical = CANONICAL_ALIASES[upper];
  if (canonical) return canonical;

  const url = `${HORIZON_URL}/assets?asset_code=${encodeURIComponent(upper)}&limit=20&order=desc`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { _embedded?: { records?: HorizonAssetRecord[] } };
    const records = data._embedded?.records ?? [];
    if (records.length === 0) return null;

    const best = records.sort((a, b) => (b.num_accounts ?? 0) - (a.num_accounts ?? 0))[0];
    return new Asset(best.asset_code, best.asset_issuer);
  } catch {
    return null;
  }
}

/**
 * Returns a human-readable label for an asset (e.g. "XLM", "USDC", "BTC").
 */
export function assetLabel(asset: Asset): string {
  return asset.isNative() ? "XLM" : asset.getCode();
}

let _axisTreasuryKeypair: Keypair | null = null;
let _demoAgentKeypair: Keypair | null = null;

export function getAxisTreasuryKeypair(): Keypair {
  if (!_axisTreasuryKeypair) {
    const secret = process.env["AXIS_SECRET_KEY"];
    if (secret) {
      _axisTreasuryKeypair = Keypair.fromSecret(secret);
      logger.info({ address: _axisTreasuryKeypair.publicKey() }, "AXIS Treasury keypair loaded from env");
    } else {
      _axisTreasuryKeypair = Keypair.random();
      logger.warn(
        { address: _axisTreasuryKeypair.publicKey() },
        "AXIS_SECRET_KEY not set — generated ephemeral keypair (will be funded via Friendbot). Set AXIS_SECRET_KEY for a persistent address.",
      );
    }
  }
  return _axisTreasuryKeypair;
}

export function getDemoAgentKeypair(): Keypair {
  if (!_demoAgentKeypair) {
    const secret = process.env["DEMO_AGENT_SECRET_KEY"];
    if (secret) {
      _demoAgentKeypair = Keypair.fromSecret(secret);
      logger.info({ address: _demoAgentKeypair.publicKey() }, "Demo Agent keypair loaded from env");
    } else {
      _demoAgentKeypair = Keypair.random();
      logger.warn(
        { address: _demoAgentKeypair.publicKey() },
        "DEMO_AGENT_SECRET_KEY not set — generated ephemeral keypair (will be funded via Friendbot). Set DEMO_AGENT_SECRET_KEY for a persistent address.",
      );
    }
  }
  return _demoAgentKeypair;
}

async function fundViaFriendbot(publicKey: string): Promise<void> {
  if (STELLAR_NETWORK === "mainnet") {
    throw new Error("Friendbot is not available on mainnet");
  }
  const url = `${FRIENDBOT_URL}?addr=${publicKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Friendbot failed for ${publicKey}: ${text}`);
  }
  logger.info({ address: publicKey }, "Funded via Friendbot");
}

export async function ensureAccountExists(publicKey: string): Promise<boolean> {
  try {
    await horizonServer.loadAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

export async function ensureTrustline(keypair: Keypair, asset: Asset): Promise<void> {
  if (asset.isNative()) return;

  const account = await horizonServer.loadAccount(keypair.publicKey());
  const hasTrustline = account.balances.some(
    (b) =>
      b.asset_type !== "native" &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">)
        .asset_code === asset.getCode() &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">)
        .asset_issuer === asset.getIssuer(),
  );
  if (hasTrustline) {
    logger.info({ address: keypair.publicKey(), asset: asset.getCode() }, "Trustline already exists");
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit: "1000000",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  await horizonServer.submitTransaction(tx);
  logger.info(
    { address: keypair.publicKey(), asset: asset.getCode() },
    "Trustline created",
  );
}

let walletsInitialized = false;
let initPromise: Promise<void> | null = null;

export async function initWallets(): Promise<void> {
  if (walletsInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const axisKeypair = getAxisTreasuryKeypair();
    const demoKeypair = getDemoAgentKeypair();

    const axisExists = await ensureAccountExists(axisKeypair.publicKey());
    if (!axisExists) {
      await fundViaFriendbot(axisKeypair.publicKey());
    }

    const demoExists = await ensureAccountExists(demoKeypair.publicKey());
    if (!demoExists) {
      await fundViaFriendbot(demoKeypair.publicKey());
    }

    await ensureTrustline(axisKeypair, usdcAsset);
    await ensureTrustline(demoKeypair, usdcAsset);

    walletsInitialized = true;
    logger.info("Wallets initialized and trustlines established");
  })();

  return initPromise;
}

export interface AssetBalance {
  asset: string;
  balance: string;
  issuer?: string;
}

export interface WalletBalance {
  xlm: string;
  usdc: string;
  balances: AssetBalance[];
}

export async function getWalletBalance(publicKey: string): Promise<WalletBalance> {
  const account = await horizonServer.loadAccount(publicKey);
  let xlm = "0";
  let usdc = "0";
  const balances: AssetBalance[] = [];

  for (const balance of account.balances) {
    if (balance.asset_type === "native") {
      xlm = balance.balance;
      balances.push({ asset: "XLM", balance: balance.balance });
    } else {
      const b = balance as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">;
      if (b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER) {
        usdc = b.balance;
      }
      if (parseFloat(b.balance) > 0) {
        balances.push({
          asset: b.asset_code,
          balance: b.balance,
          issuer: b.asset_issuer,
        });
      }
    }
  }

  return { xlm, usdc, balances };
}

const AXIS_MIN_XLM = 50;

export async function ensureAxisSolvency(): Promise<{ ok: boolean; xlm: string }> {
  const axisKeypair = getAxisTreasuryKeypair();
  const balance = await getWalletBalance(axisKeypair.publicKey());
  const xlm = parseFloat(balance.xlm);
  if (xlm < AXIS_MIN_XLM) {
    logger.warn({ xlm, minimum: AXIS_MIN_XLM }, "AXIS Treasury low — auto-refilling via Friendbot");
    await fundViaFriendbot(axisKeypair.publicKey());
    const newBalance = await getWalletBalance(axisKeypair.publicKey());
    logger.info({ xlm: newBalance.xlm }, "AXIS Treasury refilled");
    return { ok: true, xlm: newBalance.xlm };
  }
  return { ok: true, xlm: balance.xlm };
}

export async function checkAgentTrustline(
  agentAddress: string,
  asset: Asset,
): Promise<{ hasTrustline: boolean; error?: string }> {
  if (asset.isNative()) return { hasTrustline: true };
  try {
    const account = await horizonServer.loadAccount(agentAddress);
    const hasTrustline = account.balances.some(
      (b) =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">)
          .asset_code === asset.getCode() &&
        (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4" | "credit_alphanum12">)
          .asset_issuer === asset.getIssuer(),
    );
    return { hasTrustline };
  } catch {
    return { hasTrustline: false, error: `Account ${agentAddress} not found on Stellar Testnet` };
  }
}

export async function sendPayment(
  fromKeypair: Keypair,
  toAddress: string,
  asset: Asset,
  amount: string,
  memo?: string,
): Promise<string> {
  const account = await horizonServer.loadAccount(fromKeypair.publicKey());

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: toAddress,
      asset,
      amount,
    }),
  );

  if (memo) {
    builder.addMemo(Memo.text(memo));
  }

  const tx = builder.setTimeout(30).build();
  tx.sign(fromKeypair);

  const result = await horizonServer.submitTransaction(tx);
  return (result as { hash: string }).hash;
}

export interface PaymentVerificationResult {
  valid: boolean;
  sourceAddress: string | null;
}

export async function verifyPayment(
  txHash: string,
  expectedDestination: string,
  expectedMinAmount: string,
  expectedMemo?: string,
): Promise<PaymentVerificationResult> {
  try {
    const txRecord = await horizonServer
      .transactions()
      .transaction(txHash)
      .call();

    if (expectedMemo && txRecord.memo !== expectedMemo) {
      return { valid: false, sourceAddress: null };
    }

    const ops = await horizonServer
      .operations()
      .forTransaction(txHash)
      .call();

    for (const op of ops.records) {
      if (op.type === "payment") {
        const payOp = op as Horizon.HorizonApi.PaymentOperationResponse;
        if (
          payOp.to === expectedDestination &&
          payOp.asset_type === "native" &&
          parseFloat(payOp.amount) >= parseFloat(expectedMinAmount)
        ) {
          return { valid: true, sourceAddress: payOp.from };
        }
      }
    }
    return { valid: false, sourceAddress: null };
  } catch {
    return { valid: false, sourceAddress: null };
  }
}
