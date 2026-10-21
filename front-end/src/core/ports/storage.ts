import type { Paginated } from "./data";

export type FileMeta = {
  tenantId: string;
  fileName: string;
  contentType: string;
  size: number;
};

export type StoredFile = {
  key: string;
  url: string;
  contentType: string;
  size: number;
};

export type UploadTarget =
  | {
      mode: "presigned";
      url: string;
      fields?: Record<string, string>;
      key: string;
    }
  | { mode: "server-proxy"; key: string };

export type StorageCapabilities = {
  presignedUploads: boolean;
  publicCdn: boolean;
  imageTransforms: boolean;
  oauth: boolean;
};

export interface StoragePort {
  capabilities: StorageCapabilities;
  prepareUpload(file: FileMeta): Promise<UploadTarget>;
  upload?(
    key: string,
    data: ReadableStream<Uint8Array>,
    meta: FileMeta,
  ): Promise<StoredFile>;
  getPublicUrl(
    key: string,
    options?: { width?: number; format?: string },
  ): string;
  delete(key: string): Promise<void>;
  list?(prefix: string, cursor?: string): Promise<Paginated<StoredFile>>;
  healthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    details?: string;
  }>;
}
