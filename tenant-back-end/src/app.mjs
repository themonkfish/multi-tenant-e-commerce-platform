import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  InputError,
  parseProductInput,
  parseProductUpdate,
} from "./product-schema.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN =
  /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;
const ORDER_ID_PATTERN =
  /^ORD-[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ORDER_STATUSES = new Set([
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
]);
const ORDER_STATUS_TRANSITIONS = {
  Confirmed: new Set(["Confirmed", "Processing", "Cancelled"]),
  Processing: new Set(["Processing", "Shipped"]),
  Shipped: new Set(["Shipped", "Delivered"]),
  Delivered: new Set(["Delivered"]),
  Cancelled: new Set(["Cancelled"]),
};

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

function parseOrderFulfillment(input) {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        !["carrier", "trackingNumber", "trackingUrl", "labelUrl"].includes(
          key,
        ),
    ) ||
    typeof input.trackingNumber !== "string" ||
    input.trackingNumber.trim().length < 1 ||
    input.trackingNumber.length > 120 ||
    (input.carrier !== undefined &&
      (typeof input.carrier !== "string" ||
        input.carrier.trim().length < 1 ||
        input.carrier.length > 80)) ||
    (input.trackingUrl !== undefined &&
      (typeof input.trackingUrl !== "string" ||
        input.trackingUrl.length > 2048))
  ) {
    throw new InputError("Order fulfillment fields are invalid");
  }
  if (input.trackingUrl !== undefined) {
    let url;
    try {
      url = new URL(input.trackingUrl);
      if (url.protocol !== "https:") {
        throw new Error("Tracking URL must use HTTPS");
      }
    } catch {
      throw new InputError("Order tracking URL is invalid");
    }
  }
  if (input.labelUrl !== undefined) {
    let url;
    try {
      url = new URL(input.labelUrl);
      if (url.protocol !== "https:") {
        throw new Error("Label URL must use HTTPS");
      }
    } catch {
      throw new InputError("Order label URL is invalid");
    }
  }
  return {
    ...(input.carrier !== undefined ? { carrier: input.carrier.trim() } : {}),
    trackingNumber: input.trackingNumber.trim(),
    ...(input.trackingUrl !== undefined
      ? { trackingUrl: input.trackingUrl }
      : {}),
    ...(input.labelUrl !== undefined ? { labelUrl: input.labelUrl } : {}),
  };
}

function parseOrder(input, tenantId) {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "id",
          "tenantId",
          "customerId",
          "status",
          "createdAt",
          "items",
          "subtotal",
          "shippingAmount",
          "discountCode",
          "discountAmount",
          "taxRateBasisPoints",
          "taxAmount",
          "total",
          "currency",
          "itemCount",
          "paymentMethod",
          "deliveryAddress",
        ].includes(key),
    )
  ) {
    throw new InputError("Order must be a supported JSON object");
  }
  if (input.tenantId !== tenantId) {
    throw Object.assign(new InputError("Order tenant does not match API key"), {
      status: 403,
    });
  }
  if (
    typeof input.id !== "string" ||
    !ORDER_ID_PATTERN.test(input.id) ||
    typeof input.customerId !== "string" ||
    !UUID_PATTERN.test(input.customerId) ||
    input.status !== "Confirmed" ||
    typeof input.createdAt !== "string" ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 20 ||
    !Number.isSafeInteger(input.total) ||
    input.total < 0 ||
    typeof input.currency !== "string" ||
    !CURRENCY_PATTERN.test(input.currency) ||
    !Number.isSafeInteger(input.itemCount) ||
    input.itemCount < 1 ||
    input.itemCount > 100
  ) {
    throw new InputError("Order fields are invalid");
  }

  let computedTotal = 0;
  let computedItemCount = 0;
  const items = input.items.map((item) => {
    const validSelections =
      item?.variantSelections === undefined ||
      (typeof item.variantSelections === "object" &&
        item.variantSelections !== null &&
        !Array.isArray(item.variantSelections) &&
        Object.keys(item.variantSelections).length <= 3 &&
        Object.entries(item.variantSelections).every(
          ([name, value]) =>
            name.trim().length > 0 &&
            name.trim().length <= 40 &&
            typeof value === "string" &&
            value.trim().length > 0 &&
            value.trim().length <= 40,
        ));
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          ![
            "productId",
            "title",
            "slug",
            "quantity",
            "variantSelections",
            "sku",
            "inventoryTracked",
            "unitPrice",
            "currency",
          ].includes(key),
      ) ||
      typeof item.productId !== "string" ||
      !PRODUCT_ID_PATTERN.test(item.productId) ||
      typeof item.title !== "string" ||
      item.title.trim().length < 1 ||
      item.title.length > 200 ||
      typeof item.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100 ||
      !Number.isSafeInteger(item.unitPrice) ||
      item.unitPrice < 0 ||
      item.currency !== input.currency ||
      !validSelections ||
      (item.sku !== undefined &&
        (typeof item.sku !== "string" ||
          item.sku.trim().length < 1 ||
          item.sku.length > 100)) ||
      (item.inventoryTracked !== undefined &&
        typeof item.inventoryTracked !== "boolean")
    ) {
      throw new InputError("Order item fields are invalid");
    }
    computedTotal += item.quantity * item.unitPrice;
    computedItemCount += item.quantity;
    return {
      productId: item.productId,
      title: item.title.trim(),
      slug: item.slug,
      quantity: item.quantity,
      ...(item.variantSelections
        ? { variantSelections: item.variantSelections }
        : {}),
      ...(item.sku !== undefined ? { sku: item.sku.trim() } : {}),
      ...(item.inventoryTracked !== undefined
        ? { inventoryTracked: item.inventoryTracked }
        : {}),
      unitPrice: item.unitPrice,
      currency: item.currency,
    };
  });
  const amountSnapshotPresent = [
    input.subtotal,
    input.shippingAmount,
    input.discountCode,
    input.discountAmount,
    input.taxRateBasisPoints,
    input.taxAmount,
  ].some((value) => value !== undefined);
  const subtotal = input.subtotal ?? computedTotal;
  const shippingAmount = input.shippingAmount ?? 0;
  const discountAmount = input.discountAmount ?? 0;
  const taxRateBasisPoints = input.taxRateBasisPoints ?? 0;
  const taxAmount = input.taxAmount ?? 0;
  const validOptionalAmount = (value) =>
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647);
  let deliveryAddress;
  if (input.deliveryAddress !== undefined) {
    const address = input.deliveryAddress;
    if (
      typeof address !== "object" ||
      address === null ||
      Array.isArray(address) ||
      Object.keys(address).some(
        (key) =>
          ![
            "fullName",
            "line1",
            "line2",
            "city",
            "state",
            "postalCode",
            "country",
            "phone",
          ].includes(key),
      ) ||
      typeof address.fullName !== "string" ||
      address.fullName.trim().length < 1 ||
      address.fullName.length > 120 ||
      typeof address.line1 !== "string" ||
      address.line1.trim().length < 1 ||
      address.line1.length > 200 ||
      (address.line2 !== undefined &&
        (typeof address.line2 !== "string" || address.line2.length > 200)) ||
      typeof address.city !== "string" ||
      address.city.trim().length < 1 ||
      address.city.length > 100 ||
      typeof address.state !== "string" ||
      address.state.trim().length < 1 ||
      address.state.length > 100 ||
      typeof address.postalCode !== "string" ||
      !/^\d{6}$/.test(address.postalCode) ||
      address.country !== "IN" ||
      typeof address.phone !== "string" ||
      !/^\+91[6-9]\d{9}$/.test(address.phone)
    ) {
      throw new InputError("Order delivery address is invalid");
    }
    deliveryAddress = {
      fullName: address.fullName.trim(),
      line1: address.line1.trim(),
      ...(address.line2 !== undefined ? { line2: address.line2.trim() } : {}),
      city: address.city.trim(),
      state: address.state.trim(),
      postalCode: address.postalCode,
      country: address.country,
      phone: address.phone,
    };
  }
  if (
    (input.paymentMethod !== undefined &&
      !["stripe", "cash_on_delivery"].includes(input.paymentMethod)) ||
    (input.discountCode !== undefined &&
      (typeof input.discountCode !== "string" ||
        input.discountCode.trim().length < 3 ||
        input.discountCode.trim().length > 40)) ||
    !validOptionalAmount(input.subtotal) ||
    !validOptionalAmount(input.shippingAmount) ||
    !validOptionalAmount(input.discountAmount) ||
    !validOptionalAmount(input.taxAmount) ||
    (input.taxRateBasisPoints !== undefined &&
      (!Number.isSafeInteger(input.taxRateBasisPoints) ||
        input.taxRateBasisPoints < 0 ||
        input.taxRateBasisPoints > 10_000)) ||
    (input.taxRateBasisPoints === undefined) !==
      (input.taxAmount === undefined) ||
    discountAmount > subtotal ||
    (discountAmount > 0 && input.discountCode === undefined) ||
    (input.discountCode !== undefined && discountAmount === 0) ||
    (input.paymentMethod === "cash_on_delivery" &&
      (input.currency !== "INR" || deliveryAddress === undefined)) ||
    !Number.isSafeInteger(subtotal - discountAmount) ||
    taxAmount !==
      Math.round(((subtotal - discountAmount) * taxRateBasisPoints) / 10_000)
  ) {
    throw new InputError("Order amount or payment fields are invalid");
  }
  if (
    new Set(items.map((item) => item.productId)).size !== items.length ||
    subtotal !== computedTotal ||
    (amountSnapshotPresent &&
      subtotal - discountAmount + taxAmount + shippingAmount !== input.total) ||
    (!amountSnapshotPresent && computedTotal !== input.total) ||
    computedItemCount !== input.itemCount ||
    !Number.isSafeInteger(computedTotal)
  ) {
    throw new InputError("Order totals or line items do not match");
  }

  return {
    id: input.id,
    tenantId,
    customerId: input.customerId,
    status: input.status,
    createdAt: new Date(input.createdAt).toISOString(),
    items,
    ...(input.subtotal !== undefined ? { subtotal } : {}),
    ...(input.shippingAmount !== undefined ? { shippingAmount } : {}),
    ...(input.discountCode !== undefined
      ? { discountCode: input.discountCode.trim() }
      : {}),
    ...(input.discountAmount !== undefined ? { discountAmount } : {}),
    ...(input.taxRateBasisPoints !== undefined ? { taxRateBasisPoints } : {}),
    ...(input.taxAmount !== undefined ? { taxAmount } : {}),
    total: input.total,
    currency: input.currency,
    itemCount: input.itemCount,
    ...(input.paymentMethod !== undefined
      ? { paymentMethod: input.paymentMethod }
      : {}),
    ...(deliveryAddress ? { deliveryAddress } : {}),
  };
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
      const orderMatch = url.pathname.match(/^\/v1\/orders(?:\/([^/]+))?$/);
      const inventoryMatch = url.pathname.match(
        /^\/v1\/products\/inventory\/reservations(?:\/([^/]+)\/(release|commit|restore))?$/,
      );

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

      if (!match && !orderMatch && !inventoryMatch) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      const tenantId = authenticatedTenant(request, tenantApiKeys);
      if (!tenantId) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      if (inventoryMatch) {
        const reservationId = inventoryMatch[1];
        const action = inventoryMatch[2];
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          sendJson(response, error.status ?? 400, {
            error: error.status === 413 ? "payload_too_large" : "invalid_json",
          });
          return;
        }
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          body.tenantId !== tenantId
        ) {
          sendJson(response, 403, { error: "tenant_scope_mismatch" });
          return;
        }
        if (reservationId === undefined) {
          const validItems =
            Array.isArray(body.items) &&
            body.items.length >= 1 &&
            body.items.length <= 20 &&
            body.items.every(
              (item) =>
                item !== null &&
                typeof item === "object" &&
                !Array.isArray(item) &&
                typeof item.productId === "string" &&
                PRODUCT_ID_PATTERN.test(item.productId) &&
                item.selections !== null &&
                typeof item.selections === "object" &&
                !Array.isArray(item.selections) &&
                Object.keys(item.selections).length >= 1 &&
                Object.keys(item.selections).length <= 3 &&
                Object.values(item.selections).every(
                  (selection) =>
                    typeof selection === "string" &&
                    selection.trim().length > 0 &&
                    selection.length <= 40,
                ) &&
                Number.isInteger(item.quantity) &&
                item.quantity >= 1 &&
                item.quantity <= 100,
            );
          if (
            Object.keys(body).sort().join(",") !==
              "items,reservationId,tenantId" ||
            typeof body.reservationId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(body.reservationId) ||
            !validItems
          ) {
            sendJson(response, 400, { error: "invalid_inventory_reservation" });
            return;
          }
          sendJson(
            response,
            200,
            repository.reserveInventory({
              tenantId,
              reservationId: body.reservationId,
              items: body.items,
            }),
          );
          return;
        }
        if (
          !action ||
          Object.keys(body).join(",") !== "tenantId" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(reservationId)
        ) {
          sendJson(response, 400, { error: "invalid_inventory_reservation" });
          return;
        }
        const result = repository.transitionInventoryReservation({
          tenantId,
          reservationId,
          action,
        });
        if (!result) {
          sendJson(response, 404, { error: "inventory_reservation_not_found" });
          return;
        }
        sendJson(response, 200, result);
        return;
      }

      if (orderMatch) {
        const orderId = orderMatch[1];
        if (request.method === "GET" && orderId === undefined) {
          const pagination = parsePagination(url);
          if (!pagination) {
            sendJson(response, 400, { error: "invalid_pagination" });
            return;
          }
          sendJson(
            response,
            200,
            repository.listOrders({ tenantId, ...pagination }),
          );
          return;
        }
        if (request.method === "POST" && orderId === undefined) {
          let order;
          try {
            order = parseOrder(await readJsonBody(request), tenantId);
          } catch (error) {
            sendJson(
              response,
              error instanceof InputError
                ? (error.status ?? 400)
                : (error.status ?? 400),
              {
                error:
                  error instanceof InputError && error.status === 403
                    ? "tenant_scope_mismatch"
                    : error instanceof InputError
                      ? "invalid_order"
                      : error.status === 413
                        ? "payload_too_large"
                        : "invalid_json",
              },
            );
            return;
          }
          const result = repository.createOrder(order);
          if (result.conflict) {
            sendJson(response, 409, { error: "order_id_conflict" });
            return;
          }
          sendJson(response, result.created ? 201 : 200, {
            order: result.order,
          });
          return;
        }
        if (request.method === "GET" && orderId !== undefined) {
          if (!ORDER_ID_PATTERN.test(orderId)) {
            sendJson(response, 400, { error: "invalid_order_id" });
            return;
          }
          const order = repository.getOrder(tenantId, orderId);
          if (!order) {
            sendJson(response, 404, { error: "not_found" });
            return;
          }
          sendJson(response, 200, { order });
          return;
        }
        if (request.method === "PATCH" && orderId !== undefined) {
          if (!ORDER_ID_PATTERN.test(orderId)) {
            sendJson(response, 400, { error: "invalid_order_id" });
            return;
          }
          let body;
          try {
            body = await readJsonBody(request);
          } catch (error) {
            sendJson(response, error.status ?? 400, {
              error:
                error.status === 413 ? "payload_too_large" : "invalid_json",
            });
            return;
          }
          if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body) ||
            Object.keys(body).some(
              (key) => !["status", "fulfillment"].includes(key),
            ) ||
            !ORDER_STATUSES.has(body.status)
          ) {
            sendJson(response, 400, { error: "invalid_order_status" });
            return;
          }
          let fulfillment;
          if (body.fulfillment !== undefined) {
            if (!["Processing", "Shipped"].includes(body.status)) {
              sendJson(response, 400, { error: "invalid_order_fulfillment" });
              return;
            }
            try {
              fulfillment = parseOrderFulfillment(body.fulfillment);
            } catch {
              sendJson(response, 400, { error: "invalid_order_fulfillment" });
              return;
            }
          }
          const current = repository.getOrder(tenantId, orderId);
          if (!current) {
            sendJson(response, 404, { error: "not_found" });
            return;
          }
          if (!ORDER_STATUS_TRANSITIONS[current.status].has(body.status)) {
            sendJson(response, 409, { error: "invalid_status_transition" });
            return;
          }
          const order = repository.updateOrderStatus(
            tenantId,
            orderId,
            body.status,
            fulfillment,
          );
          sendJson(response, 200, { order });
          return;
        }
        response.setHeader(
          "allow",
          orderId === undefined ? "GET, POST" : "GET, PATCH",
        );
        sendJson(response, 405, { error: "method_not_allowed" });
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
