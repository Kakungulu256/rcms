import { Client, Databases, ID, Query } from "node-appwrite";

const REQUIRED_FIELDS = ["tenantId", "amount", "method", "paymentDate"];

function getEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

function parseJson(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function buildMonthSeries(moveInDate, paymentDate, extraMonths = 0) {
  const start = startOfMonth(new Date(moveInDate));
  const end = startOfMonth(new Date(paymentDate));
  const months = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  for (let i = 0; i < extraMonths; i += 1) {
    months.push(monthKey(addMonths(end, i + 1)));
  }
  return months;
}

function buildPaidByMonth(payments) {
  const totals = {};
  payments.forEach((payment) => {
    if (!payment.allocationJson) return;
    try {
      const allocation = JSON.parse(payment.allocationJson);
      Object.entries(allocation).forEach(([month, amount]) => {
        totals[month] = (totals[month] ?? 0) + Number(amount);
      });
    } catch {
      // ignore malformed allocations
    }
  });
  return totals;
}

function parseHistory(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.effectiveDate && typeof item.amount === "number")
      .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
  } catch {
    return [];
  }
}

function buildRentByMonth(months, tenantHistoryJson, houseHistoryJson, fallbackRent) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = tenantHistory.length > 0 ? tenantHistory : houseHistory;
  const rentByMonth = {};
  months.forEach((month) => {
    const monthStart = `${month}-01`;
    const entry = history.filter((item) => item.effectiveDate <= monthStart).at(-1);
    rentByMonth[month] = entry?.amount ?? fallbackRent;
  });
  return rentByMonth;
}

function allocatePayment({ amount, months, paidByMonth, rentByMonth }) {
  let remaining = amount;
  const allocation = {};
  months.forEach((month) => {
    if (remaining <= 0) return;
    const paid = paidByMonth[month] ?? 0;
    const rent = rentByMonth[month] ?? 0;
    const due = Math.max(rent - paid, 0);
    if (due <= 0) return;
    const applied = Math.min(due, remaining);
    allocation[month] = applied;
    remaining -= applied;
  });
  return { allocation, remaining };
}

export default async (context) => {
  const { req, res, log, error: logError } = context;
  const body = parseJson(req.body);
  if (!body) {
    log?.("Invalid JSON body.");
    return res.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const endpoint =
    getEnv("RCMS_APPWRITE_ENDPOINT") ||
    getEnv("APPWRITE_ENDPOINT") ||
    getEnv("APPWRITE_FUNCTION_API_ENDPOINT");
  const projectId =
    getEnv("RCMS_APPWRITE_PROJECT_ID") ||
    getEnv("APPWRITE_PROJECT_ID") ||
    getEnv("APPWRITE_FUNCTION_PROJECT_ID");
  const apiKey =
    getEnv("RCMS_APPWRITE_API_KEY") ||
    getEnv("APPWRITE_API_KEY") ||
    getEnv("APPWRITE_FUNCTION_API_KEY");
  const databaseId = getEnv("RCMS_APPWRITE_DATABASE_ID") || "rcms";

  if (!endpoint || !projectId) {
    log?.("Missing Appwrite endpoint or project in function env.");
    return res.json(
      {
        ok: false,
        error:
          "Missing Appwrite credentials. Set RCMS_APPWRITE_ENDPOINT and RCMS_APPWRITE_PROJECT_ID.",
      },
      500
    );
  }
  log?.(
    `Env presence: endpoint=${Boolean(endpoint)} project=${Boolean(projectId)} apiKey=${Boolean(apiKey)} db=${Boolean(databaseId)}`
  );
  log?.(`Endpoint: ${endpoint}`);
  log?.(`Project: ${projectId}`);
  log?.(`Database: ${databaseId}`);

  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  if (apiKey) {
    client.setKey(apiKey);
    log?.("Using function API key credentials.");
  } else {
    return res.json(
      {
        ok: false,
        error: "Missing credentials. Provide RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }
  const databases = new Databases(client);

  const {
    tenantId,
    amount,
    method,
    paymentDate,
    reference,
    notes,
    reversePaymentId,
  } = body;

  if (reversePaymentId) {
    try {
      log?.(`Reversing payment ${reversePaymentId}`);
      log?.("Fetching original payment...");
      const original = await databases.getDocument(databaseId, "payments", reversePaymentId);
      log?.("Creating reversal document...");
      const reversal = await databases.createDocument(databaseId, "payments", ID.unique(), {
        tenant: original.tenant,
        amount: -Math.abs(original.amount),
        method: original.method,
        paymentDate: paymentDate ?? original.paymentDate,
        reference,
        notes: notes ?? "Reversal",
        isReversal: true,
        reversedPaymentId: original.$id,
        allocationJson: original.allocationJson ?? null,
      });
      log?.("Reversal created.");
      return res.json({ ok: true, reversal });
    } catch (error) {
      logError?.(`Failed to reverse payment: ${error?.message ?? "Unknown error"}`);
      if (error?.response) {
        logError?.(`Response: ${JSON.stringify(error.response)}`);
      }
      if (error?.code) {
        logError?.(`Code: ${error.code}`);
      }
      return res.json({ ok: false, error: "Failed to reverse payment." }, 500);
    }
  }

  const missing = REQUIRED_FIELDS.filter((key) => body[key] === undefined);
  if (missing.length > 0) {
    log?.(`Missing fields: ${missing.join(", ")}`);
    return res.json({ ok: false, error: `Missing fields: ${missing.join(", ")}` }, 400);
  }

  try {
    log?.(`Allocating payment for tenant ${tenantId}`);
    const tenant = await databases.getDocument(databaseId, "tenants", tenantId);
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? null;
    const house = houseId
      ? await databases.getDocument(databaseId, "houses", houseId)
      : null;
    const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;

    const paymentList = await databases.listDocuments(databaseId, "payments", [
      Query.equal("tenant", [tenantId]),
      Query.orderAsc("paymentDate"),
    ]);
    const paidByMonth = buildPaidByMonth(paymentList.documents);

    const months = buildMonthSeries(tenant.moveInDate, paymentDate, 24);
    const rentByMonth = buildRentByMonth(
      months,
      tenant.rentHistoryJson ?? null,
      house?.rentHistoryJson ?? null,
      rent
    );
    const { allocation, remaining } = allocatePayment({
      amount,
      months,
      paidByMonth,
      rentByMonth,
    });

    const allocationJson = JSON.stringify(allocation);
    const recordedBy = req.headers["x-appwrite-user-id"] ?? null;

    const payment = await databases.createDocument(
      databaseId,
      "payments",
      ID.unique(),
      {
        tenant: tenantId,
        amount,
        method,
        paymentDate,
        reference,
        notes,
        allocationJson,
        recordedBy,
      }
    );

    return res.json({
      ok: true,
      payment,
      allocation,
      remaining,
    });
  } catch (error) {
    logError?.(`Allocation failed: ${error?.message ?? "Unknown error"}`);
    return res.json({ ok: false, error: "Failed to allocate payment." }, 500);
  }
};
