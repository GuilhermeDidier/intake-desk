// Applies the numbered migrations with the owner's connection, without touching the app role's password.
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

(async () => {
  const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const f of readdirSync("db").filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    await c.query(readFileSync(`db/${f}`, "utf8"));
    console.log("applied", f);
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
