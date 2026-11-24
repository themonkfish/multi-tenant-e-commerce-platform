import "server-only";
import { getServerEnv } from "@/lib/server/env";

const VERCEL_API = "https://api.vercel.com";

type VercelVerification = {
  type?: string;
  name?: string;
  value?: string;
  reason?: string;
};

type VercelDomainResult = {
  name?: string;
  verified?: boolean;
  verification?: VercelVerification[];
  error?: { code?: string; message?: string };
};

export type VercelDomainStatus = {
  configured: boolean;
  attached: boolean;
  verified: boolean;
  status: "manual" | "configured" | "pending" | "verified" | "error";
  verification: VercelVerification[];
};

function vercelConfig() {
  const env = getServerEnv();
  if (!env.VERCEL_ACCESS_TOKEN || !env.VERCEL_PROJECT_ID) {
    return null;
  }
  return {
    token: env.VERCEL_ACCESS_TOKEN,
    projectId: env.VERCEL_PROJECT_ID,
    teamId: env.VERCEL_TEAM_ID,
  };
}

function teamQuery(teamId?: string) {
  return teamId
    ? `?teamId=${encodeURIComponent(teamId)}`
    : "";
}

async function vercelRequest(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; body: VercelDomainResult }> {
  const config = vercelConfig();
  if (!config) {
    throw new Error("vercel_domain_not_configured");
  }
  const response = await fetch(`${VERCEL_API}${path}${teamQuery(config.teamId)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as VercelDomainResult;
  return { response, body };
}

export async function attachVercelDomain(
  domain: string,
): Promise<VercelDomainStatus> {
  const config = vercelConfig();
  if (!config) {
    return {
      configured: false,
      attached: false,
      verified: false,
      status: "manual",
      verification: [],
    };
  }
  const { response, body } = await vercelRequest(
    `/v10/projects/${encodeURIComponent(config.projectId)}/domains`,
    {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    },
  );
  if (!response.ok) {
    if (body.error?.code === "domain_already_exists") {
      return getVercelDomainStatus(domain);
    }
    throw new Error(body.error?.message ?? "vercel_domain_attach_failed");
  }
  return {
    configured: true,
    attached: true,
    verified: Boolean(body.verified),
    status: body.verified ? "verified" : "pending",
    verification: body.verification ?? [],
  };
}

export async function getVercelDomainStatus(
  domain: string,
): Promise<VercelDomainStatus> {
  const config = vercelConfig();
  if (!config) {
    return {
      configured: false,
      attached: false,
      verified: false,
      status: "manual",
      verification: [],
    };
  }
  const { response, body } = await vercelRequest(
    `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(domain)}`,
    { method: "GET" },
  );
  if (response.status === 404) {
    return {
      configured: true,
      attached: false,
      verified: false,
      status: "pending",
      verification: [],
    };
  }
  if (!response.ok) {
    throw new Error(body.error?.message ?? "vercel_domain_status_failed");
  }
  return {
    configured: true,
    attached: true,
    verified: Boolean(body.verified),
    status: body.verified ? "verified" : "pending",
    verification: body.verification ?? [],
  };
}

export async function removeVercelDomain(
  domain: string,
): Promise<{ configured: boolean; removed: boolean }> {
  const config = vercelConfig();
  if (!config) {
    return { configured: false, removed: false };
  }
  const { response, body } = await vercelRequest(
    `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(domain)}`,
    { method: "DELETE" },
  );
  if (response.status === 404) {
    return { configured: true, removed: false };
  }
  if (!response.ok) {
    throw new Error(body.error?.message ?? "vercel_domain_remove_failed");
  }
  return { configured: true, removed: true };
}
