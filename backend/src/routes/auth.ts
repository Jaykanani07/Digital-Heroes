import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { one, query } from "../config/db.js";
import { ah, badRequest, conflict, parse, unauthorized } from "../lib/errors.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { sendMail } from "../services/email.js";

export const authRouter = Router();

// Slow down credential stuffing / brute force.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });

const password = z.string().min(8, "Use at least 8 characters").max(128).regex(/[A-Za-z]/, "Include a letter").regex(/[0-9]/, "Include a number");

const PUBLIC_FIELDS = "id, email, full_name, phone, company, role, created_at";

authRouter.post(
  "/register",
  authLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        email: z.string().trim().toLowerCase().email("Enter a valid e-mail address"),
        password,
        fullName: z.string().trim().min(2, "Enter your name").max(100),
        company: z.string().trim().max(120).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
      }),
      req.body,
    );
    const exists = await one("select 1 from users where email = $1", [body.email]);
    if (exists) throw conflict("An account with that e-mail already exists. Sign in instead.");
    const hash = await bcrypt.hash(body.password, 11);
    const user = (await one(
      `insert into users (email, password_hash, full_name, company, phone) values ($1,$2,$3,$4,$5) returning ${PUBLIC_FIELDS}`,
      [body.email, hash, body.fullName, body.company || null, body.phone || null],
    ))!;
    void sendMail({
      to: user.email,
      userId: user.id,
      subject: "Welcome to Digital Heroes",
      lines: [`Hi ${user.full_name},`, "Your account is ready. Configure a product, design it in the browser and approve your proof — all in one place."],
      cta: { label: "Start a print job", path: "/products" },
    });
    res.status(201).json({ token: signToken(user), user });
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().min(1, "Enter your e-mail"), password: z.string().min(1, "Enter your password") }), req.body);
    const user = await one("select * from users where email = $1", [body.email]);
    // Same message whether the e-mail or the password is wrong.
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) throw unauthorized("E-mail or password is incorrect.");
    if (!user.is_active) throw unauthorized("This account has been deactivated. Contact us for help.");
    await query("update users set last_login_at = now() where id = $1", [user.id]);
    const { password_hash: _h, ...safe } = user;
    res.json({ token: signToken(user), user: { id: safe.id, email: safe.email, full_name: safe.full_name, phone: safe.phone, company: safe.company, role: safe.role, created_at: safe.created_at } });
  }),
);

authRouter.post(
  "/google",
  authLimiter,
  ah(async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID) throw badRequest("Google sign-in isn't configured.");
    const { credential } = parse(z.object({ credential: z.string().min(1) }), req.body);

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) throw unauthorized("Google sign-in failed. Try again.");
    const info = (await verifyRes.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
    };
    const verified = info.email_verified === true || info.email_verified === "true";
    if (info.aud !== env.GOOGLE_CLIENT_ID || !info.email || !verified) {
      throw unauthorized("Google account could not be verified.");
    }

    const email = info.email.trim().toLowerCase();
    let user = await one("select * from users where email = $1", [email]);
    if (user) {
      if (!user.is_active) throw unauthorized("This account has been deactivated. Contact us for help.");
      await query("update users set last_login_at = now() where id = $1", [user.id]);
      const { password_hash: _h, ...safe } = user;
      return res.json({ token: signToken(user), user: { id: safe.id, email: safe.email, full_name: safe.full_name, phone: safe.phone, company: safe.company, role: safe.role, created_at: safe.created_at } });
    }

    const fullName = (info.name || email.split("@")[0]).trim().slice(0, 100);
    user = (await one(
      `insert into users (email, password_hash, full_name) values ($1,$2,$3) returning ${PUBLIC_FIELDS}`,
      [email, `!google:${crypto.randomUUID()}`, fullName],
    ))!;
    void sendMail({
      to: user.email,
      userId: user.id,
      subject: "Welcome to Digital Heroes",
      lines: [`Hi ${user.full_name},`, "Your account is ready. Configure a product, design it in the browser and approve your proof — all in one place."],
      cta: { label: "Start a print job", path: "/products" },
    });
    res.status(201).json({ token: signToken(user), user });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    res.json(await one(`select ${PUBLIC_FIELDS} from users where id = $1`, [req.user!.id]));
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        fullName: z.string().trim().min(2, "Enter your name").max(100),
        company: z.string().trim().max(120).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
      }),
      req.body,
    );
    const user = await one(`update users set full_name = $2, company = $3, phone = $4 where id = $1 returning ${PUBLIC_FIELDS}`, [
      req.user!.id, body.fullName, body.company || null, body.phone || null,
    ]);
    res.json(user);
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: password }), req.body);
    const row = (await one<{ password_hash: string }>("select password_hash from users where id = $1", [req.user!.id]))!;
    if (!(await bcrypt.compare(body.currentPassword, row.password_hash))) throw badRequest("Your current password is incorrect.", { fields: { currentPassword: "Incorrect password" } });
    await query("update users set password_hash = $2 where id = $1", [req.user!.id, await bcrypt.hash(body.newPassword, 11)]);
    res.json({ ok: true });
  }),
);
