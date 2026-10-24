import "server-only";

export function createInvitationUrl(
  request: Request,
  platformDomain: string | undefined,
  path: "/en/host/accept-invite" | "/en/tenant/accept-invite",
  token: string,
): string {
  const requestUrl = new URL(request.url);
  const isLocalRequest =
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname.endsWith(".localhost") ||
    requestUrl.hostname === "127.0.0.1";
  const origin = isLocalRequest
    ? requestUrl.origin
    : platformDomain
      ? `https://${platformDomain}`
      : null;
  if (!origin) {
    throw new Error("Platform domain is unavailable for invitation links");
  }
  const inviteUrl = new URL(path, origin);
  inviteUrl.searchParams.set("token", token);
  return inviteUrl.toString();
}
