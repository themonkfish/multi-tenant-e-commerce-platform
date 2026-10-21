const STATUSES = new Set(["draft", "active", "archived"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

function validateFields(input, { partial, allowTenantId = false }) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InputError("Expected a JSON object");
  }

  const allowedKeys = new Set([
    "title",
    "slug",
    "status",
    "price",
    "sku",
    ...(allowTenantId ? ["tenantId"] : []),
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new InputError("Product contains an unsupported field");
  }

  if (!partial || "title" in input) {
    if (
      typeof input.title !== "string" ||
      input.title.trim().length < 1 ||
      input.title.trim().length > 200
    ) {
      throw new InputError("title must contain 1-200 characters");
    }
  }

  if (!partial || "slug" in input) {
    if (
      typeof input.slug !== "string" ||
      input.slug.length > 200 ||
      !SLUG_PATTERN.test(input.slug)
    ) {
      throw new InputError(
        "slug must contain lowercase words separated by hyphens",
      );
    }
  }

  if (!partial || "status" in input) {
    if (typeof input.status !== "string" || !STATUSES.has(input.status)) {
      throw new InputError("status must be draft, active, or archived");
    }
  }

  if (!partial || "price" in input) {
    if (
      typeof input.price !== "object" ||
      input.price === null ||
      Array.isArray(input.price) ||
      Object.keys(input.price).some(
        (key) => !["amount", "currency"].includes(key),
      ) ||
      !Number.isSafeInteger(input.price.amount) ||
      input.price.amount < 0 ||
      typeof input.price.currency !== "string" ||
      !CURRENCY_PATTERN.test(input.price.currency)
    ) {
      throw new InputError(
        "price must include a non-negative whole-number amount and uppercase three-letter currency",
      );
    }
  }

  if (
    "sku" in input &&
    (typeof input.sku !== "string" || input.sku.length > 100)
  ) {
    throw new InputError("sku must be a string of at most 100 characters");
  }

  if (
    allowTenantId &&
    (typeof input.tenantId !== "string" ||
      input.tenantId.length < 1 ||
      input.tenantId.length > 128)
  ) {
    throw new InputError("tenantId must contain 1-128 characters");
  }

  if (partial && Object.keys(input).length === 0) {
    throw new InputError("At least one product field is required");
  }

  return input;
}

export function parseProductInput(input) {
  return validateFields(input, { partial: false, allowTenantId: true });
}

export function parseProductUpdate(input) {
  return validateFields(input, { partial: true });
}
