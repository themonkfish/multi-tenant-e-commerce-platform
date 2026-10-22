# Tenant Backend (SQLite)

This is a standalone, local tenant REST API for exercising the frontend's
versioned catalog and order adapters. It uses SQLite by default, requires no database
server, and uses Node's built-in SQLite module. SQLite is public domain and can
be used commercially without a SQLite license fee.

The database access is behind a small tenant-data repository interface. SQLite is
the only implemented provider; another database can be added by implementing
the same repository methods and registering it in `src/repository-factory.mjs`.

## Requirements and startup

- Node.js 22.13 or newer (`node:sqlite` is built into Node)
- No npm install or external package is required

From the repository root:

```powershell
Copy-Item tenant-back-end\.env.example tenant-back-end\.env
$key = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
(Get-Content tenant-back-end\.env) -replace '^TENANT_API_KEY=.*$', "TENANT_API_KEY=$key" | Set-Content tenant-back-end\.env
npm run tenant-backend
```

Or run the API directly from this folder:

```powershell
cd tenant-back-end
node --env-file-if-exists=.env src/server.mjs
```

By default the API binds to `127.0.0.1:4100`, uses
`tenant-back-end/data/tenant-backend.sqlite`, and authorizes the tenant ID
`local-tenant`. The database directory and schema are created automatically.
Keep `.env` and the SQLite database private; the API key grants access to its
configured tenant. Change `HOST` only when deliberately deploying behind a
properly secured HTTPS reverse proxy.

Check health:

```powershell
$headers = @{ "X-API-Key" = "<same-tenant-api-key>" }
Invoke-RestMethod http://localhost:4100/v1/health -Headers $headers
```

Expected response:

```json
{
  "status": "healthy",
  "db": "up",
  "storage": "up",
  "schemaVersion": "1"
}
```

## Configure it in the frontend

The frontend stores tenant IDs created during onboarding (normally UUIDs).
For a single test Tenant, set `DEFAULT_TENANT_ID` in
`tenant-back-end/.env` to that exact ID, and configure the same API key on
both sides:

- Tenant backend: `TENANT_API_KEY` and `DEFAULT_TENANT_ID`
- Frontend Tenant Owner portal: **Store setup → REST backend connection**,
  base URL, API version `v1`, and that API key

Regular frontend configuration requires public HTTPS. For local end-to-end
testing only, the demo setup explicitly enables HTTP for loopback addresses on
an explicit port, and production always rejects HTTP. The frontend continues
to reject other private addresses and DNS targets. Do not expose the test
service to the public internet with a weak key.

For multiple tenants, replace the single-tenant variables with
`TENANT_API_KEYS`, a JSON object mapping each tenant ID to its own strong API
key. Configure the matching key separately in each tenant's frontend
connection form. A key cannot read or mutate another tenant's products.

## Seeded website demo

From the repository root, run:

```powershell
npm run seed:demo
```

This creates five sample products, an isolated platform store, and matching
tenant API credentials. It refuses to overwrite demo files and does not touch
the regular `.env`, SQLite database, or frontend platform state. Then start
`npm run tenant-backend:demo` and `npm run dev:demo` in separate terminals.
The storefront is at `http://store.localhost:3000/en`; all generated account
credentials and the Super Admin TOTP secret are stored in
`front-end/.local/demo-credentials.txt`. See the frontend README for account
roles, portal URLs, and exact demo cleanup paths.

## REST contract

All endpoints are under `/v1` and require an `X-API-Key` header except
`GET /v1/health`. The health request requires a valid tenant API key.

| Method   | Path                                         | Purpose                                         |
| -------- | -------------------------------------------- | ----------------------------------------------- |
| `GET`    | `/v1/health`                                 | API and SQLite health                           |
| `GET`    | `/v1/products?tenantId=<id>&page=1&limit=20` | Tenant-scoped product page                      |
| `POST`   | `/v1/products`                               | Create a product; body includes `tenantId`      |
| `GET`    | `/v1/products/<id>`                          | Read product within the API-key tenant          |
| `PATCH`  | `/v1/products/<id>`                          | Update product fields within the API-key tenant |
| `DELETE` | `/v1/products/<id>`                          | Delete product within the API-key tenant        |
| `POST`   | `/v1/orders`                                 | Idempotently save a platform order snapshot     |
| `GET`    | `/v1/orders/<id>`                            | Read an order within the API-key tenant          |

Product fields follow the frontend catalog contract: `title`, lowercase
hyphenated `slug`, `status` (`draft`, `active`, or `archived`), `price` with a
non-negative integer `amount` and uppercase three-letter `currency`, and an
optional `sku`. List responses use `{ "data": [], "meta": { "page", "limit",
"total" } }`. Duplicate slugs within a tenant return HTTP 409. Every database
query is scoped to the tenant associated with the API key.

`POST /orders` accepts an order snapshot with `id`, `tenantId`, `customerId`,
`status`, `createdAt`, `items`, `total`, `currency`, and `itemCount`. The API
key binds the write to one tenant; a mismatched `tenantId`, inconsistent line
items/totals, unsupported fields, or invalid values are rejected. Sending the
same ID and payload again returns the stored order without creating a
duplicate. Reusing an ID with different order data returns HTTP 409. The
platform-calculated total remains authoritative; the Tenant API stores the
received snapshot and does not process payments, reserve inventory, or fulfill
the order.

Example create and list requests:

```powershell
$headers = @{ "X-API-Key" = "<same-tenant-api-key>" }
$body = @{
  tenantId = "local-tenant"
  title = "Canvas Bag"
  slug = "canvas-bag"
  status = "active"
  price = @{ amount = 1999; currency = "USD" }
  sku = "BAG-1"
} | ConvertTo-Json
Invoke-RestMethod http://localhost:4100/v1/products -Method Post -Headers $headers -ContentType "application/json" -Body $body
Invoke-RestMethod "http://localhost:4100/v1/products?tenantId=local-tenant&page=1&limit=20" -Headers $headers
```

## Database configuration

SQLite is the default and currently implemented provider:

```dotenv
DATABASE_PROVIDER=sqlite
DATABASE_FILE=./data/tenant-backend.sqlite
```

`DATABASE_FILE` may be an absolute path or a path relative to the process's
current working directory. Use `:memory:` only for tests. SQLite creates the
database and schema on first start; products are isolated with `tenant_id`
and a per-tenant unique slug.

The repository factory is the extension point for another database. A new
provider must implement `health`, product CRUD, `createOrder`, `getOrder`, and
`close`; it is not supported merely by changing `DATABASE_PROVIDER`.

## Tests

Run from the repository root:

```powershell
npm run test:tenant-backend
```

Tests create a temporary SQLite database and exercise health, API-key and
tenant isolation, catalog CRUD, validation, duplicate slugs, and pagination.
