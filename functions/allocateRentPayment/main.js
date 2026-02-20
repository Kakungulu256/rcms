import { Client, Databases, ID, Query } from "node-appwrite";

const REQUIRED_FIELDS = ["tenantId", "amount", "method", "paymentDate"];

function getEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

function parseJson(body) {
  if (!body) return null;
  if (typeof body === "object") return body;
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
  const seenReversalTargets = new Set();
  payments.forEach((payment) => {
    if (payment.isReversal && payment.reversedPaymentId) {
      if (seenReversalTargets.has(payment.reversedPaymentId)) return;
      seenReversalTargets.add(payment.reversedPaymentId);
    }
    if (!payment.allocationJson) return;
    try {
      const allocation = JSON.parse(payment.allocationJson);
      const multiplier = payment.isReversal ? -1 : 1;
      Object.entries(allocation).forEach(([month, amount]) => {
        const value = Number(amount) * multiplier;
        if (!Number.isFinite(value) || value === 0) return;
        totals[month] = (totals[month] ?? 0) + value;
      });
    } catch {
      // ignore malformed allocations
    }
  });
  return totals;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function allocateReversal({ amount, paidByMonth }) {
  let remaining = roundMoney(Math.max(Number(amount) || 0, 0));
  const allocation = {};
  const months = Object.entries(paidByMonth)
    .filter(([, paid]) => Number(paid) > 0)
    .map(([month]) => month)
    .sort((a, b) => b.localeCompare(a));

  months.forEach((month) => {
    if (remaining <= 0) return;
    const paid = roundMoney(Math.max(Number(paidByMonth[month] ?? 0), 0));
    if (paid <= 0) return;
    const applied = roundMoney(Math.min(paid, remaining));
    if (applied <= 0) return;
    allocation[month] = applied;
    remaining = roundMoney(remaining - applied);
  });

  return { allocation, remaining };
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

function entryPriority(entry) {
  return entry?.source === "house" ? 0 : 1;
}

function buildEffectiveHistory(tenantHistory, houseHistory) {
  const tenantSpecificHistory = tenantHistory.filter((entry) => entry?.source !== "house");
  const baseHistory =
    tenantSpecificHistory.length > 0
      ? [...houseHistory, ...tenantSpecificHistory]
      : houseHistory.length > 0
        ? houseHistory
        : tenantHistory;

  return baseHistory.sort((a, b) => {
    const dateOrder = String(a.effectiveDate).localeCompare(String(b.effectiveDate));
    if (dateOrder !== 0) return dateOrder;
    return entryPriority(a) - entryPriority(b);
  });
}

function buildRentByMonth(months, tenantHistoryJson, houseHistoryJson, fallbackRent) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = buildEffectiveHistory(tenantHistory, houseHistory);
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

async function listAllTenantPayments(databases, databaseId, tenantId) {
  const documents = [];
  let cursor = null;
  const pageSize = 100;

  while (true) {
    const queries = [
      Query.equal("tenant", [tenantId]),
      Query.orderAsc("paymentDate"),
      Query.limit(pageSize),
    ];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }
    const page = await databases.listDocuments(databaseId, "payments", queries);
    documents.push(...page.documents);
    if (page.documents.length < pageSize) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }

  return documents;
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

  const {
    jwt,
    tenantId,
    amount,
    method,
    paymentDate,
    reference,
    notes,
    reversePaymentId,
  } = body;

  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  if (jwt) {
    client.setJWT(jwt);
    log?.("Using caller JWT credentials.");
  } else if (apiKey) {
    client.setKey(apiKey);
    log?.("Using function API key credentials.");
  } else {
    return res.json(
      {
        ok: false,
        error: "Missing credentials. Provide JWT or RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }
  const databases = new Databases(client);

  if (reversePaymentId) {
    try {
      log?.(`Reversing payment ${reversePaymentId}`);
      log?.("Fetching original payment...");
      const original = await databases.getDocument(databaseId, "payments", reversePaymentId);
      if (original.isReversal) {
        return res.json({ ok: false, error: "Reversal entries cannot be reversed." }, 400);
      }
      const existingReversals = await databases.listDocuments(databaseId, "payments", [
        Query.equal("reversedPaymentId", [original.$id]),
        Query.limit(1),
      ]);
      if (existingReversals.total > 0) {
        return res.json(
          { ok: false, error: "This payment has already been reversed." },
          409
        );
      }
      const originalTenantId =
        typeof original.tenant === "string" ? original.tenant : original.tenant?.$id;
      if (!originalTenantId) {
        return res.json({ ok: false, error: "Original payment has no tenant." }, 400);
      }
      const tenantPayments = await listAllTenantPayments(
        databases,
        databaseId,
        originalTenantId
      );
      const paidByMonth = buildPaidByMonth(tenantPayments);
      const reversalAmount = Math.abs(Number(original.amount) || 0);
      const { allocation, remaining } = allocateReversal({
        amount: reversalAmount,
        paidByMonth,
      });
      const appliedTotal = roundMoney(
        Object.values(allocation).reduce((sum, value) => sum + Number(value || 0), 0)
      );
      if (appliedTotal <= 0) {
        return res.json(
          { ok: false, error: "No paid month balance is available to reverse." },
          400
        );
      }
      if (remaining > 0) {
        log?.(
          `Reversal allocation exhausted paid balances before full amount. remaining=${remaining}`
        );
      }
      const recordedBy = req.headers["x-appwrite-user-id"] ?? null;
      log?.("Creating reversal document...");
      const reversal = await databases.createDocument(databaseId, "payments", ID.unique(), {
        tenant: originalTenantId,
        amount: -appliedTotal,
        method: original.method,
        paymentDate: paymentDate ?? original.paymentDate,
        reference,
        notes: notes ?? "Reversal",
        isReversal: true,
        reversedPaymentId: original.$id,
        allocationJson: JSON.stringify(allocation),
        recordedBy,
      });
      log?.("Reversal created.");
      return res.json({ ok: true, reversal });
    } catch (error) {
      const reason =
        error?.response?.message ?? error?.message ?? "Failed to reverse payment.";
      logError?.(`Failed to reverse payment: ${error?.message ?? "Unknown error"}`);
      if (error?.response) {
        logError?.(`Response: ${JSON.stringify(error.response)}`);
      }
      if (error?.code) {
        logError?.(`Code: ${error.code}`);
      }
      return res.json({ ok: false, error: reason }, error?.code ?? 500);
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

    const paymentList = await listAllTenantPayments(databases, databaseId, tenantId);
    const paidByMonth = buildPaidByMonth(paymentList);

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
    const reason =
      error?.response?.message ?? error?.message ?? "Failed to allocate payment.";
    logError?.(`Allocation failed: ${error?.message ?? "Unknown error"}`);
    return res.json({ ok: false, error: reason }, error?.code ?? 500);
  }
};
