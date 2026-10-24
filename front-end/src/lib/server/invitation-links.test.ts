import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInvitationUrl } from "./invitation-links";

describe("createInvitationUrl", () => {
  it("uses the configured platform domain instead of the request host", () => {
    const request = new Request("https://attacker.example/api/invite", {
      headers: { host: "attacker.example" },
    });

    expect(
      createInvitationUrl(
        request,
        "platform.example.com",
        "/en/host/accept-invite",
        "one-time-token",
      ),
    ).toBe(
      "https://platform.example.com/en/host/accept-invite?token=one-time-token",
    );
  });

  it("preserves the local development origin", () => {
    const request = new Request(
      "http://store.localhost:3000/api/host/tenants/invite",
    );

    expect(
      createInvitationUrl(
        request,
        "platform.example.com",
        "/en/tenant/accept-invite",
        "one-time-token",
      ),
    ).toBe(
      "http://store.localhost:3000/en/tenant/accept-invite?token=one-time-token",
    );
  });

  it("fails rather than building production links from an untrusted host", () => {
    const request = new Request("https://attacker.example/api/invite");

    expect(() =>
      createInvitationUrl(
        request,
        undefined,
        "/en/host/accept-invite",
        "one-time-token",
      ),
    ).toThrow("Platform domain is unavailable for invitation links");
  });
});
