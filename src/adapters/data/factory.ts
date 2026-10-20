import type { DataProviderConfig } from "@/core/domain/tenant-config";
import type { CatalogPort } from "@/core/ports/data";

export type DataAdapterFactory = (config: DataProviderConfig) => CatalogPort;

export function createDataAdapterFactory(
  adapters: Partial<Record<DataProviderConfig["type"], CatalogPort>>,
): DataAdapterFactory {
  return (config) => {
    const adapter = adapters[config.type];

    if (!adapter) {
      throw new Error(`Data adapter "${config.type}" is not configured`);
    }

    return adapter;
  };
}
