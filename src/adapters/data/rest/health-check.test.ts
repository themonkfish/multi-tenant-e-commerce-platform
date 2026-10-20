import { describe, expect, it } from "vitest";
import {
  buildHealthCheckUrl,
  isPublicIpAddress,
  validateRestBaseUrl,
} from "./health-check";

describe("REST backend health-check address validation", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.51.100.10",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "3fff::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("allows public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it("accepts only a credential-free HTTPS origin on the standard port", () => {
    expect(validateRestBaseUrl("https://api.example.com")).not.toBeNull();
    expect(validateRestBaseUrl("https://api.example.com:443")).not.toBeNull();
    expect(validateRestBaseUrl("http://api.example.com")).toBeNull();
    expect(validateRestBaseUrl("https://user:pass@api.example.com")).toBeNull();
    expect(validateRestBaseUrl("https://api.example.com:8443")).toBeNull();
    expect(validateRestBaseUrl("https://api.example.com/path")).toBeNull();
    expect(
      validateRestBaseUrl("https://api.example.com/?token=secret"),
    ).toBeNull();
  });

  it("builds the versioned health endpoint from validated tenant config", () => {
    const url = buildHealthCheckUrl({
      type: "rest",
      baseUrl: "https://api.example.com",
      apiVersion: "v1",
      authMode: "apiKey",
      apiKeyRef: "secret-ref",
    });
    expect(url.toString()).toBe("https://api.example.com/v1/health");
  });
});
