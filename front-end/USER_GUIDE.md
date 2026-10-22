# Website User Guide

This guide covers setting up the website and using the platform as a Super
Admin, Host Owner, Tenant Owner, Tenant Staff member, Customer, or storefront visitor. The current product is
a platform and storefront preview: several production commerce features are
not implemented yet. Read [Current limitations](#current-limitations) before
using it with real customers.

## 1. Start the website locally

### Requirements

- Node.js 20.19.0 or newer (Node.js 22 LTS or newer recommended)
- npm

### Install and configure

From the repository's `front-end` directory:

```powershell
npm install
Copy-Item .env.example .env.local
```

Generate the application secrets in PowerShell and add them to `.env.local`:

```powershell
$key = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$session = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
$setup = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
Add-Content .env.local "PLATFORM_SECRET_KEY=$key"
Add-Content .env.local "SESSION_SECRET=$session"
Add-Content .env.local "SETUP_TOKEN=$setup"
```

The example configuration uses the local file store:

- `PLATFORM_STORE=file`
- `PLATFORM_STORE_FILE=.local/platform-store.json`
- `NEXT_PUBLIC_PLATFORM_DOMAIN=localhost`

The file store is for a single local development instance only. It contains
platform state and is ignored by Git; do not publish it or delete it to reset
the application.

Start the website from the `front-end` directory:

```powershell
npm run dev
```

Alternatively, from the repository root, run `npm run dev`.

Open [http://localhost:3000](http://localhost:3000). The site redirects to the
English locale at `/en`. The default home page is a foundation placeholder
unless the current request hostname resolves to an active tenant.

## Try the isolated demo

From the repository root, run `npm run seed:demo`. This creates a separate
demo-only platform store, SQLite tenant catalog, matching API key, sample
products, owner accounts, a catalog Staff account, a Customer account with
sample orders, and private local credentials. It refuses to
overwrite demo files and does not change your normal platform store or
`.env.local`.

Start these commands in separate repository-root terminals:

```powershell
npm run tenant-backend:demo
npm run dev:demo
```

Use the port printed by Next.js. The storefront is
`http://store.localhost:<port>/en`; if Windows cannot resolve
`store.localhost`, add `127.0.0.1 store.localhost host.localhost` to the
Windows hosts file using an elevated editor. Demo account passwords and the
Super Admin TOTP secret are stored in
`front-end/.local/demo-credentials.txt`. The file includes the Staff and
Customer demo credentials and the account URLs below. If you already created
the demo data before these roles were added, run `npm run seed:demo:roles`
once from the repository root. This additive command only updates the isolated
demo store, refuses to overwrite existing role accounts, and writes credentials
to `front-end/.local/demo-role-credentials.txt`; it does not reset your existing
demo data. To reset the fixture, stop both demo
servers and manually remove only the demo-specific files listed in the
frontend README; leave your ordinary `.env.local` and `.local/platform-store.json`
untouched.

## 2. Create the first Super Admin

Bootstrap runs once per platform store:

1. Open [http://localhost:3000/en/setup](http://localhost:3000/en/setup).
2. Enter the `SETUP_TOKEN` value from `.env.local`.
3. Enter the Super Admin email address and create a password of at least 14
   characters.
4. Enter the platform hostname, such as `localhost` for local development or
   the production hostname for a deployment.
5. Scan the displayed QR code with an authenticator app. If needed, the
   displayed manual setup key can be entered into the authenticator instead.
6. Enter the current six-digit authenticator code and finish setup.
7. Save the ten recovery codes somewhere secure. Each code is one-use and is
   only displayed at this point.
8. Remove `SETUP_TOKEN` from the environment after setup. Restart the local
   server if you change `.env.local`.
9. Sign in at [http://localhost:3000/en/super-admin/login](http://localhost:3000/en/super-admin/login).

The setup wizard does not configure the platform store, email delivery, theme,
legal pages, or the first Host. Those tasks are handled separately or are not
available yet.

## 3. Super Admin: create and manage Hosts

After signing in, open `/en/super-admin`. The current dashboard manages Hosts.

### Create a Host

In **Create a host**, enter:

- **Host name** and a lowercase **Host slug** (letters, numbers, and hyphens)
- **Plan** (a label, for example `starter`)
- **Maximum tenants** and **Maximum custom domains**
- Optional support email
- Optional comma-separated host domains, entered as hostnames only, such as
  `host.example.com` (do not include `https://` or a path)

Select **Create host**. The new Host starts inactive. Check the configured
slug, domains, and limits, then select **Activate host**.

To pause an active Host, select **Suspend host**. Suspension prevents its
Host Owner from using the portal and also makes its tenants unavailable.

### Invite the Host Owner

1. On the active Host, enter the owner's email in the invitation field.
2. Select **Invite owner**.
3. Securely share the resulting one-time URL with that person. Email is not
   sent automatically.
4. The invitation expires after 24 hours and can be accepted once.
5. The invitee opens the link, chooses a password of at least 14 characters,
   and is signed in after accepting.

The Host Owner can later sign in at `/en/host/login`. Do not post invitation
URLs in public channels or include them in screenshots.

## 4. Host Owner: create and manage Tenants

The Host Owner opens `/en/host` (or signs in at `/en/host/login`). The portal
shows only that Host's Tenants and enforces the Host's tenant and domain limits.

### Create a Tenant

In **Create a tenant**, enter:

- **Store name**
- Lowercase **Tenant slug** (letters, numbers, and hyphens)
- **Plan** label
- Optional comma-separated domains, entered as hostnames only, for example
  `store.example.com`

Select **Create tenant**. The Tenant starts in `pending` status. Select
**Activate tenant** on its row when ready. Select **Suspend tenant** to
temporarily disable its access.

Tenant creation records the domain and metadata but does not purchase a domain,
configure DNS, issue TLS certificates, or provision a storefront/backend. Those
steps must be arranged separately; see [Current limitations](#current-limitations).

### Invite the Tenant Owner

1. Activate the Tenant first.
2. On its row, enter the Tenant Owner's email and choose **Invite tenant
   owner**.
3. Securely share the one-time invitation URL. Email is not sent automatically.
4. The link expires after 24 hours and can be accepted once. The invitee
   chooses a password of at least 14 characters and is signed in automatically.

The Tenant Owner can later sign in at `/en/tenant/login`.

## 5. Tenant Owner: configure the store

Open `/en/tenant`, or sign in at `/en/tenant/login`. The portal displays the
store status, assigned plan, and managing Host.

### Set the store identity

Under **Brand and localization**, enter:

- Store display name and optional description
- Optional HTTPS logo URL
- Primary and accent colors
- Default locale and comma-separated supported locales (for example `en,
fr-CA`)
- Default currency and comma-separated supported currencies using ISO 4217
  codes (for example `USD`, `EUR`)

Select **Save store settings**. These values are stored as tenant metadata and
are used by the storefront preview. Locale options do not currently translate
the customer-facing pages.

### Connect a REST backend

Before connecting, the Tenant needs an HTTPS backend that implements the
platform REST contract:

1. Under **Store setup → REST backend connection**, enter the public HTTPS
   backend base URL, without a path or query string (for example
   `https://api.example.com`).
2. Enter the API version (typically `v1`) and API key.
3. Select **Save backend connection**.
4. Select **Test saved connection**. The test calls
   `/{apiVersion}/health` and reports the connection status and any missing
   components.

Authentication uses the `X-API-Key` header. The API key is encrypted at rest,
is write-only, and cannot be retrieved in the form. Leave the API-key field
blank to keep the existing key; enter a new key to replace it.

Only HTTPS on the standard port is supported. Private/internal IP targets,
redirects, and unsafe DNS results are blocked. The backend hostname must be
publicly reachable from the application server. The health endpoint must return
JSON with a non-empty `status` and `db` and `storage` values of `up` or `down`.

### Manage products

From the Tenant dashboard, select **Open product manager**. The product manager
requires a configured, reachable REST backend.

- **New product:** enter title, slug, status, whole-number price amount,
  three-letter currency, and optional SKU; choose **Create product**.
- **Edit:** choose **Edit** next to a product, change its fields, then choose
  **Save changes**.
- **Delete:** choose **Delete** and confirm.
- Draft and archived products remain in the backend catalog but are not
  displayed in the public storefront catalog; only active products appear
  there.

If no backend is configured or the backend is unreachable, product operations
will fail or the storefront will show no active products. Product data is
managed by the connected tenant backend, not by the platform's file/Supabase
platform store.

### Manage Staff

On the Tenant dashboard, use **Staff accounts** to create a Staff login. Set
an email, an initial password of at least 14 characters, and catalog read/write
permissions. Share the initial password securely. Use **Disable** to revoke
that Staff member's access, or **Reactivate** to restore it. Use the password
reset field to set a new password of at least 14 characters and share it
securely.

Staff sign in at `/en/tenant/staff/login` on the Tenant's active domain. They
can open the product manager only with `catalog:read`; `catalog:write` enables
product changes and automatically includes catalog read. Staff cannot manage
other accounts, change store settings, or change backend connections. These
limits are enforced by the server, not only by the interface. Disabling an
account blocks subsequent requests immediately. Password resets change the
credential for future sign-ins; existing sessions remain valid until they
expire (within 30 minutes).

## 6. Customer: register and view account orders

On the Tenant storefront domain, open `/en/customer/login` to register with an
email and password of at least 14 characters, or sign in to an existing account.
Registration is Tenant-specific. After signing in, open `/en/account` to view
orders associated with that Customer account in that Tenant. A Customer cannot
read another customer's orders or access another Tenant's account data.

In the demo fixture, use the Customer credentials from
`front-end/.local/demo-credentials.txt` (or
`front-end/.local/demo-role-credentials.txt` when using the additive fixture
command). The fixture has two Customers with separate sample orders.

## 7. Customer: place an order

The storefront pages are resolved using the exact request hostname. Once a
tenant hostname is registered, active, pointed to this application, and served
by the deployment, visitors can use:

- `/en` — branded storefront preview
- `/en/products` — active product catalog
- `/en/products/{product-slug}` — product detail
- `/en/cart` — browser-persisted cart
- `/en/checkout/success?orderId=...` — signed-in Customer's order confirmation
- `/en/account` — Customer's server-stored order history

To place an order:

1. Open the tenant storefront hostname.
2. Browse the catalog and add active products to the cart.
3. In the cart, adjust quantities or remove items.
4. Choose **Sign in to place order** and sign in or create a Customer account.
   The cart is preserved while you authenticate.
5. Choose **Place order**. The server reloads each product from the connected
   Tenant catalog, rejects unavailable products, and calculates the total from
   current prices rather than trusting the browser's cart values.
6. Review the order confirmation or open **My account** to view the order.

Orders and product-price snapshots are stored server-side in the platform
store and are visible only to the owning Customer in that Tenant. Repeated
submission of the same checkout request does not create a duplicate order.
This slice does not collect payment details, charge a payment method, reserve
inventory, calculate tax/shipping, create an order in the connected Tenant
backend, or send a receipt. Do not treat an order as paid or fulfilled.

## 8. Sign out

Each management portal has a **Sign out** button in its header. Signing out
clears that portal's session cookie. Use separate browser profiles when testing
multiple owner roles at the same time.

## 9. Production deployment

For production, use a dedicated Supabase project for platform-owned records;
do not use the local file store. Configure these as server-side deployment
secrets, never as `NEXT_PUBLIC_*` values:

```dotenv
PLATFORM_STORE=supabase
PLATFORM_SUPABASE_URL=https://<platform-project-ref>.supabase.co
PLATFORM_SUPABASE_SERVICE_KEY=<server-only-service-key>
PLATFORM_SECRET_KEY=<random-secret>
SESSION_SECRET=<random-secret-of-at-least-32-characters>
SETUP_TOKEN=<random-one-time-token-of-at-least-32-characters>
NEXT_PUBLIC_PLATFORM_DOMAIN=<platform-hostname>
```

Before launch:

1. Create the dedicated platform Supabase project.
2. Apply all reviewed SQL migrations in `supabase/migrations/` in order.
3. Configure the production environment variables in the hosting provider's
   secret manager. Production requires Supabase, `PLATFORM_SECRET_KEY`, and
   `SESSION_SECRET`.
4. Deploy and complete one-time setup at `/en/setup` using the real platform
   hostname. Save recovery codes.
5. Remove `SETUP_TOKEN` from the hosting environment after setup and refresh
   the deployment configuration.
6. Test the Super Admin → Host → Tenant onboarding flow and configure external
   DNS/TLS/backend services separately.
7. Back up platform records and protect the service key and encryption key.

Applying migrations and deploying the platform do not migrate records from a
local file store. There is no built-in platform data export/import tool.

## Current limitations

- The website is a frontend platform foundation, not a complete production
  commerce service.
- Only English is configured as an application locale; saved tenant locales
  are metadata and do not translate storefront pages.
- Tenant domain records do not automatically create DNS records, TLS
  certificates, or hosting-provider domain configuration.
- The tenant REST integration supports health checks and catalog operations;
  tenant Supabase/MongoDB provider adapters are not implemented.
- Payment processing, Tenant backend order synchronization, inventory,
  shipping, taxes, storage uploads, and email invitations are not available.
  Orders are saved in the platform store as unpaid order records.
- Cart contents remain browser-local until checkout. Customer orders and
  product-price snapshots are stored server-side and scoped to the Customer
  and Tenant.
- The Super Admin dashboard currently focuses on Host creation and status;
  broader platform administration remains on the roadmap.

## Troubleshooting

| Symptom                             | What to check                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/setup` says setup is unavailable  | Confirm the server has `SETUP_TOKEN`, it is at least 32 characters, and this platform store has not already been initialized.                                                     |
| Login does not work after setup     | Confirm the email and password, check whether the Host/Tenant is active, and ensure you are using the correct portal login page.                                                  |
| Invitation cannot be accepted       | It may have expired after 24 hours, already been used, or the associated Host/Tenant may not be active. Ask the managing administrator for a new invitation.                      |
| Host or Tenant creation is rejected | Check the unique slug/domain, reserved names, active parent Host, and configured tenant/domain limits.                                                                            |
| Tenant portal redirects to login    | Confirm the Tenant and its Host are active and access the portal using the hostname/domain permitted for that session.                                                            |
| REST connection test fails          | Verify public HTTPS on port 443, API version, `/{apiVersion}/health`, `X-API-Key`, and JSON response fields. Private/internal addresses and redirects are intentionally rejected. |
| Storefront shows no products        | Confirm the tenant domain resolves to the app, the Tenant is active, REST connection works, and at least one product is active.                                                   |
| Rate limit message appears          | Wait for the limit window to expire; restarting the app does not necessarily clear stored counters.                                                                               |

For platform storage and migration details, see
[PROJECT_STATUS_AND_PLATFORM_STORE.md](./PROJECT_STATUS_AND_PLATFORM_STORE.md).
For the product scope and architecture, see [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).
