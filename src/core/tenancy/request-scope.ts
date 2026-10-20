import { normalizeHostDomain } from "@/core/domain/host-config";
import type { HostConfig } from "@/core/domain/host-config";
import type { TenantRecord } from "@/core/domain/host-portal";
import type { PlatformStore } from "@/core/ports/platform-store";
import type { AccessScope } from "./scope";

type DomainLookups = Pick<
  PlatformStore,
  "getSetupState" | "getHostById" | "getHostByDomain" | "getTenantByDomain"
>;

export type ResolvedRequestScope =
  | {
      kind: "platform";
      domain: string;
      scope: Extract<AccessScope, { kind: "platform" }>;
    }
  | {
      kind: "host";
      domain: string;
      host: HostConfig;
      scope: Extract<AccessScope, { kind: "host" }>;
    }
  | {
      kind: "tenant";
      domain: string;
      host: HostConfig;
      tenant: TenantRecord;
      scope: Extract<AccessScope, { kind: "tenant" }>;
    }
  | {
      kind: "unavailable";
      domain: string;
    };

export function normalizeRequestDomain(
  hostHeader: string | null,
): string | null {
  if (!hostHeader || /[\s,/@?#\\]/.test(hostHeader)) {
    return null;
  }

  try {
    const url = new URL(`http://${hostHeader}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return normalizeHostDomain(url.hostname.replace(/\.$/, ""));
  } catch {
    return null;
  }
}

export async function resolveRequestScope(
  hostHeader: string | null,
  store: DomainLookups,
): Promise<ResolvedRequestScope | null> {
  const domain = normalizeRequestDomain(hostHeader);
  if (!domain) {
    return null;
  }

  const setupState = await store.getSetupState();
  const platformDomain = setupState.platformDomain
    ? normalizeHostDomain(setupState.platformDomain)
    : null;
  if (platformDomain === domain) {
    return {
      kind: "platform",
      domain,
      scope: { kind: "platform", id: "platform" },
    };
  }

  const tenant = await store.getTenantByDomain(domain);
  if (tenant) {
    const host = await store.getHostById(tenant.hostId);
    if (tenant.status !== "active" || !host || host.status !== "active") {
      return { kind: "unavailable", domain };
    }

    return {
      kind: "tenant",
      domain,
      host,
      tenant,
      scope: { kind: "tenant", id: tenant.id, hostId: host.id },
    };
  }

  const host = await store.getHostByDomain(domain);
  if (!host) {
    return null;
  }
  if (host.status !== "active") {
    return { kind: "unavailable", domain };
  }

  return {
    kind: "host",
    domain,
    host,
    scope: { kind: "host", id: host.id },
  };
}
