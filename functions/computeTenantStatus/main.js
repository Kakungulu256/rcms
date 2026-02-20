import { Client, Databases, Query } from "node-appwrite";

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

function resolveRentForMonth(monthKey, tenantHistoryJson, houseHistoryJson, fallbackRent) {
  const tenantHistory = parseHistory(tenantHistoryJson);
  const houseHistory = parseHistory(houseHistoryJson);
  const history = tenantHistory.length > 0 ? tenantHistory : houseHistory;
  const monthStart = `${monthKey}-01`;
  const entry = history.filter((item) => item.effectiveDate <= monthStart).at(-1);
  return entry?.amount ?? fallbackRent;
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
  if (!body || !body.tenantId) {
    log?.("Missing tenantId in request.");
    return res.json({ ok: false, error: "tenantId is required." }, 400);
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

  if (!endpoint || !projectId || !apiKey) {
    log?.("Missing Appwrite credentials in function env.");
    return res.json(
      {
        ok: false,
        error:
          "Missing Appwrite credentials. Set RCMS_APPWRITE_ENDPOINT, RCMS_APPWRITE_PROJECT_ID, RCMS_APPWRITE_API_KEY.",
      },
      500
    );
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);

  try {
    const tenant = await databases.getDocument(databaseId, "tenants", body.tenantId);
    const houseId =
      typeof tenant.house === "string" ? tenant.house : tenant.house?.$id ?? null;
    const house = houseId
      ? await databases.getDocument(databaseId, "houses", houseId)
      : null;
    const rent = tenant.rentOverride ?? house?.monthlyRent ?? 0;

    const paymentList = await listAllTenantPayments(databases, databaseId, body.tenantId);
    const paidByMonth = buildPaidByMonth(paymentList);
    const currentMonth = monthKey(new Date());
    const rentForMonth = resolveRentForMonth(
      currentMonth,
      tenant.rentHistoryJson ?? null,
      house?.rentHistoryJson ?? null,
      rent
    );
    const paidThisMonth = paidByMonth[currentMonth] ?? 0;

    let status = "red";
    if (paidThisMonth >= rentForMonth && rentForMonth > 0) {
      status = "green";
    } else if (paidThisMonth > 0) {
      status = "orange";
    }

    return res.json({
      ok: true,
      tenantId: body.tenantId,
      currentMonth,
      paidThisMonth,
      rent: rentForMonth,
      status,
    });
  } catch (error) {
    logError?.(`Status computation failed: ${error?.message ?? "Unknown error"}`);
    return res.json({ ok: false, error: "Failed to compute tenant status." }, 500);
  }
};