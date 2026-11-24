// Outgoing email (2FA codes and other account notifications).
//
// Sends through Resend's HTTP API with Node's built-in fetch (no extra dependency).
// Railway blocks outbound SMTP on its Free/Hobby plans, so an HTTP email API is used
// instead of SMTP.
//
// Railway variables (Node service):
//   RESEND_API_KEY   API key from https://resend.com/api-keys
//   MAIL_FROM        sender, e.g. "Libra Logger <no-reply@yourdomain.com>".
//                    The domain must be verified in Resend. Without a verified domain,
//                    "Libra Logger <onboarding@resend.dev>" works but Resend only
//                    delivers it to the email address that owns the Resend account.
//
// Local development: if RESEND_API_KEY isn't set and the server isn't running on
// Railway, emails are printed to the server console instead of being sent.

const { HttpError } = require("./errors");

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Libra Logger <onboarding@resend.dev>";

const onRailway = () => Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Sends one email. `text` is required; `html` is optional (built from text if missing).
 * Throws HttpError(503) if email isn't set up, HttpError(502) if the provider rejects it.
 */
async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (onRailway()) throw new HttpError(503, "Email isn't set up on this server yet, so codes can't be sent.");
    console.log(`\n----- Email (not sent: RESEND_API_KEY isn't set) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n------------------------------------------------------\n`);
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to: [to],
      subject,
      text,
      html: html || `<p>${escapeHtml(text).replace(/\n/g, "<br />")}</p>`,
    }),
  }).catch((err) => {
    console.error("Email request failed:", err.message);
    return null;
  });

  if (!res || !res.ok) {
    const body = res ? await res.text().catch(() => "") : "";
    console.error("Email provider rejected the message:", res && res.status, body);
    throw new HttpError(502, "We couldn't send the email. Please try again in a moment.");
  }
}

/** Email containing a one-time 2FA code. purpose: "ENABLE" | "LOGIN". */
function sendCodeEmail(to, code, purpose, minutes) {
  const intro =
    purpose === "ENABLE"
      ? "Use this code to finish turning on two-factor authentication for your Libra Logger account:"
      : "Use this code to finish logging in to Libra Logger:";
  const outro =
    purpose === "ENABLE"
      ? "If you didn't ask to turn on two-factor authentication, you can ignore this email."
      : "If you didn't just try to log in, someone may know your password. Change it in Settings.";
  const subject = purpose === "ENABLE" ? "Your Libra Logger 2FA setup code" : "Your Libra Logger login code";

  const text = `${intro}\n\n${code}\n\nThis code expires in ${minutes} minutes.\n\n${outro}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h2 style="margin:0 0 16px;color:#154734">Libra Logger</h2>
      <p>${escapeHtml(intro)}</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#e87500">${code}</p>
      <p>This code expires in ${minutes} minutes.</p>
      <p style="color:#666;font-size:13px">${escapeHtml(outro)}</p>
    </div>`;
  return sendEmail({ to, subject, text, html });
}

module.exports = { sendEmail, sendCodeEmail };
