import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { frontendOrigins, isProd } from "./config/env.js";
import { ah, errorHandler, notFound } from "./lib/errors.js";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { customerRouter } from "./routes/customer.js";
import { adminRouter } from "./routes/admin.js";
import { handleWebhook } from "./services/payments.js";

export const app = express();

app.set("trust proxy", 1); // behind Vercel / a proxy: real client IPs for rate limiting + approval logs
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server (no Origin) and the configured storefront(s)
      if (!origin || frontendOrigins.includes(origin.replace(/\/$/, ""))) return cb(null, true);
      cb(null, false);
    },
    exposedHeaders: ["X-Design-Issues", "Content-Disposition"],
  }),
);
app.use(morgan(isProd ? "combined" : "dev"));

// Stripe needs the raw body to verify the signature — mount before express.json().
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  ah(async (req, res) => {
    await handleWebhook(req.body as Buffer, req.headers["stripe-signature"] as string | undefined);
    res.json({ received: true });
  }),
);

app.use(express.json({ limit: "2mb" }));

app.use("/api", publicRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api", customerRouter);

app.use((_req, _res, next) => next(notFound("No such endpoint.")));
app.use(errorHandler);
