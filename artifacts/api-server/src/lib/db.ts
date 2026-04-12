import { Pool } from "pg";
import { logger } from "./logger";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — cannot connect to PostgreSQL");
    }
    _pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });
    _pool.on("error", (err) => {
      logger.error({ err }, "Unexpected PostgreSQL pool error");
    });
    logger.info("PostgreSQL pool created");
  }
  return _pool;
}

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const pool = getPool();
  await pool.query(sql, params);
}
