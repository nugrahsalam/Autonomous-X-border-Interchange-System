import { query, execute } from "./db";
import { logger } from "./logger";

export interface TransactionRecord {
  id: string;
  timestamp: string;
  hash: string;
  inputAmount: string;
  inputAsset: string;
  outputAmount: string;
  outputAsset: string;
  path: string[];
  fee: string;
  feeHash: string;
  demoAgentAddress: string;
  axisAddress: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface NodeStats {
  totalRevenue: string;
  successCount: number;
  failedCount: number;
  upSince: string;
}

const upSince = new Date().toISOString();

export async function addTransaction(record: TransactionRecord): Promise<void> {
  try {
    await execute(
      `INSERT INTO axis_transactions
         (id, timestamp, hash, input_amount, input_asset, output_amount, output_asset,
          path, fee, fee_hash, demo_agent_address, axis_address, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.timestamp,
        record.hash,
        record.inputAmount,
        record.inputAsset,
        record.outputAmount,
        record.outputAsset,
        record.path,
        record.fee,
        record.feeHash,
        record.demoAgentAddress,
        record.axisAddress,
        record.status,
        record.errorMessage ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err, id: record.id }, "Failed to persist transaction to DB");
  }
}

export async function getRecentTransactions(
  limit = 20,
  successOnly = true,
): Promise<TransactionRecord[]> {
  try {
    const rows = await query<{
      id: string;
      timestamp: Date;
      hash: string;
      input_amount: string;
      input_asset: string;
      output_amount: string;
      output_asset: string;
      path: string[];
      fee: string;
      fee_hash: string;
      demo_agent_address: string;
      axis_address: string;
      status: string;
      error_message: string | null;
    }>(
      `SELECT * FROM axis_transactions
       ${successOnly ? "WHERE status = 'success'" : ""}
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
      hash: r.hash,
      inputAmount: r.input_amount,
      inputAsset: r.input_asset,
      outputAmount: r.output_amount,
      outputAsset: r.output_asset,
      path: r.path,
      fee: r.fee,
      feeHash: r.fee_hash,
      demoAgentAddress: r.demo_agent_address,
      axisAddress: r.axis_address,
      status: r.status as "success" | "failed",
      errorMessage: r.error_message ?? undefined,
    }));
  } catch (err) {
    logger.error({ err }, "Failed to fetch transactions from DB");
    return [];
  }
}

export async function getNodeStats(): Promise<NodeStats> {
  try {
    const row = await query<{
      total_revenue: string;
      success_count: string;
      failed_count: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'success' THEN fee::numeric ELSE 0 END), 0)::text AS total_revenue,
         COUNT(CASE WHEN status = 'success' THEN 1 END)::text AS success_count,
         COUNT(CASE WHEN status = 'failed' THEN 1 END)::text AS failed_count
       FROM axis_transactions`,
    );
    const r = row[0];
    return {
      totalRevenue: parseFloat(r?.total_revenue ?? "0").toFixed(7),
      successCount: parseInt(r?.success_count ?? "0", 10),
      failedCount: parseInt(r?.failed_count ?? "0", 10),
      upSince,
    };
  } catch {
    return { totalRevenue: "0.0000000", successCount: 0, failedCount: 0, upSince };
  }
}
