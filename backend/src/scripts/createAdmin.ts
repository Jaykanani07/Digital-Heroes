/**
 * npm run create-admin
 *
 * Creates (or updates) the administrator account from backend/.env:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME (optional)
 * Running it again resets that account's password and makes sure it is an
 * active admin — useful if the password is forgotten.
 */
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { pool } from "../config/db.js";

async function main() {
  const email = env.ADMIN_EMAIL?.toLowerCase();
  const password = env.ADMIN_PASSWORD;
  const name = env.ADMIN_NAME || "Administrator";
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env first.");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("ADMIN_EMAIL isn't a valid e-mail address.");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");

  const hash = await bcrypt.hash(password, 11);
  const { rows } = await pool.query(
    `insert into users (email, password_hash, full_name, role, is_active)
     values ($1, $2, $3, 'admin', true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', is_active = true,
       full_name = excluded.full_name
     returning (xmax = 0) as created`,
    [email, hash, name],
  );
  console.log(rows[0].created ? `Admin created: ${email}` : `Admin updated (password reset): ${email}`);
  console.log("Sign in at /login with these credentials — you'll land in the admin console.");
}

main()
  .catch((e) => {
    console.error("create-admin failed:", e.message);
    if (/relation "users" does not exist/.test(e.message)) console.error("Run `npm run db:migrate` first.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
