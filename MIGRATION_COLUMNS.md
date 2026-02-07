# Excel Migration Columns

These column headers are recommended for Excel imports. Dates should use `YYYY-MM-DD`.

## Sheet: Houses
- `HouseCode` (required)
- `HouseName` (optional)
- `MonthlyRent` (required, number)
- `Status` (required: `occupied` | `vacant` | `inactive`)
- `Notes` (optional)

## Sheet: Tenants
- `FullName` (required)
- `Phone` (optional)
- `HouseCode` (required; matches Houses.HouseCode)
- `MoveInDate` (required; `YYYY-MM-DD`)
- `MoveOutDate` (optional; `YYYY-MM-DD`)
- `Status` (required: `active` | `inactive`)
- `RentOverride` (optional; number)
- `Notes` (optional)
- `IsMigrated` (optional; `true/false`)

## Sheet: Payments
- `TenantFullName` (required; or use `TenantId` if you prefer IDs)
- `HouseCode` (optional but helpful for disambiguation)
- `Amount` (required; number)
- `Method` (required: `cash` | `bank`)
- `PaymentDate` (required; `YYYY-MM-DD`)
- `Reference` (optional)
- `Notes` (optional)
- `IsMigrated` (optional; `true/false`)

## Sheet: Expenses
- `Category` (required: `general` | `maintenance`)
- `Description` (required)
- `Amount` (required; number)
- `Source` (required: `rent_cash` | `external`)
- `ExpenseDate` (required; `YYYY-MM-DD`)
- `HouseCode` (required if Maintenance; optional otherwise)
- `MaintenanceType` (optional)
- `Notes` (optional)
- `IsMigrated` (optional; `true/false`)
