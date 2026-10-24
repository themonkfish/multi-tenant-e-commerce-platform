import { NextResponse } from "next/server";
import { createTenantStorageAdapter } from "@/adapters/storage/tenant-storage-provider";
import {
  MAX_UPLOAD_BYTES,
  validateImageContent,
  validateUploadMeta,
} from "@/adapters/storage/s3/upload-validation";
import { canAccessPermission } from "@/core/tenancy/scope";
import { createRateLimitKey, isSameOrigin } from "@/lib/server/http";
import { getPlatformStore } from "@/lib/server/platform";
import { getTenantPortalSession } from "@/lib/server/session";

const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;

async function readBoundedBody(request: Request): Promise<Buffer> {
  if (!request.body) throw new Error("Upload body is required");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("Upload request exceeded its size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function POST(request: Request) {
  const session = await getTenantPortalSession();
  if (!session || session.scope.kind !== "tenant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canAccessPermission(session, "catalog:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return NextResponse.json(
      { error: "multipart_form_required" },
      { status: 415 },
    );
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "upload_too_large" }, { status: 413 });
  }

  const store = getPlatformStore();
  const allowed = await store.consumeRateLimit({
    key: createRateLimitKey(request, "tenant-storage-upload", session.userId),
    limit: 30,
    windowMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    const bytes = await readBoundedBody(request);
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: Uint8Array.from(bytes),
    }).formData();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid upload request";
    return NextResponse.json(
      {
        error:
          message === "Upload request exceeded its size limit"
            ? "upload_too_large"
            : "invalid_upload",
      },
      {
        status:
          message === "Upload request exceeded its size limit" ? 413 : 400,
      },
    );
  }
  const entries = Array.from(form.entries());
  const file = form.get("file");
  if (entries.length !== 1 || !(file instanceof File)) {
    return NextResponse.json(
      { error: "a_single_file_is_required" },
      { status: 400 },
    );
  }

  const meta = {
    tenantId: session.scope.id,
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  };
  let validatedMeta;
  let bytes: Buffer;
  try {
    validatedMeta = validateUploadMeta(meta);
    bytes = Buffer.from(await file.arrayBuffer());
    validateImageContent(bytes, validatedMeta.contentType);
  } catch {
    return NextResponse.json(
      { error: "unsupported_or_invalid_image" },
      { status: 400 },
    );
  }

  try {
    const adapter = await createTenantStorageAdapter(
      session.scope.id,
      session.scope.hostId,
    );
    const target = await adapter.prepareUpload(validatedMeta);
    if (target.mode !== "server-proxy") {
      throw new Error("Storage adapter returned an unsupported upload mode");
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const stored = await adapter.upload(target.key, stream, validatedMeta);
    return NextResponse.json({ file: stored }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Tenant storage provider is not configured"
    ) {
      return NextResponse.json(
        { error: "storage_not_configured" },
        { status: 409 },
      );
    }
    console.error("Tenant image upload failed", {
      tenantId: session.scope.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "storage_upload_failed" },
      { status: 502 },
    );
  }
}
