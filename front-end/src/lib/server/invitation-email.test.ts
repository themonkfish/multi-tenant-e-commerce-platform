import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendInvitationEmail } from "./invitation-email";

describe("sendInvitationEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("leaves manual delivery available when no provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("INVITATION_EMAIL_FROM", "");

    await expect(
      sendInvitationEmail({
        role: "host_owner",
        to: "owner@example.com",
        inviteUrl:
          "https://platform.example.com/en/host/accept-invite?token=abc",
        expiresAt: "2026-10-25T12:00:00.000Z",
      }),
    ).resolves.toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a role-specific invitation through Resend", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("INVITATION_EMAIL_FROM", "Platform <noreply@example.com>");

    const inviteUrl =
      "https://platform.example.com/en/tenant/accept-invite?token=abc&next=%22";
    await expect(
      sendInvitationEmail({
        role: "tenant_owner",
        to: "owner@example.com",
        inviteUrl,
        expiresAt: "2026-10-25T12:00:00.000Z",
      }),
    ).resolves.toBe("sent");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer resend-test-key",
          "Content-Type": "application/json",
        },
        body: expect.stringContaining(
          '"subject":"Your tenant owner invitation"',
        ),
      }),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.text).toContain(inviteUrl);
    expect(payload.html).toContain("&amp;next=%22");
  });

  it("reports provider failures so the caller can show the fallback link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("INVITATION_EMAIL_FROM", "noreply@example.com");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendInvitationEmail({
        role: "host_owner",
        to: "owner@example.com",
        inviteUrl: "https://platform.example.com/invite?token=abc",
        expiresAt: "2026-10-25T12:00:00.000Z",
      }),
    ).resolves.toBe("failed");
    expect(error).toHaveBeenCalledWith(
      "Invitation email provider rejected the message",
      { role: "host_owner", status: 503 },
    );
  });
});
