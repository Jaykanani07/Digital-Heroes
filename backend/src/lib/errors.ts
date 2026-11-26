import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Sign in to continue.") => new HttpError(401, msg);
export const forbidden = (msg = "You don't have access to this.") => new HttpError(403, msg);
export const notFound = (msg = "Not found.") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Wraps an async route so rejected promises reach the error handler. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Parses `data` with a zod schema or throws a 400 with per-field messages. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join(".") || "_"] = i.message;
    throw new HttpError(400, Object.values(fields)[0] || "Invalid input.", { fields });
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const e = err as { code?: string; type?: string };
  if (e?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "That file is too large (max 4 MB)." });
    return;
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: "Request is too large." });
    return;
  }
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body." });
    return;
  }
  if (e?.code === "22P02") {
    res.status(404).json({ error: "Not found." }); // invalid uuid in a path parameter
    return;
  }
  if (e?.code === "23505") {
    res.status(409).json({ error: "That already exists." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
}
