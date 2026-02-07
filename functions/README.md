# Appwrite Functions

This folder contains placeholder handlers for Appwrite Functions.

## Functions
- `allocateRentPayment`
- `computeTenantStatus`
- `migrateHistoricalData`

## Deploying (manual)
1. Create a new Function in Appwrite Console.
2. Set runtime to Node.js.
3. Set entrypoint to `src/index.js`.
4. Zip the function folder and upload, or connect a repo.

Each function currently returns a placeholder response so you can verify wiring.

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
