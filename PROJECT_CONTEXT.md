# Multi-Tenant E-Commerce Platform (Frontend) — Project Context

> This file is the source of truth for AI assistants (Cursor, GitHub Copilot, etc.).
> Read it fully before generating or modifying code. If a request conflicts with this file, ask before proceeding.
> Suggested usage: save as `AGENTS.md` / `.cursorrules` / `.github/copilot-instructions.md` (or reference it from those files).

---

## 1. Project Overview

A **white-label, multi-tenant e-commerce frontend** built with **Next.js**.

- A **Super Admin** owns and operates this frontend deployment (the platform) and manages multiple **Hosts**.
- Each **Host** (a provider/reseller organization) manages its own set of **Tenants** from a host dashboard.
- Each **Tenant** gets their own storefront and tenant admin dashboard.
- **Three dashboards, three scopes:** Super Admin dashboard → Host dashboard → Tenant dashboard. Each only sees data inside its own scope.

```
Super Admin (platform owner)
 ├─ Host A
 │   ├─ Tenant A1 ── Customers
 │   └─ Tenant A2 ── Customers
 └─ Host B
     └─ Tenant B1 ── Customers
```
- **This repo is frontend only.** The backend, database and file storage are **not owned by this repo**. Each tenant connects their own infrastructure (Bring Your Own Backend / BYO).
- The frontend must therefore be **backend-agnostic**: it talks to tenant infrastructure through a documented contract and pluggable adapters.

### Goals
1. The Super Admin can create, configure, limit and monitor many Hosts from one dashboard.
2. Each Host can onboard, configure and monitor its own tenants from its own dashboard.
3. Tenants can configure their backend API, database connection (via their backend), file/cloud storage and payment gateways without code changes.
4. Tenants can manage products, categories, inventory, orders and customers.
5. Storefronts are themeable per tenant and resolved by domain/subdomain.
6. Everything is swappable: backend, storage provider, payment gateway.

### Non-goals (for now)
- Building the backend, database schema or migrations.
- Running a shared database for all tenants.
- Handling raw card data (never; always use gateway-hosted fields/redirects).

---

## 2. User Roles

| Role | Description | Access |
|------|-------------|--------|
| **Super Admin** | Owner of the frontend server/platform | Super Admin dashboard: manage all hosts, host plans/limits, platform settings, global health, audit |
| **Host Owner** | Provider/reseller org that owns a group of tenants | Host dashboard: manage only *their own* tenants, tenant plans, domains, host branding, host staff |
| **Host Staff** | Employee of a host | Host dashboard: limited by permissions (e.g. `tenant:read`, `tenant:suspend`) |
| **Tenant Owner** | Business using the platform | Tenant dashboard: full access, integrations, billing, staff |
| **Tenant Staff** | Employee of a tenant | Tenant dashboard: limited by permissions (products, orders, etc.) |
| **Customer** | Shopper on a tenant storefront | Storefront: browse, cart, checkout, account |

Roles are **scoped**: every role assignment is `{ userId, scope: "platform" | "host" | "tenant", scopeId, role }`. A Host Owner can never read or modify another host's tenants; a Tenant Owner can never see another tenant. Enforce on the server.

Use RBAC with a permission list (e.g. `product:write`, `order:read`, `settings:integrations`) rather than hard-coding role names in components.

---

## 3. Tech Stack & Conventions

- **Next.js** (App Router), **TypeScript** (strict), **React Server Components** where possible
- **Styling:** Tailwind CSS + shadcn/ui (or equivalent headless components)
- **Data fetching:** TanStack Query on client, `fetch` with caching/revalidation on server
- **Forms/validation:** React Hook Form + Zod (schemas shared between forms and API client)
- **State:** Zustand for client state (cart, UI); avoid global state for server data
- **i18n:** `next-intl` (multi-language, multi-currency ready from day one)
- **Testing:** Vitest + React Testing Library, Playwright for e2e
- **Lint/format:** ESLint, Prettier; Conventional Commits

### Code rules
- No `any`. Validate all external data with Zod at the boundary.
- Prefer Server Components; add `"use client"` only when needed.
- No business logic in components; put it in `features/*/` services and hooks.
- Never call a tenant backend directly from the browser with a secret. See Security.
- Every list view needs loading, empty, error states and pagination.
- Accessibility: semantic HTML, keyboard navigation, labels on all inputs.

---

## 4. Architecture

```
Browser
   │
   ▼
Next.js (this repo)
   ├─ middleware.ts → resolves host + tenant from hostname, attaches scope context
   ├─ Storefront routes     (tenant-branded)
   ├─ Tenant dashboard      (/dashboard)
   ├─ Host dashboard        (/host)
   ├─ Super Admin dashboard (/super-admin)
   └─ Server layer (Route Handlers / Server Actions = BFF)
         │
         ├─ Backend Adapter   ──► Tenant's backend API (their server + DB)
         ├─ Storage Adapter   ──► Tenant's file/cloud storage (S3, GCS, Azure, Cloudinary, ...)
         └─ Payment Adapter   ──► Gateway (Stripe, Razorpay, PayPal, ...)
```

### Key principle: Ports & Adapters
Define **interfaces** (ports) in `core/`, implement them in `adapters/`. UI only depends on the interfaces.

```ts
// core/ports/backend.ts
export interface CatalogPort {
  listProducts(q: ProductQuery): Promise<Paginated<Product>>;
  getProduct(id: string): Promise<Product>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
}

// core/ports/payment.ts
export interface PaymentGateway {
  id: "stripe" | "razorpay" | "paypal" | "cod" | string;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  verifyPayment(payload: unknown): Promise<PaymentResult>;
  refund(paymentId: string, amount?: number): Promise<RefundResult>;
}

// core/ports/storage.ts
export interface StoragePort {
  getUploadUrl(file: FileMeta): Promise<{ url: string; fields?: Record<string,string>; publicUrl: string }>;
  delete(key: string): Promise<void>;
}
```

---

## 5. Tenancy Model (two levels: Host → Tenant)


- **Resolution:** by custom domain or subdomain (`shop.example.com`, `acme.platform.com`). `middleware.ts` looks up the tenant (and its parent host) and injects `x-tenant-id` and `x-host-id`. Dashboards can use reserved subdomains/paths (e.g. `admin.platform.com` for Super Admin, `{host}.platform.com/host` for a host).
- **Isolation:** every request, cache key, query key and storage path includes `hostId` and `tenantId` where applicable. Never share cached data across tenants or hosts.
- **Limits cascade:** Super Admin sets limits/plan per host (max tenants, features, custom domains). A host assigns plans to its tenants *within* those limits.
- **Host config:**

```ts
type HostConfig = {
  id: string;
  slug: string;
  status: "pending" | "active" | "suspended";
  plan: string;
  limits: { maxTenants: number; maxCustomDomains: number; features: Record<string, boolean> };
  branding: { name: string; logoUrl?: string; colors?: ThemeTokens }; // host dashboard branding / white-label
  domains: string[];
  supportContact?: string;
};
```

- **Tenant config** (loaded server-side, cached with revalidation):

```ts
type TenantConfig = {
  id: string;
  hostId: string; // parent host; all tenant access is validated against it
  slug: string;
  domains: string[];
  status: "pending" | "active" | "suspended";
  plan: string;
  branding: { name: string; logoUrl?: string; colors: ThemeTokens; fonts?: string };
  locale: { defaultLocale: string; locales: string[]; currency: string; currencies: string[] };
  backend: { baseUrl: string; apiVersion: string; authMode: "apiKey" | "oauth2" | "jwt" };
  storage: { provider: "s3" | "gcs" | "azure" | "cloudinary" | "custom"; publicBaseUrl: string };
  payments: PaymentGatewayConfig[];
  features: Record<string, boolean>; // feature flags per plan
};
```

- **Where config lives (for now):** behind `HostConfigStore` and `TenantConfigStore` interfaces. Start with a Super-Admin-managed JSON/KV source; swap for a real store later.

---

## 6. Features (by dashboard)

### 6.0 Super Admin Dashboard (`/super-admin`)
- Host list: create, edit, suspend, delete, impersonate (audited)
- Host onboarding wizard and invitations for host owners
- Plans, limits and feature flags per host (max tenants, custom domains, modules)
- Platform-wide view of all tenants (read-only by default, drill down by host)
- Domain management across the platform (verification, SSL status, conflicts)
- Global health: hosts/tenants with failing backend, storage or payment checks
- Platform analytics (aggregated across hosts)
- Platform settings: default themes, email templates, legal pages, maintenance mode
- Super Admin staff and roles; global audit log
- Billing for hosts (if the platform charges hosts)

### 6.1 Host Dashboard (`/host`)
*Scope: only tenants where `tenant.hostId === currentHost.id`.*
- Tenant list: create, edit, suspend, delete, impersonate (audited), within host limits
- Tenant onboarding wizard
- Plans & feature flags per tenant (bounded by host limits)
- Domain management and verification status for its tenants
- Tenant health: backend reachability, storage check, payment gateway check
- Host-level analytics (aggregated across its tenants)
- Host branding / white-label settings, default themes, email templates
- Host staff & roles, host audit log
- Usage vs limits (tenants used, domains used)

### 6.2 Tenant Dashboard (`/dashboard`)
**Integrations / Setup (core requirement)**
- **Backend setup:** base URL, API version, auth method/credentials, "Test connection" button, health status
- **Database:** configured *through the tenant's backend*. The frontend only shows connection status exposed by the backend health endpoint. It must never connect to a DB directly.
- **File/Cloud storage setup:** provider, bucket/container, region, public base URL, "Test upload" button
- **Payment gateways:** enable/disable multiple gateways, set priority, per-gateway credentials (publishable key in config; secrets are held by tenant backend/BFF), test mode toggle, supported currencies/countries, webhook URL display
- **Domains & branding:** custom domain, logo, colors, fonts, favicon

**Catalog**
- Add / edit / remove products (soft delete + restore)
- Fields: title, slug, description (rich text), SKU, price, compare-at price, cost, currency, taxes, stock, images/videos, categories, tags, brand, weight/dimensions, SEO meta, status (draft/active/archived)
- Variants & options (size, color, etc.), per-variant price/stock/SKU/images
- Bulk actions: import/export CSV, bulk price/stock update, bulk delete
- Categories/collections (nested), attributes, brands
- Image upload with drag & drop, reorder, alt text (via Storage Adapter)

**Sales**
- Orders: list, filter, detail, status updates, fulfillment, refunds, invoices/packing slips
- Customers: list, detail, order history, segments
- Discounts: coupon codes, automatic discounts, rules
- Abandoned carts
- Reviews moderation

**Operations**
- Inventory & low-stock alerts, multiple locations
- Shipping: zones, rates, carriers, free-shipping rules
- Taxes: rates, inclusive/exclusive
- Notifications/email templates
- Staff & roles, permissions
- Analytics: revenue, orders, conversion, top products
- Content/CMS: pages, banners, homepage sections, blog
- Webhooks & API keys (tenant-managed)
- Activity log

### 6.3 Storefront (tenant-branded)
- Home, collection, product detail, search with filters/sort, wishlist
- Cart (persistent), checkout (guest + account), order confirmation
- Gateway selection at checkout based on tenant config
- Customer account: profile, addresses, orders, returns
- SEO: metadata, sitemap, robots, structured data (JSON-LD), ISR for catalog pages
- PWA-ready, mobile-first, performance budget (Core Web Vitals)

---

## 7. Backend Contract (what tenants' servers must implement)

The frontend expects a versioned REST API (OpenAPI spec lives in `contracts/openapi.yaml`). Tenants may implement it themselves or use a provided reference/adapter.

Minimum endpoints (all under `/{apiVersion}`):

```
GET    /health                       → { status, db: "up"|"down", storage: "up"|"down" }
GET    /products                     POST /products
GET    /products/:id                 PATCH /products/:id        DELETE /products/:id
GET    /categories                   POST /categories ...
GET    /orders                       GET /orders/:id            PATCH /orders/:id
POST   /uploads/sign                 → pre-signed upload URL
POST   /payments/session             → create gateway session (server-side secrets)
POST   /payments/webhook/:gateway    → gateway webhooks land on tenant backend
GET    /customers ...
POST   /auth/login | /auth/refresh | /auth/logout
```

Standard conventions:
- Pagination: `?page=1&limit=20` → `{ data, meta: { page, limit, total } }`
- Errors: `{ error: { code, message, details? } }`
- Money: integer minor units + ISO currency code (e.g. `{ amount: 1999, currency: "USD" }`)
- IDs: strings (UUID/ULID). Timestamps: ISO 8601 UTC.

If a tenant's backend differs, write a **mapping adapter** in `adapters/backend/<name>` — do not change UI code.

---

## 8. Payments

- Gateways are plugins: `adapters/payment/<gateway>/` implementing `PaymentGateway`.
- Initial targets: **Stripe, Razorpay, PayPal, Cash on Delivery**; design for easy addition (Paytm, PhonePe, Adyen, Mollie, etc.).
- A tenant can enable **multiple gateways**; checkout shows them by priority, filtered by currency/country.
- Flow: frontend → BFF → tenant backend creates session using **secret keys** → returns redirect URL / client secret → frontend completes with gateway SDK → **webhook** on tenant backend confirms payment → order status updated.
- Never trust client-side payment success; always confirm via webhook/server verification.
- Support test/live modes per gateway and idempotency keys on payment creation.

```ts
type PaymentGatewayConfig = {
  gateway: string;            // "stripe" | "razorpay" | ...
  enabled: boolean;
  mode: "test" | "live";
  priority: number;
  publicConfig: Record<string, string>; // publishable key, client id, etc.
  currencies: string[];
  countries?: string[];
};
```

---

## 9. File / Cloud Storage

- Providers behind `StoragePort`: S3-compatible (AWS, R2, MinIO, Spaces), GCS, Azure Blob, Cloudinary, custom.
- Uploads go **browser → storage via pre-signed URL** obtained from tenant backend; files do not stream through Next.js.
- Validate type/size client-side and server-side; generate image variants/thumbnails via provider or `next/image` loader.
- Store paths as `tenants/{tenantId}/products/{productId}/{filename}`.

---

## 10. Security Requirements

- **Secrets never reach the browser.** Only publishable/public config is sent to the client.
- Tenant-provided secrets (if the frontend must store any) are encrypted at rest server-side and never logged or returned after save (write-only fields, show masked).
- All calls to tenant backends go through the Next.js server layer (BFF) with server-held credentials. Browser uses httpOnly, SameSite cookies for sessions.
- Validate and allow-list tenant `baseUrl` values (HTTPS only; block private IP ranges to prevent **SSRF** from "Test connection").
- CSRF protection on mutations; rate limiting on auth and test-connection endpoints.
- Strict CSP, sanitize rich text (DOMPurify), escape user content.
- RBAC enforced on the server for every dashboard action, not only in UI.
- **Scope guards:** every server handler resolves the caller's scope (`platform`/`host`/`tenant`) and verifies the target resource belongs to it (e.g. a host may only touch tenants with its own `hostId`). Treat any ID from the client as untrusted.
- Impersonation (Super Admin → host, host → tenant) is time-limited, clearly bannered in the UI, and fully audited. Super Admin impersonation must not expose tenant secrets.
- Separate session cookies/audiences per dashboard to prevent privilege confusion.
- Audit log (scoped per level, with a global view for Super Admin) for sensitive actions: credential changes, role changes, impersonation, suspensions, deletions.
- PCI: never touch raw card data; use hosted fields/redirects only.

---

## 11. Suggested Folder Structure

```
src/
├─ app/
│  ├─ (storefront)/            # customer-facing, tenant-branded
│  │  ├─ page.tsx
│  │  ├─ products/[slug]/page.tsx
│  │  ├─ cart/ checkout/ account/
│  ├─ dashboard/               # tenant admin
│  │  ├─ products/ orders/ customers/ discounts/
│  │  ├─ settings/
│  │  │  ├─ backend/ storage/ payments/ domains/ branding/ staff/
│  ├─ super-admin/             # platform owner
│  │  ├─ hosts/ plans/ tenants/ domains/ health/ settings/ staff/ audit/
│  ├─ host/                    # host admin (scoped to own tenants)
│  │  ├─ tenants/ plans/ domains/ health/ branding/ staff/ audit/
│  ├─ api/                     # BFF route handlers (proxy, webhooks relay, test-connection)
│  └─ middleware.ts            # tenant resolution + auth guard
├─ core/
│  ├─ ports/                   # interfaces (Catalog, Orders, Payment, Storage, Auth)
│  ├─ domain/                  # types, Zod schemas (Product, Order, Tenant...)
│  └─ tenancy/                 # scope context (platform/host/tenant), config store interfaces, scope guards
├─ adapters/
│  ├─ backend/                 # default REST adapter + custom mappers
│  ├─ payment/                 # stripe/ razorpay/ paypal/ cod/
│  └─ storage/                 # s3/ gcs/ azure/ cloudinary/
├─ features/                   # feature modules: components + hooks + services
│  ├─ catalog/ orders/ cart/ checkout/ customers/ integrations/ tenants/ hosts/
├─ components/                 # shared UI (ui/, layout/, forms/, data-table/)
├─ lib/                        # utils, fetcher, money, i18n, auth, logger
├─ styles/
└─ tests/
contracts/openapi.yaml         # backend contract
docs/
```

---

## 12. Data Models (TypeScript, abbreviated)

```ts
type Money = { amount: number; currency: string }; // minor units

type Product = {
  id: string; tenantId: string; title: string; slug: string; description?: string;
  status: "draft" | "active" | "archived";
  price: Money; compareAtPrice?: Money; sku?: string;
  images: { url: string; alt?: string; position: number }[];
  categoryIds: string[]; tags: string[];
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
  seo?: { title?: string; description?: string };
  createdAt: string; updatedAt: string; deletedAt?: string | null;
};

type ProductVariant = {
  id: string; sku?: string; price: Money; stock: number;
  optionValues: Record<string, string>; imageUrl?: string;
};

type Order = {
  id: string; number: string; customerId?: string;
  status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
  items: { productId: string; variantId?: string; qty: number; price: Money }[];
  totals: { subtotal: Money; shipping: Money; tax: Money; discount: Money; total: Money };
  payment: { gateway: string; status: string; reference?: string };
  shippingAddress: Address; billingAddress: Address;
  createdAt: string;
};
```

---

## 13. Environment Variables (frontend host)

```
NEXT_PUBLIC_PLATFORM_DOMAIN=platform.com
TENANT_CONFIG_SOURCE=file|kv|api
TENANT_CONFIG_SECRET_KEY=            # encryption key for stored tenant secrets (server only)
SESSION_SECRET=
SUPER_ADMIN_BOOTSTRAP_EMAIL=         # first Super Admin account, used once at setup
```
Tenant-specific values (backend URL, storage, gateways) are **configured in the dashboard, not in `.env`**.

---

## 14. Development Roadmap

**Phase 1 — Foundation**
- Project setup, design system, auth, scoped RBAC (platform/host/tenant), host + tenant resolution middleware, i18n
- Port/adapter scaffolding, default REST backend adapter, mock backend (MSW) for local dev

**Phase 2 — Tenant Dashboard core**
- Integrations: backend, storage, payments (with test-connection)
- Product CRUD with variants and image upload
- Categories, orders list/detail

**Phase 3 — Storefront**
- Catalog, PDP, cart, checkout with multiple gateways, order confirmation, customer account

**Phase 4 — Host & Super Admin Dashboards**
- Host dashboard: tenant management, plans, domains, health, audit log (scoped)
- Super Admin dashboard: host management, limits cascade, global health, platform settings, audit log

**Phase 5 — Growth**
- Discounts, shipping/tax, reviews, analytics, CMS, webhooks, staff roles, PWA, theming marketplace

---

## 15. Instructions for the AI Assistant

1. **Follow the ports/adapters pattern.** Never import a specific gateway/storage SDK or backend URL inside UI components.
2. **Ask before** adding new dependencies, changing the folder structure, or altering the backend contract.
3. **Always scope** data access, cache keys and file paths by `hostId`/`tenantId`. Every dashboard handler must run a scope guard (platform → host → tenant) before reading or writing.
4. **Never** expose secrets to client components or log them.
5. Generate **types + Zod schemas first**, then services, then UI.
6. Include loading/empty/error states, accessibility, and responsive layout in every screen.
7. Write tests for services, adapters and critical flows (checkout, product CRUD, integration setup).
8. Keep components small and typed; prefer composition; co-locate feature code under `features/`.
9. When unsure about backend behavior, code against the contract in `contracts/openapi.yaml` and mock with MSW.
10. Keep commits small and use Conventional Commits.

---

## 16. Open Questions (decide before building the related area)

- Where are host and tenant configuration persisted (KV, hosted DB, or API)? Who owns that store?
- Does the Super Admin bill hosts, and do hosts bill their tenants (two-level billing)?
- Can a host fully white-label (own domain, logo, emails) or only brand its tenants?
- Can a tenant ever move between hosts?
- Will the Super Admin or hosts provide a **reference backend** tenants can deploy, or only the API contract?
- Multi-vendor marketplace needed later (many sellers per tenant)?
- Required compliance regions (GDPR, India DPDP, PCI SAQ-A)?
