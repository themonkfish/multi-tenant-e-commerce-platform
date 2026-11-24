import "server-only";
import { getServerEnv } from "@/lib/server/env";

export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
  expiresAt: string;
}): Promise<"sent" | "not_configured" | "failed"> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY || !env.INVITATION_EMAIL_FROM) {
    return "not_configured";
  }
  const expiration = new Date(input.expiresAt).toUTCString();
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.INVITATION_EMAIL_FROM,
        to: [input.to],
        subject: "Reset your customer password",
        text: `Reset your customer password using this one-time link: ${input.resetUrl}\n\nThis link expires ${expiration}.`,
        html: `<p>Reset your customer password.</p><p><a href="${escapeHtml(input.resetUrl)}">Reset password</a></p><p>This one-time link expires ${escapeHtml(expiration)}.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
