import "dotenv/config";
import { z } from "zod";

/**
 * All configuration comes from environment variables (never committed).
 * Validated once at startup so a misconfigured deploy fails fast.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  // Postgres connection string (Supabase → Project settings → Database)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DB_SSL: optional,

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  GOOGLE_CLIENT_ID: optional,

  // Supabase Storage for files. Without these, files go to ./storage (local dev only).
  SUPABASE_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  STORAGE_BUCKET: z.string().default("print-files"),

  // Stripe. Without a secret key the platform runs in TEST PAYMENT mode.
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  // E-mail. Without SMTP settings e-mails are logged to the console + notifications table.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: z.string().default("Digital Heroes <no-reply@digitalheroes.co.in>"),
  ADMIN_NOTIFY_EMAIL: optional,

  VAT_RATE: z.coerce.number().min(0).max(1).default(0.18),
  CURRENCY: z.string().default("INR"),

  // Used only by `npm run create-admin`
  ADMIN_EMAIL: optional,
  ADMIN_PASSWORD: optional,
  ADMIN_NAME: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  console.error("Copy backend/.env.example to backend/.env and fill it in.");
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const paymentsMode: "stripe" | "test" = env.STRIPE_SECRET_KEY ? "stripe" : "test";
export const frontendOrigins = env.FRONTEND_URL.split(",").map((s) => s.trim().replace(/\/$/, ""));
/** Public URL of the storefront, used in e-mails and Stripe redirects. */
export const siteUrl = frontendOrigins[0];
