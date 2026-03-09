# Appwrite Functions

This folder contains Appwrite Function handlers for RCMS backend workflows.

## Functions
- `allocateRentPayment`
- `computeTenantStatus`
- `migrateHistoricalData`
- `manageUsers`
- `bootstrapWorkspace`
- `billingCheckout`
- `billingWebhook`
- `workspaceInvitations`

## Deploying (manual)
1. Create a new Function in Appwrite Console.
2. Set runtime to Node.js.
3. Set entrypoint to each function folder's `main.js`.
4. Zip the function folder and upload, or connect a repo.

## allocateRentPayment Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)

## computeTenantStatus Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)

## manageUsers Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)

## migrateHistoricalData Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)

## bootstrapWorkspace Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_TRIAL_DAYS` (optional, defaults to `5`)
- `RCMS_DEFAULT_TRIAL_PLAN_CODE` (optional, defaults to `trial`)
- `RCMS_SIGNUP_MAX_REQUESTS` (optional, defaults to `5`)
- `RCMS_SIGNUP_WINDOW_MINUTES` (optional, defaults to `15`)

Notes:
- Caller account must be enabled and email-verified.
- One owner account maps to one workspace (existing owner workspace is reused).

Frontend env var (in app `.env`):
- `VITE_MIGRATE_HISTORICAL_DATA_FUNCTION_ID=<your-appwrite-function-id>`
- `VITE_BOOTSTRAP_WORKSPACE_FUNCTION_ID=<your-bootstrapWorkspace-function-id>`

## billingCheckout Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_BILLING_PROVIDER` (optional, defaults to `flutterwave`)
- `RCMS_BILLING_DEFAULT_CURRENCY` (optional, defaults to `UGX`)
- `RCMS_BILLING_SUCCESS_URL` (required unless provided in function payload)
- `RCMS_BILLING_CANCEL_URL` (optional)
- `RCMS_BILLING_APP_BASE_URL` (optional, fallback for success/cancel URLs)
- `RCMS_BILLING_WEBHOOK_URL` (optional; forwarded in checkout metadata)
- `RCMS_BILLING_PRODUCT_NAME` (optional; shown on provider checkout)
- `RCMS_BILLING_LOGO_URL` (optional)
- `RCMS_FLUTTERWAVE_SECRET_KEY` (required for Flutterwave)
- `RCMS_FLUTTERWAVE_BASE_URL` (optional, defaults to `https://api.flutterwave.com/v3`)
- `RCMS_CHECKOUT_MAX_REQUESTS` (optional, defaults to `8`)
- `RCMS_CHECKOUT_WINDOW_MINUTES` (optional, defaults to `10`)

## billingWebhook Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_BILLING_PROVIDER` (optional, defaults to `flutterwave`)
- `RCMS_FLUTTERWAVE_WEBHOOK_SECRET_HASH` (required for Flutterwave signature validation)
- `RCMS_BILLING_PERIOD_DAYS` (optional, defaults to `30`)
- `RCMS_BILLING_GRACE_DAYS` (optional, defaults to `7`)
- `RCMS_BILLING_MAX_RETRIES` (optional, defaults to `3`)
- `RCMS_BILLING_RETRY_INTERVAL_HOURS` (optional, defaults to `24`)

Notes:
- Webhook handler only accepts `POST`.
- Signature verification uses `RCMS_FLUTTERWAVE_WEBHOOK_SECRET_HASH`.

Additional frontend env var:
- `VITE_BILLING_CHECKOUT_FUNCTION_ID=<your-billingCheckout-function-id>`

## workspaceInvitations Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_DEFAULT_WORKSPACE_ID` (optional, defaults to `default`)
- `RCMS_INVITE_EXPIRES_DAYS` (optional, defaults to `7`)
- `RCMS_INVITE_MAX_REQUESTS` (optional, defaults to `20`)
- `RCMS_INVITE_WINDOW_MINUTES` (optional, defaults to `60`)
- `RCMS_APP_BASE_URL` (optional, used to generate `/accept-invite` URLs)
- `RCMS_INVITE_WEBHOOK_URL` (optional, receives invite payload for email delivery)

Additional frontend env var:
- `VITE_WORKSPACE_INVITATIONS_FUNCTION_ID=<your-workspaceInvitations-function-id>`
