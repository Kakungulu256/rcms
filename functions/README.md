# Appwrite Functions

This folder contains Appwrite Function handlers for RCMS backend workflows.

## Functions
- `allocateRentPayment`
- `computeTenantStatus`
- `migrateHistoricalData`
- `manageUsers`
- `bootstrapWorkspace`

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
- `RCMS_APPWRITE_TEAM_ADMIN_ID`
- `RCMS_APPWRITE_TEAM_CLERK_ID`
- `RCMS_APPWRITE_TEAM_VIEWER_ID`

## migrateHistoricalData Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_APPWRITE_TEAM_ADMIN_ID` (optional if team names are exactly `Admin`/`admin`)
- `RCMS_APPWRITE_TEAM_CLERK_ID` (optional if team names are exactly `Clerk`/`clerk`)

## bootstrapWorkspace Environment
Set these env vars in the Appwrite Function:
- `RCMS_APPWRITE_ENDPOINT`
- `RCMS_APPWRITE_PROJECT_ID`
- `RCMS_APPWRITE_API_KEY`
- `RCMS_APPWRITE_DATABASE_ID` (optional, defaults to `rcms`)
- `RCMS_APPWRITE_TEAM_ADMIN_ID` (required unless an Appwrite team named `admin` exists)
- `RCMS_TRIAL_DAYS` (optional, defaults to `5`)
- `RCMS_DEFAULT_TRIAL_PLAN_CODE` (optional, defaults to `trial`)

Frontend env var (in app `.env`):
- `VITE_MIGRATE_HISTORICAL_DATA_FUNCTION_ID=<your-appwrite-function-id>`
- `VITE_BOOTSTRAP_WORKSPACE_FUNCTION_ID=<your-bootstrapWorkspace-function-id>`
