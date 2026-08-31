# White-label QR + KDS Restaurant Platform

Standalone monorepo for a configurable restaurant QR-ordering and kitchen platform. It is designed to live in its own Git repository and use an independent Firebase project, Render services, database, domains, and credentials.

## Product scope

- Customer QR menu and table ordering
- Tables and downloadable QR codes
- Menu, category, item, and availability management
- Kitchen Display System (KDS)
- Staff accounts and role-based access
- Restaurant branding and ordering settings
- Counter, UPI, and Razorpay card payment configuration
- Owner subscription plans, Razorpay checkout, invoices, and cancellation controls

Orders, sessions, tenant isolation, storage, payments, billing, and realtime events remain in the API because these visible modules depend on them.

## Prerequisites

- Node.js 22 (the pinned version is in `.node-version`)
- npm 10 or 11
- PostgreSQL
- A separate Firebase project with Phone authentication enabled

## Clean-clone setup

```bash
git clone <white-label-repository-url>
cd <white-label-repository-directory>
cp .env.example .env
npm ci
npm run db:deploy -w @whitelabel/api
npm run dev
```

The root development command loads `.env` once and passes it to all three workspaces.

- QR menu: `http://localhost:5173`
- Restaurant dashboard: `http://localhost:5174`
- API and health check: `http://localhost:4000` and `http://localhost:4000/api/health`

Use `npm run db:seed -w @whitelabel/api` only when you explicitly want local demonstration data. Never enable production seeding.

## Branding

Set `VITE_PRODUCT_NAME`, `VITE_SUPPORT_EMAIL`, `VITE_SALES_URL`, and `VITE_BRAND_WORDMARK`. Replace the logo, wordmark, favicon, and PWA artwork under each web application's `public/` directory before launch. Vite variables are compiled at build time, so changing one requires rebuilding its static site.

## Firebase

Create a Firebase project dedicated to this product:

1. Enable Firebase Authentication and the Phone provider.
2. Add the dashboard's Render and custom domains to Firebase Authorized domains.
3. Put the web SDK values in the dashboard service's `VITE_FIREBASE_*` variables.
4. Create an Admin SDK service account, store its complete JSON as the API's `FIREBASE_SERVICE_ACCOUNT_JSON`, and set the matching `FIREBASE_PROJECT_ID`.

Never commit the service-account file or JSON. Firebase web configuration is delivered to browsers by design, but it should still be supplied through deployment configuration instead of hard-coded into source.

## Render deployment

Deploy `render.yaml` as a Blueprint in the Render workspace that should receive the bill. The Blueprint creates separately named resources in that workspace:

- `grabtu-api`
- `grabtu-web`
- `grabtu-dashboard`
- `grabtu-db`
- a 1 GB persistent API disk for locally stored QR images

Resources in the same Render workspace are billed together; they remain independently deployable and do not share data or credentials with the main KashNom product.

Before creating the Blueprint, have these values ready:

- Public HTTPS URLs without trailing slashes: `API_ORIGIN`, `CUSTOMER_ORIGIN`, and `DASHBOARD_ORIGIN`
- `MASTER_ADMIN_ORIGIN`: use the dashboard origin unless a separate admin frontend is deployed
- A real operator phone number for `MASTER_ADMIN_PHONE`
- Firebase Admin and web configuration
- VAPID public/private keys and a real `mailto:` value for `VAPID_SUBJECT`
- Product support/sales values for both static sites
- When subscription billing is enabled, add all Razorpay platform billing values together: key ID, key secret, and Starter, Growth, and Business plan IDs. Leave all five unset until then; partial configuration is rejected.

Render generates the JWT, payment-encryption, and billing-webhook secrets. Database migrations run as the API's pre-deploy command, before new code is started. The database accepts only private-network connections by default.

The API intentionally refuses to start in production if required origins, operator phone, push keys, or cryptographic secrets are missing or unsafe. If custom domains are added later, update the API origin allowlist values and both static sites' `VITE_*_ORIGIN` values, then redeploy all three services.

You can validate the Blueprint before connecting it:

```bash
render blueprints validate render.yaml
```

### Storage and scaling

The default Blueprint mounts `/var/data` and stores QR images at `/var/data/uploads`, so redeploys do not erase them. A Render persistent disk limits the API to one instance and introduces a brief restart during deployment. Before horizontally scaling, move QR storage to an S3-compatible service, configure every `S3_*` value, set `QR_STORAGE_PROVIDER=s3`, and remove the disk only after existing files are migrated.

### Payments and billing

Configure all Razorpay platform credentials and subscription plan IDs together. The platform subscription webhook is:

```text
https://<api-domain>/api/billing/webhook
```

Use the generated `BILLING_WEBHOOK_SECRET` as its secret. Restaurant-specific card-payment webhook URLs and secrets are generated from the Payment Settings flow. `API_ORIGIN` must be the public API URL so those URLs are correct.

## Docker builds

Use the repository root as the Docker build context:

```bash
docker build -f services/api/Dockerfile -t white-label-api .
docker build -f apps/customer-web/Dockerfile -t white-label-menu .
docker build -f apps/restaurant-dashboard/Dockerfile -t white-label-dashboard .
```

Pass each frontend's `VITE_*` values as Docker build arguments for a production image. Run Prisma migrations as a separate release step before starting the API container.

## Verification

From a clean checkout, run:

```bash
npm ci
npm run verify
```

`verify` checks repository safety, runs the API and dashboard unit tests, checks TypeScript, builds every production workspace, and audits production dependencies at the configured threshold. GitHub Actions runs the same gate, and Render waits for checks to pass before auto-deploying.

Before the first live launch, also verify phone login, QR ordering, KDS realtime transitions, staff permissions, counter/UPI/card orders, subscription checkout, both Razorpay webhooks, a database migration, and a service restart with an existing QR image.
