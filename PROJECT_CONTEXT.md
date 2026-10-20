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
- Building a full custom backend for tenants. (We *do* ship optional reference schemas/migrations for the supported data providers, see section 7.1.)
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
         ├─ Data Adapter      ──► Tenant's data provider, one of:
         │                          • REST backend (their own server + DB)
         │                          • Supabase (Postgres)
         │                          • MongoDB (Atlas / self-hosted)
         │                          • others later (Firebase, PlanetScale, Appwrite...)
         ├─ Storage Adapter   ──► Tenant's file/cloud storage (S3-compatible, GCS, Azure, Cloudinary,
         │                          Supabase Storage, Google Drive, Dropbox, OneDrive, ...)
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
  capabilities: StorageCapabilities;
  // Direct-upload providers return a pre-signed target; others upload via the server.
  prepareUpload(file: FileMeta): Promise<UploadTarget>;          // { mode: "presigned" | "server-proxy", url?, fields?, key }
  upload?(key: string, data: ReadableStream | Buffer, meta: FileMeta): Promise<StoredFile>; // for server-proxy mode
  getPublicUrl(key: string, opts?: { width?: number; format?: string }): string;
  delete(key: string): Promise<void>;
  list?(prefix: string, cursor?: string): Promise<Paginated<StoredFile>>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; details?: string }>;
}

type StorageCapabilities = {
  presignedUploads: boolean;
  publicCdn: boolean;          // suitable for serving storefront images directly
  imageTransforms: boolean;    // resize/format on the fly
  oauth: boolean;              // connected via user authorization instead of API keys
};
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
  data: DataProviderConfig; // see below
  storage: StorageProviderConfig; // see section 9
  payments: PaymentGatewayConfig[];
  features: Record<string, boolean>; // feature flags per plan
};
```

```ts
type DataProviderConfig =
  | { type: "rest";     baseUrl: string; apiVersion: string; authMode: "apiKey" | "oauth2" | "jwt" }
  | { type: "supabase"; projectUrl: string; anonKeyRef?: string; serviceKeyRef: string; schema?: string; tenancyMode: "dedicated-project" | "shared-rls" }
  | { type: "mongodb";  connectionRef: string; dbName: string; tenancyMode: "dedicated-db" | "shared-collection-tenantId" };
// "*Ref" fields are IDs of encrypted secrets in the platform secret vault, never raw secrets in config objects.
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

### 6.0.1 Super Admin Setup & Bootstrap

The Super Admin owns the frontend deployment, so there is no parent to create them. The first Super Admin is created by a **one-time, locked-after-use bootstrap**. Do not hard-code credentials and do not leave an open sign-up.

**Platform Store (required before anything else).** Hosts, tenants, plans, users and audit logs need persistence even though tenants bring their own backends. Define a `PlatformStore` port (see `core/tenancy/`) with swappable adapters:

| Adapter | Use |
|---------|-----|
| `file` (JSON/SQLite) | Local dev only |
| `kv` (Upstash Redis, Vercel KV, Cloudflare KV) | Small/serverless deployments |
| `supabase` | Platform data on Supabase (Postgres + RLS + Auth) |
| `mongodb` | Platform data on MongoDB Atlas/self-hosted |
| `sql` (Postgres via Prisma/Drizzle) | Recommended for production |
| `api` | Super Admin's own platform API |

**First-run flow (`/setup`):**
1. On deploy, the operator sets `SETUP_TOKEN` (random, single use) and the store connection env vars.
2. `middleware.ts` checks `platform.initialized`. If `false`, all routes redirect to `/setup`. If `true`, `/setup` returns 404.
3. Wizard steps: (a) enter `SETUP_TOKEN`, (b) create Super Admin account (email, password with strong policy, mandatory 2FA/TOTP enrollment, recovery codes), (c) verify Platform Store connection, (d) platform domain and reserved subdomains (`admin`, `www`, `api`, ...), (e) email provider for invites/reset, (f) default theme and legal pages, (g) optionally create the first Host.
4. On finish, write `platform.initialized = true`, invalidate `SETUP_TOKEN`, log an audit event.

**After setup:**
- Super Admin signs in at `admin.<platform-domain>` (or `/super-admin`) using a separate session audience.
- Additional Super Admins are invited from the dashboard (email invite, expiring link, 2FA required). Keep at least 2 active Super Admins when possible.
- Host Owners are invited by the Super Admin; tenant owners by hosts. No public registration for these roles.
- Alternative auth: SSO/OIDC (Auth.js) with an allow-list of Super Admin emails, instead of local passwords.

**Recovery:** a server-side CLI script (`pnpm superadmin:reset`) that requires deploy/shell access and `SETUP_TOKEN`-style proof. There is no "forgot password" path that bypasses 2FA for Super Admin.

**Rules for the AI assistant:**
- Never ship default/seed credentials. Never expose `/setup` once `platform.initialized` is true.
- Rate-limit and audit all setup and Super Admin auth endpoints.
- Store password hashes with Argon2id/bcrypt; encrypt 2FA secrets and platform secrets with `PLATFORM_SECRET_KEY`.

### 6.0.2 Platform Supabase via Environment Variables (Super Admin / core settings)

**Decision:** the platform's own data (hosts, plans, limits, platform settings, super-admin users, audit logs, encrypted secret vault) lives in **one fixed Supabase project configured through server-side env vars**. All Super Admin and core-settings operations run through **narrow, server-only handlers** that use this project. This is the recommended setup.

```
PLATFORM_STORE=supabase
PLATFORM_SUPABASE_URL=                 # server-only
PLATFORM_SUPABASE_SERVICE_KEY=         # server-only, NEVER prefix with NEXT_PUBLIC_
PLATFORM_SECRET_KEY=                   # app-level encryption key for secrets stored in the DB
# Optional, only if the Super Admin signs in through Supabase Auth in the browser:
NEXT_PUBLIC_PLATFORM_SUPABASE_URL=
NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY=
```

**Rules**
- **Separate projects:** the platform Supabase project is never reused as a tenant's data project. Use different projects (and keys) for dev, staging and production.
- **Server-only access:** the service key is used only in modules with `import "server-only"`. It must never be bundled to the client, logged, returned in API responses, or shown in the dashboard.
- **No generic endpoint.** Do not build one `/api/admin` route that accepts a table name, filter or raw query. Expose **explicit actions** (`createHost`, `suspendHost`, `updateHostLimits`, `updatePlatformSettings`, `inviteSuperAdmin`, ...), each with Zod validation, an authorization check, and an audit log entry.
- **Authorize every call:** verify session + role `super_admin` + 2FA state server-side on each request, plus CSRF/origin checks and rate limiting. Optional extra: IP allow-list or VPN for `admin.<domain>`.
- **Default-deny RLS on all platform tables** with *no* anon/authenticated policies. Even if the anon key leaks, nothing is readable. The service key bypasses RLS, so authorization lives in the server handlers.
- **Reduce blast radius:** the service key can read everything, so prefer a dedicated least-privilege Postgres role/API key for the app where possible, rotate keys regularly, and keep key access limited to the deployment platform's secret store (mark as sensitive; never commit `.env`).
- **Secrets in the DB are encrypted at the app level** (AES-256-GCM with `PLATFORM_SECRET_KEY`, or Supabase Vault/KMS). Tenant DB URIs, payment keys and OAuth tokens are never stored as plaintext columns.
- **Env vars are static:** changing the project or keys needs a redeploy. That is acceptable for the platform store, since `/setup` only creates the first Super Admin and runs migrations (it no longer asks for store credentials in this mode).
- **Performance:** `middleware.ts` resolves host/tenant on every request, so do **not** query Supabase each time. Cache domain → host/tenant lookups (Edge Config/KV or Next.js cache with tag revalidation) and invalidate on change.
- **Migrations:** keep platform schema in `supabase/migrations/` (versioned, reviewed). Run them in CI/CD, not from the browser.

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
- **Backend / Database setup:** tenant picks a **data provider**: *Custom REST backend*, *Supabase*, or *MongoDB* (more later). Provider-specific form (REST: base URL, API version, auth; Supabase: project URL, anon key, service-role key, schema; MongoDB: connection string, database name), tenancy mode, "Test connection" button, "Initialize schema/collections" button (runs reference migration), health status, and a "Disconnect/Rotate credentials" action. Secrets are write-only and masked after save.
- **File/Cloud storage setup:** pick a provider (S3-compatible, GCS, Azure, Cloudinary, Supabase Storage, Google Drive, Dropbox, OneDrive, ...), provider-specific form or "Connect account" (OAuth) button, folder/bucket, public base URL, "Test upload" button, usage/health status, "Disconnect" and credential rotation. Secrets are write-only and masked.
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

### 7.1 Data Providers (REST, Supabase, MongoDB)

Tenants choose how their data is stored. All providers implement the **same ports** (`CatalogPort`, `OrdersPort`, `CustomersPort`, `AuthPort`), so UI code never knows which one is active. A `DataAdapterFactory` returns the right adapter from `tenant.data.type`.

| Provider | How it is accessed | Notes |
|----------|--------------------|-------|
| **REST** | Via BFF to tenant's API per the contract in section 7 | Tenant keeps all DB secrets on their server |
| **Supabase** | `@supabase/supabase-js` | Storefront public reads may use the **anon key + Row Level Security**. Dashboard writes use the **service-role key on the server only**. Supabase Storage can back `StoragePort`. |
| **MongoDB** | Official Node driver, **server-side only** | A Mongo connection string must **never** reach the browser. Cache one client per tenant (bounded pool) to avoid exhausting connections in serverless. Atlas Data API is not assumed. |

**Two credential modes (important):**
- **Mode A: tenant-hosted (REST).** DB secrets stay on the tenant's server. The frontend platform stores only the base URL and an API credential.
- **Mode B: platform-proxied (Supabase/MongoDB direct).** The Next.js server layer needs the DB credentials, so they are saved **encrypted in a secret vault** (AES-256-GCM with `PLATFORM_SECRET_KEY`, or a KMS), decrypted only inside server handlers, write-only in the UI, and never logged or sent to the client. Prefer least-privilege DB users (a dedicated app user/role, not an admin/owner account).

**Tenant data isolation:**
- *Dedicated* (recommended): one Supabase project or one Mongo database per tenant.
- *Shared*: one project/database with a `tenant_id` column/field on **every** record. Supabase: enforce with RLS policies. MongoDB: enforce in a mandatory query wrapper (never raw collection access) plus compound indexes starting with `tenantId`.

**Reference schema:** the repo provides `adapters/data/supabase/migrations/*.sql` and `adapters/data/mongodb/schema/*.ts` (collections, indexes, validators) for: tenants' products, variants, categories, orders, customers, discounts, settings. "Initialize schema" in the dashboard runs these idempotently; migrations are versioned and the dashboard shows the current schema version and pending upgrades.

**Provider connection test:** validates credentials, reachability and required tables/collections, then reports `{ status, latency, schemaVersion, missing[] }`. Rate-limit it and block private/internal hosts (SSRF) except where the operator explicitly allow-lists them.

**Files:** Supabase tenants can pick Supabase Storage; MongoDB tenants must choose a separate file/cloud storage provider (GridFS is not recommended for product images).

**Rules for the AI assistant:**
- Add a new provider by creating `adapters/data/<name>/` that implements the ports and registering it in `DataAdapterFactory`. Do not branch on `tenant.data.type` anywhere else.
- No direct Supabase/Mongo calls inside components or route handlers; go through ports.
- Mongo/Supabase service credentials: server-only modules (`import "server-only"`).
- Contract tests: run one shared test suite against every adapter (REST mock, Supabase local, MongoDB memory server).

### 7.2 Access Policy: when may the browser talk to Supabase directly?

**Rule of thumb:** the browser may use Supabase directly only with the **anon key + the signed-in user's JWT, under tested RLS policies**, and only for low-risk, user-scoped data. Anything privileged, cross-scope, or secret goes through the Next.js server layer.

| Action | Where it runs |
|--------|---------------|
| Public storefront catalog reads | Server Components / ISR with anon key + RLS (browser direct only for live search/filters) |
| Customer sign-in, own profile/addresses/orders | Supabase Auth (cookie sessions via `@supabase/ssr`) + RLS on `auth.uid()` |
| Cart, price/total calculation, stock decrement, coupon validation, order creation | **Server only** (never trust client-sent prices) |
| Tenant dashboard CRUD (products, orders, etc.) | Server actions through the data port (Zod validation + scope guard), using the user's JWT/RLS or service role |
| Host dashboard and Super Admin dashboard | **Server only**: service role + scope guards + audit log |
| Tenant provisioning, schema init, impersonation, plan/limit changes | **Server only** |
| Secrets: payment keys, DB URIs, service-role key, OAuth tokens | **Server only**, encrypted vault, never selectable from the client |
| Payment verification and webhooks | **Server only** |
| File uploads | Browser → storage via short-lived signed URL issued by the server |

**Why not "browser to Supabase for everyone":**
- **RLS is the only wall.** The anon key is public, so one wrong policy exposes data. Cross-tenant rules like "Super Admin sees all, Host sees only its tenants, Tenant staff see their own" are complex to express in SQL policies, and a mistake leaks across all tenants.
- **Business rules can't live in the browser.** Pricing, stock, discounts and payment status must be enforced server-side.
- **Secrets and privileged operations** (impersonation, provisioning, audit, rate limiting, SSRF-checked "test connection") need a trusted server.
- **Providers are pluggable.** Tenants may use MongoDB or a REST backend. UI code that calls Supabase directly would break the ports/adapters design. The browser should only ever talk to our ports/server layer.
- **Platform vs tenant Supabase:** the platform's own Supabase project and each tenant's project are different credentials and trust domains. A tenant's service key must never be sent to the browser.

**If you use Supabase Auth with RLS:**
- Put `role`, `scope`, `hostId`, `tenantId` in **`app_metadata`** (set server-side only). **Never use `user_metadata`**, which users can edit.
- Enable RLS on every table; default-deny; write policy tests (pgTAP or integration tests) that assert cross-tenant and cross-host access fails.
- Keep Super Admin and Host operations off RLS entirely (server + service role) so policies stay simple.
- Rotate keys, use a dedicated least-privilege role where possible, and never import service-role clients in client code (`import "server-only"`).

**Rule for the AI assistant:** do not call `supabase.from(...)` in client components for dashboards or any write involving money, stock, roles or secrets. Use data ports via Server Actions/Route Handlers. Direct client use is allowed only for the cases marked "browser" in the table above.

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

Tenants choose where their files (product images, videos, documents, invoices) live. Every provider implements `StoragePort`; UI code never imports a provider SDK. A `StorageAdapterFactory` returns the adapter from `tenant.storage.type`.

### 9.1 Supported providers

| Category | Providers | Auth | Upload path | Good for storefront images? |
|----------|-----------|------|-------------|------------------------------|
| **S3-compatible object storage** | AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO, Wasabi | Access key + secret | Pre-signed URL (browser → storage) | Yes (use with a CDN) |
| **Cloud provider storage** | Google Cloud Storage, Azure Blob Storage, Firebase Storage | Service account / SAS / connection string | Signed URL / SAS | Yes |
| **Media platforms** | Cloudinary, ImageKit, UploadThing, Bunny.net | API key / signed upload | Signed direct upload | Best (built-in CDN + transforms) |
| **Backend-bundled** | Supabase Storage | Anon / service key | Signed upload URL | Yes |
| **Personal/team cloud drives** | **Google Drive, Dropbox, OneDrive/SharePoint** | **OAuth 2.0** (tenant clicks "Connect") | Server-proxied upload | **Limited, see 9.2** |
| **Custom** | Tenant's own REST upload endpoint, SFTP/FTP (server-side only) | Per contract | Server-proxied or signed | Depends |

```ts
type StorageProviderConfig =
  | { type: "s3";         endpoint?: string; region: string; bucket: string; credentialsRef: string; publicBaseUrl: string; pathStyle?: boolean }
  | { type: "gcs";        bucket: string; credentialsRef: string; publicBaseUrl: string }
  | { type: "azure";      container: string; credentialsRef: string; publicBaseUrl: string }
  | { type: "cloudinary"; cloudName: string; credentialsRef: string }
  | { type: "supabase";   bucket: string; credentialsRef: string }
  | { type: "gdrive" | "dropbox" | "onedrive"; folderId: string; oauthTokenRef: string; accountEmail: string }
  | { type: "custom";     uploadUrl: string; credentialsRef: string; publicBaseUrl?: string };
// "*Ref" = ID of an encrypted secret in the platform secret vault.
```

### 9.2 Cloud drives (Google Drive, Dropbox, OneDrive): honest limitations
Drive-style services are **file sync/sharing tools, not CDNs**. They are supported because tenants ask for them, but they need extra handling:
- **Do not hotlink** Drive share links on the storefront: they can rate-limit, change, expire, or return viewer pages instead of the raw file, and they are slow for catalog traffic.
- Serve files through a **Next.js media proxy** (`/api/media/[tenantId]/[fileId]`) that streams the file with strong `Cache-Control`, ETag and CDN caching (ISR/edge cache), and resizes via `next/image` or a transform step.
- Prefer copying product media into a CDN-backed store when possible, and show a dashboard warning ("Drive storage is not recommended for high-traffic stores").
- Use **least-privilege OAuth scopes** (e.g. Google `drive.file` limited to files the app creates, not the whole Drive; Dropbox app-folder access; OneDrive `Files.ReadWrite.AppFolder`).
- OAuth tokens are stored encrypted, refreshed server-side, and the UI shows "reconnect needed" if a refresh fails or access is revoked. Handle quota-exceeded and API rate-limit errors gracefully.
- Capabilities for these adapters: `presignedUploads: false`, `publicCdn: false`, `imageTransforms: false`, `oauth: true`.

### 9.3 Rules
- **Direct upload when possible:** for providers with presigned/signed uploads, files go **browser → storage** with a short-lived URL obtained via the server layer; large files do not stream through Next.js. For `server-proxy` providers (cloud drives, SFTP), upload through a route handler with size limits and streaming.
- **Key layout:** `tenants/{tenantId}/products/{productId}/{uuid}-{filename}` (for drives: a per-tenant folder created on connect). Never trust client-supplied file names/paths; sanitize and generate keys server-side.
- **Validation (client and server):** allow-list MIME types (verify magic bytes, not only extension), max size per type, image dimension limits, strip EXIF/GPS metadata, optional virus scan hook for documents.
- **Images:** generate responsive variants/thumbnails (provider transforms or `next/image` loader), store `alt`, `width`, `height`, blurhash/placeholder.
- **Public vs private:** product media is public; invoices, customer uploads and exports are **private** and served via short-lived signed URLs after an auth check.
- **Health & test:** `healthCheck()` + "Test upload" (uploads, reads back, deletes a small file) shown in tenant dashboard and in host/super-admin health views. Block private/internal endpoint hosts for custom/S3-endpoint fields (SSRF).
- **Switching providers:** changing storage does not rewrite old URLs silently. Store file records `{ key, providerId, url }`; offer an optional "migrate files" job.
- **Cost/abuse control:** per-tenant storage quota and upload rate limits (limits cascade from host plan).

---

## 10. Security Requirements

- **Secrets never reach the browser.** Only publishable/public config is sent to the client.
- Direct-DB modes (Supabase/MongoDB): use least-privilege credentials, enforce tenant isolation (RLS or mandatory tenant-scoped query wrapper), and never expose the Supabase service-role key or Mongo URI to client code or to Super Admin/Host impersonation views.
- OAuth integrations (Drive/Dropbox/OneDrive): use state + PKCE, validate redirect URIs, store refresh tokens encrypted, request minimal scopes, and support revocation.
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
│  ├─ data/                    # data provider adapters implementing the core ports
│  │  ├─ rest/                 # default REST adapter + custom mappers
│  │  ├─ supabase/             # supabase-js server client, RLS-aware queries, reference SQL migrations
│  │  └─ mongodb/              # official driver, cached clients, reference collections/indexes
│  ├─ payment/                 # stripe/ razorpay/ paypal/ cod/
│  └─ storage/                 # s3/ gcs/ azure/ cloudinary/ supabase/ gdrive/ dropbox/ onedrive/ custom/
│                                #   + media proxy helpers, OAuth connect handlers
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
SETUP_TOKEN=                         # one-time token for /setup, remove/rotate after first run
PLATFORM_STORE=file|kv|sql|supabase|mongodb|api   # persistence for hosts, tenants, users, audit (see 6.0.2 for Supabase vars)
PLATFORM_STORE_URL=                  # connection string / endpoint for the chosen store
PLATFORM_SECRET_KEY=                 # encrypts platform secrets and 2FA seeds (server only)
```
Tenant-specific values (backend URL, storage, gateways) are **configured in the dashboard, not in `.env`**.

---

## 14. Development Roadmap

**Phase 1 — Foundation**
- `PlatformStore` port + adapters, `/setup` bootstrap wizard, Super Admin auth with 2FA
- Project setup, design system, auth, scoped RBAC (platform/host/tenant), host + tenant resolution middleware, i18n
- Port/adapter scaffolding, `DataAdapterFactory`, REST adapter, mock backend (MSW) for local dev
- Secret vault (encrypted tenant credentials + OAuth tokens)
- `StoragePort`, `StorageAdapterFactory`, S3-compatible adapter, upload validation pipeline

**Phase 2 — Tenant Dashboard core**
- Supabase and MongoDB adapters + reference schemas + provider setup UI with test/initialize
- Storage adapters: GCS, Azure, Cloudinary, Supabase Storage; Google Drive/Dropbox/OneDrive via OAuth + media proxy
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

- Do tenant staff dashboards use the user's JWT + RLS or the server service role? (default: server layer with scope guards)
- Which `PlatformStore` is the production default (SQL vs KV)? Is SSO/OIDC required for Super Admin login?
- Where are host and tenant configuration persisted (KV, hosted DB, or API)? Who owns that store?
- Does the Super Admin bill hosts, and do hosts bill their tenants (two-level billing)?
- Can a host fully white-label (own domain, logo, emails) or only brand its tenants?
- Can a tenant ever move between hosts?
- Which storage providers ship in v1 (S3-compatible + Cloudinary first; cloud drives later)?
- Should the platform offer a default managed storage for tenants who don't bring their own?
- Per-tenant storage quotas: enforced by the platform or left to the provider?
- Default tenancy mode for Supabase/MongoDB (dedicated project/DB per tenant vs shared with `tenant_id`)?
- Should Supabase Auth be usable for customer login, or keep auth provider-independent?
- Can tenants switch data provider later, and is a data migration tool needed?
- Will the Super Admin or hosts provide a **reference backend** tenants can deploy, or only the API contract?
- Multi-vendor marketplace needed later (many sellers per tenant)?
- Required compliance regions (GDPR, India DPDP, PCI SAQ-A)?