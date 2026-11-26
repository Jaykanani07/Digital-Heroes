import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { one } from "../config/db.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: "customer" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** JWT auth (§13): stateless bearer token, HTTPS enforced at the edge (Vercel). */
export function signToken(user: { id: string; role: string }): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

async function resolveUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw unauthorized("Your session has expired. Sign in again.");
  }
  // Re-read the user so role changes and deactivation take effect immediately.
  const user = await one<AuthUser & { is_active: boolean }>(
    "select id, email, full_name, role, is_active from users where id = $1",
    [payload.sub],
  );
  if (!user || !user.is_active) throw unauthorized("Your account isn't active.");
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
}

/** Requires a signed-in user (customer or admin). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Requires an administrator. */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    if (user.role !== "admin") throw forbidden("Administrators only.");
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
