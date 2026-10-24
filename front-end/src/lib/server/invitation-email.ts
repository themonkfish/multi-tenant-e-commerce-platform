import "server-only";
import { getServerEnv } from "@/lib/server/env";

export type InvitationRole = "host_owner" | "tenant_owner";
export type InvitationEmailStatus = "sent" | "not_configured" | "failed";

export async function sendInvitationEmail(input: {
  role: InvitationRole;
  to: string;
  inviteUrl: string;
  expiresAt: string;
}): Promise<InvitationEmailStatus> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY && !env.INVITATION_EMAIL_FROM) {
    return "not_configured";
  }
  if (!env.RESEND_API_KEY || !env.INVITATION_EMAIL_FROM) {
    console.error("Invitation email configuration is incomplete");
    return "failed";
  }

  const roleName = input.role === "host_owner" ? "Host owner" : "Tenant owner";
  const expiration = new Date(input.expiresAt).toUTCString();
  const htmlUrl = escapeHtml(input.inviteUrl);
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.INVITATION_EMAIL_FROM,
        to: [input.to],
        subject: `Your ${roleName.toLowerCase()} invitation`,
        text: `You have been invited to become a ${roleName}. Accept your invitation using this one-time link: ${input.inviteUrl}\n\nThis link expires ${expiration}.`,
        html: `<p>You have been invited to become a ${roleName}.</p><p><a href="${htmlUrl}">Accept your invitation</a></p><p>This one-time link expires ${escapeHtml(expiration)}.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("Invitation email request failed", {
      role: input.role,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }

  if (!response.ok) {
    console.error("Invitation email provider rejected the message", {
      role: input.role,
      status: response.status,
    });
    return "failed";
  }
  return "sent";
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
