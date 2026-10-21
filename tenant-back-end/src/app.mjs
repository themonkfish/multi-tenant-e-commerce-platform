import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  InputError,
  parseProductInput,
  parseProductUpdate,
} from "./product-schema.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(
          Object.assign(new Error("Request body is too large"), {
            status: 413,
          }),
        );
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function authenticatedTenant(request, tenantApiKeys) {
  const supplied = request.headers["x-api-key"];
  if (typeof supplied !== "string" || supplied.length === 0) return null;
  const suppliedBytes = Buffer.from(supplied);

  for (const [tenantId, apiKey] of tenantApiKeys) {
    const expectedBytes = Buffer.from(apiKey);
    if (
      suppliedBytes.length === expectedBytes.length &&
      timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      return tenantId;
    }
  }
  return null;
}

function validateProductId(id) {
  return typeof id === "string" && PRODUCT_ID_PATTERN.test(id);
}

function parsePagination(url) {
  const pageText = url.searchParams.get("page") ?? "1";
  const limitText = url.searchParams.get("limit") ?? "20";
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) return null;
  const page = Number(pageText);
  const limit = Number(limitText);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger((page - 1) * limit)
  ) {
    return null;
  }
  return { page, limit };
}

function isUniqueConstraintError(error) {
  return (
    error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE" || error.errcode === 2067
  );
}

export function createTenantApiServer({ tenantApiKeys, repository }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const match = url.pathname.match(/^\/v1\/products(?:\/([^/]+))?$/);

      if (url.pathname === "/v1/health") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        if (!authenticatedTenant(request, tenantApiKeys)) {
          sendJson(response, 401, { error: "unauthorized" });
          return;
        }
        try {
          const database = repository.health();
          sendJson(response, 200, {
            status: "healthy",
            db: database.status,
            storage: "up",
            schemaVersion: database.schemaVersion,
          });
        } catch {
          sendJson(response, 503, {
            status: "unhealthy",
            db: "down",
            storage: "up",
          });
        }
        return;
      }

      if (!match) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      const tenantId = authenticatedTenant(request, tenantApiKeys);
      if (!tenantId) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      const productId = match[1];
      if (productId !== undefined && !validateProductId(productId)) {
        sendJson(response, 400, { error: "invalid_product_id" });
        return;
      }

      if (request.method === "GET" && productId === undefined) {
        const requestedTenant = url.searchParams.get("tenantId");
        const pagination = parsePagination(url);
        if (requestedTenant !== tenantId) {
          sendJson(response, 403, { error: "tenant_scope_mismatch" });
          return;
        }
        if (!pagination) {
          sendJson(response, 400, { error: "invalid_pagination" });
          return;
        }
        sendJson(
          response,
          200,
          repository.listProducts({ tenantId, ...pagination }),
        );
        return;
      }

      if (request.method === "GET" && productId !== undefined) {
        const product = repository.getProduct(tenantId, productId);
        if (!product) {
          sendJson(response, 404, { error: "not_found" });
          return;
        }
        sendJson(response, 200, product);
        return;
      }

      if (request.method === "POST" && productId === undefined) {
        let input;
        try {
          input = parseProductInput(await readJsonBody(request));
        } catch (error) {
          sendJson(
            response,
            error instanceof InputError ? 400 : (error.status ?? 400),
            {
              error:
                error instanceof InputError
                  ? "invalid_input"
                  : error.status === 413
                    ? "payload_too_large"
                    : "invalid_json",
            },
          );
          return;
        }
        if (input.tenantId !== tenantId) {
          sendJson(response, 403, { error: "tenant_scope_mismatch" });
          return;
        }
        try {
          const product = repository.createProduct({
            ...input,
            id: randomUUID(),
            tenantId,
            now: new Date().toISOString(),
          });
          sendJson(response, 201, product);
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            sendJson(response, 409, { error: "product_slug_conflict" });
            return;
          }
          throw error;
        }
        return;
      }

      if (request.method === "PATCH" && productId !== undefined) {
        let fields;
        try {
          fields = parseProductUpdate(await readJsonBody(request));
        } catch (error) {
          sendJson(
            response,
            error instanceof InputError ? 400 : (error.status ?? 400),
            {
              error:
                error instanceof InputError
                  ? "invalid_input"
                  : error.status === 413
                    ? "payload_too_large"
                    : "invalid_json",
            },
          );
          return;
        }
        try {
          const product = repository.updateProduct(
            tenantId,
            productId,
            fields,
            new Date().toISOString(),
          );
          if (!product) {
            sendJson(response, 404, { error: "not_found" });
            return;
          }
          sendJson(response, 200, product);
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            sendJson(response, 409, { error: "product_slug_conflict" });
            return;
          }
          throw error;
        }
        return;
      }

      if (request.method === "DELETE" && productId !== undefined) {
        if (!repository.deleteProduct(tenantId, productId)) {
          sendJson(response, 404, { error: "not_found" });
          return;
        }
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      response.setHeader(
        "allow",
        productId === undefined ? "GET, POST" : "GET, PATCH, DELETE",
      );
      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      console.error("Tenant API request failed", error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "internal_server_error" });
      } else {
        response.destroy();
      }
    }
  });
}
