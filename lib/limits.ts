import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { q } from "./db";

// The public demo pays for every model call, so each visitor gets a small daily budget
// and the whole demo has a ceiling. Visitors are counted by a salted hash, not their IP.
const PER_VISITOR = 12;
const GLOBAL = 300;

async function visitor(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return createHash("sha256").update(`${process.env.DEMO_SALT ?? ""}:${ip}`).digest("hex").slice(0, 16);
}

/** Counts one model call. Returns an error message when the budget is spent. */
export async function spendModelCall(): Promise<string | null> {
  const v = await visitor();
  const rows = await q<{ bucket: string; n: number }>(
    `insert into intake.usage_counter (bucket) values ($1), ('global')
     on conflict (bucket, day) do update set n = intake.usage_counter.n + 1
     returning bucket, n`,
    [`v:${v}`],
  );
  // Rows inserted fresh start at 0, so the stored n is the count before this call.
  const mine = rows.find((r) => r.bucket !== "global")?.n ?? 0;
  const all = rows.find((r) => r.bucket === "global")?.n ?? 0;
  if (mine >= PER_VISITOR) return `This demo allows ${PER_VISITOR} assistant runs per visitor per day. The seeded documents still work.`;
  if (all >= GLOBAL) return "The demo's daily assistant budget is spent. The seeded documents still work.";
  return null;
}
