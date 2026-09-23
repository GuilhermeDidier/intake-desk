// One-time setup: creates the intake schema and a least-privilege app role, then
// writes that role's connection string to .env.local. Needs the owner's URL in
// ADMIN_DATABASE_URL (or DATABASE_URL when run with the owner's env file).
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("Set ADMIN_DATABASE_URL");
  const admin = new Client({ connectionString: adminUrl, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  if (process.argv.includes("--fresh")) {
    // Drops only this app's schema; nothing else in the database is touched.
    await admin.query("drop schema if exists intake cascade");
    console.log("Dropped schema intake");
  }
  // Role first so migrations can grant to it; migrations are idempotent and run in name order.
  await admin.query("create schema if not exists intake");
  await admin.query(readFileSync("db/role.sql", "utf8"));
  for (const f of readdirSync("db").filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    await admin.query(readFileSync(`db/${f}`, "utf8"));
  }
  const password = randomBytes(24).toString("base64url");
  await admin.query(`alter role intake_app password '${password}'`);
  await admin.end();

  // Supabase pooler users are "<role>.<project-ref>"; port 6543 is transaction mode, right for serverless.
  const u = new URL(adminUrl);
  const ref = decodeURIComponent(u.username).split(".")[1];
  u.username = ref ? `intake_app.${ref}` : "intake_app";
  u.password = password;
  if (u.hostname.includes("pooler.supabase.com")) u.port = "6543";
  const appUrl = u.toString();

  // The pooler caches credentials for a little while after a password change.
  let app: Client | null = null;
  for (let attempt = 1; !app; attempt++) {
    const c = new Client({ connectionString: appUrl, ssl: { rejectUnauthorized: false } });
    try {
      await c.connect();
      app = c;
    } catch (e) {
      if (attempt >= 12) throw e;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  const visible = await app.query(
    `select table_schema, count(*)::int n from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema') group by 1 order by 1`,
  );
  await app.end();
  console.log("Tables visible to intake_app:", visible.rows);

  const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const lines = env.split("\n").filter((l) => l && !l.startsWith("DATABASE_URL=") && !l.startsWith("DEMO_SALT="));
  lines.push(`DATABASE_URL=${appUrl}`, `DEMO_SALT=${randomBytes(16).toString("hex")}`);
  writeFileSync(".env.local", lines.join("\n") + "\n", { mode: 0o600 });
  console.log("Wrote DATABASE_URL for intake_app to .env.local");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
