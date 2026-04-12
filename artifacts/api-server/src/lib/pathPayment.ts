import {
  Keypair,
  Asset,
  Horizon,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  horizonServer,
  usdcAsset,
  NETWORK_PASSPHRASE,
  HORIZON_URL,
} from "./stellar";
import { logger } from "./logger";

export interface PathInfo {
  sourceAmount: string;
  path: string[];
  pathLabels: string[];
  /** true = Horizon returned a real path (even if direct/no hops); false = no route found */
  hasPath: boolean;
}

export interface PathPaymentResult {
  hash: string;
  sourceAmount: string;
  destAmount: string;
  path: string[];
  pathLabels: string[];
}

function destAssetType(asset: Asset): string {
  if (asset.isNative()) return "native";
  return asset.getCode().length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
}

async function queryHorizonPath(
  destAmount: string,
  destAsset: Asset,
  sourceAsset: Asset,
  sourceParam: { type: "account"; value: string } | { type: "assets" },
): Promise<Response> {
  const url = new URL(`${HORIZON_URL}/paths/strict-receive`);
  url.searchParams.set("destination_asset_type", destAssetType(destAsset));
  if (!destAsset.isNative()) {
    url.searchParams.set("destination_asset_code", destAsset.getCode());
    url.searchParams.set("destination_asset_issuer", destAsset.getIssuer());
  }
  url.searchParams.set("destination_amount", destAmount);

  if (sourceParam.type === "account") {
    url.searchParams.set("source_account", sourceParam.value);
  } else {
    url.searchParams.set(
      "source_assets",
      sourceAsset.isNative() ? "native" : `${sourceAsset.getCode()}:${sourceAsset.getIssuer()}`,
    );
  }
  return fetch(url.toString());
}

export async function findBestPath(
  destAmount: string,
  destAsset: Asset = usdcAsset,
  sourceAsset: Asset = Asset.native(),
  sourceAccount?: string,
): Promise<PathInfo> {
  const FALLBACK_RATE = 6;

  let response: Response;

  if (sourceAccount) {
    response = await queryHorizonPath(destAmount, destAsset, sourceAsset, {
      type: "account",
      value: sourceAccount,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Pathfinding (source_account) failed — trying source_assets");
      response = await queryHorizonPath(destAmount, destAsset, sourceAsset, { type: "assets" });
    }
  } else {
    response = await queryHorizonPath(destAmount, destAsset, sourceAsset, { type: "assets" });
  }

  if (!response.ok) {
    logger.warn({ status: response.status }, "Pathfinding failed — using direct route estimate");
    return { sourceAmount: (parseFloat(destAmount) * FALLBACK_RATE).toFixed(7), path: [], pathLabels: [], hasPath: false };
  }

  const data = await response.json() as {
    _embedded?: {
      records?: Array<{
        source_amount: string;
        path?: Array<{ asset_code?: string; asset_issuer?: string; asset_type: string }>;
      }>;
    };
  };

  const records = data._embedded?.records ?? [];
  if (records.length === 0) {
    logger.warn("No paths found from Horizon");
    return { sourceAmount: (parseFloat(destAmount) * 8).toFixed(7), path: [], pathLabels: [], hasPath: false };
  }

  const best = records[0];
  const pathAssets = best.path ?? [];
  const stellarPath = pathAssets.map((a) => {
    if (a.asset_type === "native") return Asset.native();
    return new Asset(a.asset_code!, a.asset_issuer!);
  });

  const pathLabels = pathAssets.map((a) => {
    if (a.asset_type === "native") return "XLM";
    return a.asset_code ?? "UNKNOWN";
  });

  // hasPath = true even when path is empty (means direct swap, no intermediate hops)
  return {
    sourceAmount: best.source_amount,
    path: stellarPath.map((a) => (a.isNative() ? "native" : `${a.getCode()}:${a.getIssuer()}`)),
    pathLabels,
    hasPath: true,
  };
}

export async function executePathPayment(
  sourceKeypair: Keypair,
  destinationAddress: string,
  destAmount: string,
  destAsset: Asset = usdcAsset,
  sourceAsset: Asset = Asset.native(),
  sendMax: string,
  pathAssets: Asset[] = [],
): Promise<PathPaymentResult> {
  const account = await horizonServer.loadAccount(sourceKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: sourceAsset,
        sendMax,
        destination: destinationAddress,
        destAsset,
        destAmount,
        path: pathAssets,
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);

  const result = await horizonServer.submitTransaction(tx);
  const txHash = (result as { hash: string }).hash;

  const ops = await horizonServer.operations().forTransaction(txHash).call();
  let actualSourceAmount = sendMax;

  for (const op of ops.records) {
    if (op.type === "path_payment_strict_receive") {
      const ppOp = op as Horizon.HorizonApi.PathPaymentOperationResponse;
      actualSourceAmount = ppOp.source_amount;
      break;
    }
  }

  logger.info(
    { hash: txHash, srcAmount: actualSourceAmount, destAmount, destAsset: destAsset.getCode() },
    "Path payment executed",
  );

  return {
    hash: txHash,
    sourceAmount: actualSourceAmount,
    destAmount,
    path: pathAssets.map((a) => (a.isNative() ? "native" : `${a.getCode()}:${a.getIssuer()}`)),
    pathLabels: pathAssets.map((a) => (a.isNative() ? "XLM" : a.getCode())),
  };
}
