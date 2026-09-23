import { Pool, type QueryResultRow } from "pg";

// One small pool per server instance. Every query names the intake schema explicitly,
// so nothing depends on the connection's search_path (transaction poolers reset it).
const globalForPool = globalThis as unknown as { intakePool?: Pool };

function pool(): Pool {
  if (!globalForPool.intakePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPool.intakePool = new Pool({
      connectionString,
      max: 3,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPool.intakePool;
}

export async function q<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function tx<T>(fn: (query: typeof q) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
