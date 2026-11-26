import nodemailer from "nodemailer";
import { env, siteUrl } from "../config/env.js";
import { query } from "../config/db.js";

/**
 * E-mail notifications (§13): order updates, proof status, completion alerts.
 * With SMTP configured the mail is sent; otherwise it is printed to the
 * console. Either way it is recorded in the `notifications` table.
 */
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

interface Mail {
  to: string;
  subject: string;
  /** Plain paragraphs; rendered into a simple branded HTML layout. */
  lines: string[];
  cta?: { label: string; path: string };
  userId?: string | null;
  orderId?: string | null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function render(mail: Mail) {
  const url = mail.cta ? `${siteUrl}${mail.cta.path}` : null;
  const text = [...mail.lines, url ? `${mail.cta!.label}: ${url}` : "", "", "— Digital Heroes"].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#141414">
  <div style="background:#141414;color:#F2C230;padding:16px 20px;font-weight:bold;letter-spacing:.04em">DIGITAL HEROES</div>
  <div style="padding:20px;background:#F4F4F1;border:1px solid #D7D8D3">
    ${mail.lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(l)}</p>`).join("")}
    ${url ? `<p style="margin:20px 0 0"><a href="${url}" style="background:#F2C230;color:#141414;padding:10px 16px;text-decoration:none;font-weight:bold;border:2px solid #141414">${escapeHtml(mail.cta!.label)}</a></p>` : ""}
  </div></div>`;
  return { text, html };
}

/** Sends (or logs) an e-mail. Never throws — notifications must not break order flow. */
export async function sendMail(mail: Mail): Promise<void> {
  const { text, html } = render(mail);
  let status: "sent" | "logged" | "failed" = "logged";
  let error: string | null = null;
  try {
    if (transporter) {
      await transporter.sendMail({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text, html });
      status = "sent";
    } else {
      console.log(`\n[email] To: ${mail.to}\n[email] Subject: ${mail.subject}\n${text}\n`);
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", error);
  }
  try {
    await query(
      `insert into notifications (user_id, order_id, to_email, subject, body, status, error)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [mail.userId ?? null, mail.orderId ?? null, mail.to, mail.subject, text, status, error],
    );
  } catch (e) {
    console.error("[email] could not log notification:", e);
  }
}

/** Notifies the production team, if an address is configured. */
export async function notifyAdmin(subject: string, lines: string[], orderId?: string, path?: string) {
  if (!env.ADMIN_NOTIFY_EMAIL) return;
  await sendMail({ to: env.ADMIN_NOTIFY_EMAIL, subject, lines, orderId, cta: path ? { label: "Open job", path } : undefined });
}
