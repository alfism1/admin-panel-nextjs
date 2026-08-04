import "server-only";

import { env } from "@/lib/env";
import { getLogger } from "@/lib/logger";

/**
 * Transactional e-mail.
 *
 * Two transports ship:
 *  - `console` (default) writes the full message, including any action link, to
 *    the server log. This is a real transport, not a stub: it is what makes
 *    `pnpm dev` usable with no mail provider — the verification link is right
 *    there in the terminal.
 *  - `resend` posts to the Resend HTTP API. No SDK dependency; it's one fetch.
 *
 * To add SES/Postmark/SMTP, implement `MailTransport` and register it in
 * `transports` below. Nothing outside this file needs to change.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

type MailTransport = (message: MailMessage) => Promise<void>;

const consoleTransport: MailTransport = async (message) => {
  getLogger({ transport: "console" }).info(
    { to: message.to, subject: message.subject },
    `\n─── mail ───────────────────────────────────────────\nTo:      ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n────────────────────────────────────────────────────`,
  );
};

const resendTransport: MailTransport = async (message) => {
  if (!env.RESEND_API_KEY) {
    throw new Error("MAIL_TRANSPORT=resend requires RESEND_API_KEY to be set.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Resend rejected the message (${response.status}): ${body}`,
    );
  }
};

const transports: Record<typeof env.MAIL_TRANSPORT, MailTransport> = {
  console: consoleTransport,
  resend: resendTransport,
};

export async function sendMail(message: MailMessage): Promise<void> {
  const log = getLogger({ to: message.to, subject: message.subject });
  try {
    await transports[env.MAIL_TRANSPORT](message);
  } catch (error) {
    // A failed e-mail must never break the request that triggered it — a user
    // who can't be sent a verification link can still request another one.
    log.error({ err: error }, "failed to send mail");
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function layout(
  heading: string,
  body: string,
  action?: { url: string; label: string },
) {
  const text = [
    heading,
    "",
    body,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    "",
    "If you weren't expecting this e-mail you can safely ignore it.",
  ].join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#171717">
  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 24px">${escapeHtml(body)}</p>
  ${
    action
      ? `<p style="margin:0 0 24px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${escapeHtml(action.label)}</a></p>
  <p style="font-size:12px;color:#737373;margin:0 0 24px;word-break:break-all">${escapeHtml(action.url)}</p>`
      : ""
  }
  <p style="font-size:12px;color:#737373;margin:0">If you weren't expecting this e-mail you can safely ignore it.</p>
</div>`.trim();

  return { text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function verificationEmail(url: string): Omit<MailMessage, "to"> {
  const { text, html } = layout(
    "Confirm your e-mail address",
    "Click the button below to verify your address and finish setting up your account. The link expires in one hour.",
    { url, label: "Verify e-mail" },
  );
  return { subject: "Verify your e-mail address", text, html };
}

export function resetPasswordEmail(url: string): Omit<MailMessage, "to"> {
  const { text, html } = layout(
    "Reset your password",
    "Someone requested a password reset for your account. The link expires in one hour and can be used once.",
    { url, label: "Choose a new password" },
  );
  return { subject: "Reset your password", text, html };
}

export function passwordChangedEmail(): Omit<MailMessage, "to"> {
  const { text, html } = layout(
    "Your password was changed",
    "The password on your account was just changed. If this wasn't you, reset it immediately and review your active sessions.",
  );
  return { subject: "Your password was changed", text, html };
}
