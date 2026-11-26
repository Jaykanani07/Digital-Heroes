/**
 * npm run db:migrate — applies supabase/schema.sql to DATABASE_URL.
 * The schema is idempotent, so this is safe to run repeatedly.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const file = fileURLToPath(new URL("../../supabase/schema.sql", import.meta.url));

async function main() {
  const sql = fs.readFileSync(file, "utf8");
  console.log("Applying supabase/schema.sql …");
  await pool.query(sql);
  const { rows } = await pool.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  console.log(`Done. ${rows[0].n} tables in the public schema.`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
