import type { StorageProviderConfig } from "@/core/domain/tenant-config";
import type { StoragePort } from "@/core/ports/storage";

export type StorageAdapterFactory = (
  config: StorageProviderConfig,
) => StoragePort;

export function createStorageAdapterFactory(
  adapters: Partial<Record<StorageProviderConfig["type"], StoragePort>>,
): StorageAdapterFactory {
  return (config) => {
    const adapter = adapters[config.type];

    if (!adapter) {
      throw new Error(`Storage adapter "${config.type}" is not configured`);
    }

    return adapter;
  };
}
