import type { HostConfig } from "@/core/domain/host-config";
import type { TenantRecord } from "@/core/domain/host-portal";

export interface HostConfigurationStore {
  getHostById(id: string): Promise<HostConfig | null>;
  getHostByDomain(domain: string): Promise<HostConfig | null>;
}

export interface TenantConfigurationStore {
  getTenantByDomain(domain: string): Promise<TenantRecord | null>;
}
