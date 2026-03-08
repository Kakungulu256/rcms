import * as XLSX from "xlsx";

const DEFAULT_OUTPUT_FILE = "RCMS_Big_Sample_Import.xlsx";
const TODAY = "2026-03-31";

function seededRandom(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rand = seededRandom(20260308);

function pick(values) {
  return values[Math.floor(rand() * values.length)];
}

function int(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function chance(probability) {
  return rand() < probability;
}

function pad(value, len = 2) {
  return String(value).padStart(len, "0");
}

function toDateString(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-");
}

function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function monthSeries(startDate, endDate) {
  const result = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cursor <= last) {
    result.push(new Date(cursor));
    cursor = addMonths(cursor, 1);
  }
  return result;
}

const rentOptions = [
  320000, 350000, 400000, 450000, 500000, 600000, 750000, 900000, 1200000,
];

const generalExpenseDescriptions = [
  "Caretaker Salary",
  "Security Guard Salary",
  "Rubbish Collection",
  "Office Supplies",
  "Water Utility",
  "Electricity Utility",
  "Transport",
  "Internet Service",
  "Cleaning Materials",
  "Fuel",
];

const maintenanceDescriptions = [
  "Plumbing Repair",
  "Electrical Repair",
  "Painting",
  "Door Lock Replacement",
  "Roof Leak Fix",
  "Window Repair",
  "Water Pump Service",
  "Drainage Service",
  "Tile Replacement",
  "Ceiling Repair",
];

const notePhrases = [
  "Paid at office",
  "Bank deposit received",
  "Partial payment",
  "Will clear balance next week",
  "Payment confirmed",
  "Transferred via mobile banking",
  "Balance to be cleared",
  "Paid in cash",
  "Awaiting next installment",
  "No issue reported",
];

function generateHouses(total = 96) {
  const houses = [];
  for (let i = 1; i <= total; i += 1) {
    const code = `H${pad(i, 3)}`;
    const blockLetter = String.fromCharCode(64 + ((i - 1) % 8) + 1);
    houses.push({
      HouseCode: code,
      HouseName: `Block ${blockLetter} Unit ${i}`,
      MonthlyRent: pick(rentOptions),
      RentEffectiveDate: "2024-01-01",
      Status: chance(0.08) ? "inactive" : "vacant",
      Notes: chance(0.25) ? "Imported house record" : "",
    });
  }
  return houses;
}

function generateTenants(houses, total = 260) {
  const tenants = [];
  const minStart = parseDate("2023-01-01");
  const maxStart = parseDate("2026-02-01");
  const spanMonths =
    (maxStart.getUTCFullYear() - minStart.getUTCFullYear()) * 12 +
    (maxStart.getUTCMonth() - minStart.getUTCMonth());

  for (let i = 1; i <= total; i += 1) {
    const house = pick(houses);
    const moveInMonthOffset = int(0, spanMonths);
    const moveInDate = addMonths(minStart, moveInMonthOffset);
    const moveInDay = int(1, 28);
    const moveIn = new Date(
      Date.UTC(moveInDate.getUTCFullYear(), moveInDate.getUTCMonth(), moveInDay)
    );

    const isInactive = chance(0.32);
    let moveOut = "";
    if (isInactive) {
      const minMoveOutMonth = int(2, 24);
      const potentialMoveOut = addMonths(moveIn, minMoveOutMonth);
      const latest = parseDate("2026-03-15");
      if (potentialMoveOut <= latest) {
        const outDay = int(1, 28);
        const outDate = new Date(
          Date.UTC(
            potentialMoveOut.getUTCFullYear(),
            potentialMoveOut.getUTCMonth(),
            outDay
          )
        );
        if (outDate > moveIn) {
          moveOut = toDateString(outDate);
        }
      }
    }

    const hasOverride = chance(0.18);
    const overrideValue = hasOverride
      ? Math.max(200000, Math.round((Number(house.MonthlyRent) + int(-60000, 90000)) / 1000) * 1000)
      : "";

    tenants.push({
      FullName: `Sample Tenant ${pad(i, 4)}`,
      Phone: `+256700${pad(i, 6)}`,
      HouseCode: house.HouseCode,
      MoveInDate: toDateString(moveIn),
      MoveOutDate: moveOut,
      Status: moveOut ? "inactive" : "active",
      TenantType: chance(0.3) ? "new" : "old",
      RentOverride: overrideValue,
      Notes: chance(0.2) ? "Migrated from paper record" : "",
    });
  }
  return tenants;
}

function buildHouseRentLookup(houses) {
  const map = new Map();
  houses.forEach((house) => {
    map.set(house.HouseCode, Number(house.MonthlyRent) || 0);
  });
  return map;
}

function generatePayments(tenants, houseRentLookup, maxPayments = null) {
  const payments = [];
  let referenceCounter = 1;
  const today = parseDate(TODAY);

  for (const tenant of tenants) {
    const moveIn = parseDate(tenant.MoveInDate);
    const tenantEnd = tenant.MoveOutDate ? parseDate(tenant.MoveOutDate) : today;
    const months = monthSeries(moveIn, tenantEnd).slice(-16);
    const baseRent =
      tenant.RentOverride !== "" && tenant.RentOverride !== undefined
        ? Number(tenant.RentOverride)
        : houseRentLookup.get(tenant.HouseCode) ?? 0;

    for (const monthStart of months) {
      if (!chance(0.82)) continue;

      const paymentDate = new Date(
        Date.UTC(
          monthStart.getUTCFullYear(),
          monthStart.getUTCMonth(),
          int(1, Math.min(28, endOfMonth(monthStart).getUTCDate()))
        )
      );

      let factor = 1;
      const roll = rand();
      if (roll < 0.18) factor = 0.5;
      else if (roll < 0.78) factor = 1;
      else if (roll < 0.93) factor = 1.5;
      else factor = 2 + rand();

      const amount = Math.max(
        50000,
        Math.round((baseRent * factor) / 1000) * 1000
      );

      payments.push({
        TenantFullName: tenant.FullName,
        TenantId: "",
        HouseCode: tenant.HouseCode,
        Amount: amount,
        Method: chance(0.62) ? "cash" : "bank",
        PaymentDate: toDateString(paymentDate),
        Reference: `RCPT-${pad(referenceCounter, 6)}`,
        Notes: pick(notePhrases),
      });
      referenceCounter += 1;
    }
  }

  payments.sort((a, b) => a.PaymentDate.localeCompare(b.PaymentDate));
  return typeof maxPayments === "number" && maxPayments > 0
    ? payments.slice(0, maxPayments)
    : payments;
}

function generateExpenses(houses, total = 920) {
  const expenses = [];
  const start = parseDate("2024-01-01");
  const end = parseDate("2026-03-31");
  const months = monthSeries(start, end);

  for (let i = 1; i <= total; i += 1) {
    const isMaintenance = chance(0.38);
    const month = pick(months);
    const expenseDate = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), int(1, 28))
    );
    const source = chance(0.72) ? "rent_cash" : "external";
    const amount = isMaintenance
      ? int(70000, 1200000)
      : int(50000, 650000);
    const house = isMaintenance ? pick(houses) : null;

    expenses.push({
      Category: isMaintenance ? "maintenance" : "general",
      Description: isMaintenance
        ? pick(maintenanceDescriptions)
        : pick(generalExpenseDescriptions),
      Amount: Math.round(amount / 1000) * 1000,
      Source: source,
      ExpenseDate: toDateString(expenseDate),
      HouseCode: isMaintenance ? house.HouseCode : "",
      MaintenanceType: isMaintenance
        ? pick(["Electrical", "Plumbing", "Painting", "Construction", "Carpentry"])
        : "",
      Notes: chance(0.22) ? "Migrated expense entry" : "",
    });
  }

  expenses.sort((a, b) => a.ExpenseDate.localeCompare(b.ExpenseDate));
  return expenses;
}

function createWorkbook(outputFile, options = {}) {
  const {
    housesCount = 96,
    tenantsCount = 260,
    expensesCount = 920,
    maxPayments = null,
  } = options;
  const houses = generateHouses(housesCount);
  const tenants = generateTenants(houses, tenantsCount);
  const rentLookup = buildHouseRentLookup(houses);
  const payments = generatePayments(tenants, rentLookup, maxPayments);
  const expenses = generateExpenses(houses, expensesCount);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(houses, {
      header: [
        "HouseCode",
        "HouseName",
        "MonthlyRent",
        "RentEffectiveDate",
        "Status",
        "Notes",
      ],
    }),
    "Houses"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(tenants, {
      header: [
        "FullName",
        "Phone",
        "HouseCode",
        "MoveInDate",
        "MoveOutDate",
        "Status",
        "TenantType",
        "RentOverride",
        "Notes",
      ],
    }),
    "Tenants"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(payments, {
      header: [
        "TenantFullName",
        "TenantId",
        "HouseCode",
        "Amount",
        "Method",
        "PaymentDate",
        "Reference",
        "Notes",
      ],
    }),
    "Payments"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(expenses, {
      header: [
        "Category",
        "Description",
        "Amount",
        "Source",
        "ExpenseDate",
        "HouseCode",
        "MaintenanceType",
        "Notes",
      ],
    }),
    "Expenses"
  );

  XLSX.writeFile(workbook, outputFile);

  return {
    houses: houses.length,
    tenants: tenants.length,
    payments: payments.length,
    expenses: expenses.length,
    output: outputFile,
  };
}

const outputFile = process.argv[2] || DEFAULT_OUTPUT_FILE;
const housesCount = Number(process.argv[3] || 96);
const tenantsCount = Number(process.argv[4] || 260);
const expensesCount = Number(process.argv[5] || 920);
const maxPaymentsArg = Number(process.argv[6] || "");
const maxPayments = Number.isFinite(maxPaymentsArg) && maxPaymentsArg > 0
  ? maxPaymentsArg
  : null;

const summary = createWorkbook(outputFile, {
  housesCount,
  tenantsCount,
  expensesCount,
  maxPayments,
});
console.log("Generated sample migration file:");
console.log(JSON.stringify(summary, null, 2));
