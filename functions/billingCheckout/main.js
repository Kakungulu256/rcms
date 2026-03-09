import { Account, Client, Databases, ID, Query } from "node-appwrite";

const COLLECTIONS = {
  workspaces: "workspaces",
  workspaceMemberships: "workspace_memberships",
  plans: "plans",
  subscriptions: "subscriptions",
  subscriptionEvents: "subscription_events",
  invoices: "invoices",
  billingPayments: "payments_billing",
  coupons: "coupons",
  couponRedemptions: "coupon_redemptions",
  auditLogs: "audit_logs",
};

function getEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim().length > 0) {
      return String(value).trim();
    }
  }
  return null;
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

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function normalizeWorkspaceId(value) {
  return normalizeString(value);
}

function normalizeCouponCode(value) {
  return normalizeString(value)?.toUpperCase() ?? null;
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}

function clampNumber(value, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return min;
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

function getNow() {
  return new Date();
}

function addDaysIso(base, days) {
  return new Date(base.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}

function formatIso(date) {
  return new Date(date).toISOString();
}

function safeJsonString(value, maxLength = 20000) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= maxLength) return json;
  return json.slice(0, maxLength);
}

function generateInvoiceNumber(now, workspaceId) {
  const prefix = workspaceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "RCMS";
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const nonce = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INV-${prefix}-${datePart}-${nonce}`;
}

function generateTxRef(parts) {
  const nonce = Math.random().toString(36).slice(2, 8);
  return ["rcms", ...parts, Date.now().toString(), nonce].join(":");
}

function resolveTrialDays(planTrialDays) {
  const configured = Number(getEnv("RCMS_TRIAL_DAYS"));
  if (Number.isFinite(Number(planTrialDays)) && Number(planTrialDays) > 0) {
    return Math.floor(Number(planTrialDays));
  }
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return 5;
}

function resolveBillingProvider() {
  return (
    normalizeString(
      getEnv(
        "RCMS_BILLING_PROVIDER",
        "RCMS_PAYMENT_GATEWAY_PROVIDER",
        "RCMS_BILLING_GATEWAY_PROVIDER"
      )
    )?.toLowerCase() ?? "flutterwave"
  );
}

function resolveBillingConfig(body) {
  const provider = resolveBillingProvider();
  const appBaseUrl = getEnv("RCMS_BILLING_APP_BASE_URL");
  const fallbackReturnUrl =
    getEnv("RCMS_BILLING_SUCCESS_URL", "RCMS_BILLING_RETURN_URL") ||
    (appBaseUrl ? `${appBaseUrl}/settings?tab=billing` : null);
  const fallbackCancelUrl =
    getEnv("RCMS_BILLING_CANCEL_URL") ||
    (appBaseUrl ? `${appBaseUrl}/settings?tab=billing` : null);

  return {
    provider,
    successUrl:
      normalizeString(body?.successUrl) ||
      normalizeString(body?.returnUrl) ||
      fallbackReturnUrl,
    cancelUrl:
      normalizeString(body?.cancelUrl) ||
      fallbackCancelUrl,
    webhookUrl:
      normalizeString(body?.webhookUrl) ||
      getEnv("RCMS_BILLING_WEBHOOK_URL"),
    defaultCurrency:
      normalizeString(getEnv("RCMS_BILLING_DEFAULT_CURRENCY")) || "UGX",
    flutterwave: {
      baseUrl: getEnv("RCMS_FLUTTERWAVE_BASE_URL") || "https://api.flutterwave.com/v3",
      secretKey: getEnv("RCMS_FLUTTERWAVE_SECRET_KEY"),
      productName: getEnv("RCMS_BILLING_PRODUCT_NAME") || "RCMS Subscription",
      logoUrl: getEnv("RCMS_BILLING_LOGO_URL"),
    },
  };
}

function buildGatewayAdapter(config) {
  if (config.provider !== "flutterwave") {
    throw Object.assign(new Error(`Unsupported billing provider: ${config.provider}`), {
      code: 400,
    });
  }

  const { baseUrl, secretKey, productName, logoUrl } = config.flutterwave;
  if (!secretKey) {
    throw Object.assign(new Error("Missing RCMS_FLUTTERWAVE_SECRET_KEY."), { code: 500 });
  }

  return {
    provider: "flutterwave",
    async createCheckoutSession(params) {
      const payload = {
        tx_ref: params.txRef,
        amount: Number(params.amount),
        currency: params.currency,
        redirect_url: params.successUrl,
        customer: {
          email: params.customerEmail,
          name: params.customerName ?? params.customerEmail,
        },
        customizations: {
          title: productName,
          description: params.description,
          logo: logoUrl || undefined,
        },
        meta: {
          ...params.metadata,
          cancelUrl: params.cancelUrl || undefined,
          webhookUrl: params.webhookUrl || undefined,
        },
      };

      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || data?.status !== "success" || !data?.data?.link) {
        const message =
          data?.message ||
          `Flutterwave checkout failed with status ${response.status}.`;
        throw Object.assign(new Error(message), {
          code: 502,
          response: data,
        });
      }

      return {
        checkoutUrl: data.data.link,
        providerReference: params.txRef,
        providerPaymentId: normalizeString(data.data.id),
        raw: data,
      };
    },
  };
}

async function findOne(databases, databaseId, collectionId, queries) {
  const result = await databases.listDocuments(databaseId, collectionId, [
    ...queries,
    Query.limit(1),
  ]);
  return result.documents?.[0] ?? null;
}

async function ensureCallerAuthenticated({ endpoint, projectId, jwt }) {
  if (!jwt) {
    throw Object.assign(new Error("Missing caller JWT."), { code: 401 });
  }

  const callerClient = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
  const account = new Account(callerClient);
  return account.get();
}

async function assertCallerIsWorkspaceAdmin({
  databases,
  databaseId,
  workspaceId,
  caller,
}) {
  const workspace = await databases.getDocument(databaseId, COLLECTIONS.workspaces, workspaceId);
  if (workspace?.ownerUserId === caller.$id) {
    return workspace;
  }

  const membershipPage = await databases.listDocuments(
    databaseId,
    COLLECTIONS.workspaceMemberships,
    [
      Query.equal("workspaceId", [workspaceId]),
      Query.equal("userId", [caller.$id]),
      Query.equal("status", ["active"]),
      Query.limit(1),
    ]
  );
  const membership = membershipPage.documents?.[0] ?? null;
  const role = String(membership?.role ?? "").trim().toLowerCase();
  if (role !== "admin") {
    throw Object.assign(new Error("Only workspace admins can initiate billing checkout."), {
      code: 403,
    });
  }

  return workspace;
}

function resolveWorkspaceIdFromBodyAndCaller(body, caller) {
  return (
    normalizeWorkspaceId(body?.workspaceId) ||
    normalizeWorkspaceId(caller?.prefs?.workspaceId) ||
    normalizeWorkspaceId(getEnv("RCMS_DEFAULT_WORKSPACE_ID")) ||
    "default"
  );
}

function computeCouponDiscount({ coupon, planCode, amount, now }) {
  if (!coupon) {
    return {
      discountPercent: 0,
      discountAmount: 0,
      couponCode: null,
      couponDocumentId: null,
    };
  }

  const validFrom = normalizeString(coupon.validFrom);
  if (validFrom && new Date(validFrom).getTime() > now.getTime()) {
    throw Object.assign(new Error("Coupon is not active yet."), { code: 400 });
  }
  const validUntil = normalizeString(coupon.validUntil);
  if (validUntil && new Date(validUntil).getTime() < now.getTime()) {
    throw Object.assign(new Error("Coupon has expired."), { code: 400 });
  }

  const maxRedemptions = Number(coupon.maxRedemptions ?? 0);
  const redemptionCount = Number(coupon.redemptionCount ?? 0);
  if (Number.isFinite(maxRedemptions) && maxRedemptions > 0 && redemptionCount >= maxRedemptions) {
    throw Object.assign(new Error("Coupon usage limit reached."), { code: 400 });
  }

  const minPlanAmount = Number(coupon.minPlanAmount ?? 0);
  if (Number.isFinite(minPlanAmount) && minPlanAmount > 0 && amount < minPlanAmount) {
    throw Object.assign(new Error("Coupon requires a higher plan amount."), { code: 400 });
  }

  const targetedPlans = parseJsonArray(coupon.appliesToPlanCodesJson);
  if (targetedPlans.length > 0 && !targetedPlans.includes(planCode)) {
    throw Object.assign(new Error("Coupon does not apply to selected plan."), { code: 400 });
  }

  const discountPercent = clampNumber(coupon.discountPercent, 0, 100);
  const discountAmount = Math.max(0, Math.round((amount * discountPercent) / 100));

  return {
    discountPercent,
    discountAmount,
    couponCode: normalizeCouponCode(coupon.code),
    couponDocumentId: coupon.$id,
  };
}

async function writeAuditLog(databases, databaseId, payload) {
  await databases.createDocument(databaseId, COLLECTIONS.auditLogs, ID.unique(), {
    workspaceId: payload.workspaceId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.action,
    actorId: payload.actorId,
    timestamp: new Date().toISOString(),
    detailsJson: safeJsonString(payload.details ?? null),
  });
}

async function writeSubscriptionEvent(databases, databaseId, payload) {
  await databases.createDocument(databaseId, COLLECTIONS.subscriptionEvents, ID.unique(), {
    workspaceId: payload.workspaceId,
    subscriptionId: payload.subscriptionId,
    eventType: payload.eventType,
    eventSource: payload.eventSource,
    eventTime: new Date().toISOString(),
    stateFrom: payload.stateFrom || null,
    stateTo: payload.stateTo || null,
    idempotencyKey: payload.idempotencyKey || null,
    payloadJson: safeJsonString(payload.payload ?? null),
    actorUserId: payload.actorUserId || null,
    reference: payload.reference || null,
  });
}

export default async (context) => {
  const { req, res, error: logError } = context;
  const body = parseJson(req.body);
  if (!body) {
    return res.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const endpoint = getEnv(
    "RCMS_APPWRITE_ENDPOINT",
    "APPWRITE_ENDPOINT",
    "APPWRITE_FUNCTION_API_ENDPOINT"
  );
  const projectId = getEnv(
    "RCMS_APPWRITE_PROJECT_ID",
    "APPWRITE_PROJECT_ID",
    "APPWRITE_FUNCTION_PROJECT_ID"
  );
  const apiKey = getEnv(
    "RCMS_APPWRITE_API_KEY",
    "APPWRITE_API_KEY",
    "APPWRITE_FUNCTION_API_KEY"
  );
  const databaseId = getEnv("RCMS_APPWRITE_DATABASE_ID", "APPWRITE_DATABASE_ID") || "rcms";

  if (!endpoint || !projectId || !apiKey) {
    return res.json(
      { ok: false, error: "Missing Appwrite credentials in function env vars." },
      500
    );
  }

  const billingConfig = resolveBillingConfig(body);
  if (!billingConfig.successUrl) {
    return res.json(
      {
        ok: false,
        error:
          "Missing billing return URL. Set RCMS_BILLING_SUCCESS_URL or pass successUrl in payload.",
      },
      400
    );
  }

  const planCode = normalizeString(body.planCode);
  if (!planCode) {
    return res.json({ ok: false, error: "planCode is required." }, 400);
  }
  const couponCode = normalizeCouponCode(body.couponCode);
  const jwt = normalizeString(body.jwt);

  try {
    const caller = await ensureCallerAuthenticated({
      endpoint,
      projectId,
      jwt,
    });

    const workspaceId = resolveWorkspaceIdFromBodyAndCaller(body, caller);
    const callerWorkspaceId = normalizeWorkspaceId(caller?.prefs?.workspaceId);
    if (callerWorkspaceId && callerWorkspaceId !== workspaceId) {
      return res.json(
        { ok: false, error: "Workspace mismatch for authenticated user." },
        403
      );
    }

    const adminClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const databases = new Databases(adminClient);
    const gateway = buildGatewayAdapter(billingConfig);

    const workspace = await assertCallerIsWorkspaceAdmin({
      databases,
      databaseId,
      workspaceId,
      caller,
    });
    if (workspace.status !== "active") {
      return res.json(
        { ok: false, error: "Workspace is inactive and cannot checkout." },
        400
      );
    }

    const plan = await findOne(databases, databaseId, COLLECTIONS.plans, [
      Query.equal("code", [planCode]),
      Query.equal("isActive", [true]),
    ]);
    if (!plan) {
      return res.json({ ok: false, error: "Selected plan is not available." }, 404);
    }

    const baseAmount = Math.max(0, Number(plan.priceAmount ?? 0));
    const currency = normalizeString(plan.currency) || billingConfig.defaultCurrency;
    if (!currency) {
      return res.json({ ok: false, error: "Plan currency is not configured." }, 400);
    }

    let coupon = null;
    if (couponCode) {
      coupon = await findOne(databases, databaseId, COLLECTIONS.coupons, [
        Query.equal("code", [couponCode]),
        Query.equal("isActive", [true]),
      ]);
      if (!coupon) {
        return res.json({ ok: false, error: "Coupon was not found or is inactive." }, 404);
      }
    }

    const now = getNow();
    const discount = computeCouponDiscount({
      coupon,
      planCode,
      amount: baseAmount,
      now,
    });

    const amountDue = Math.max(0, baseAmount - discount.discountAmount);

    let subscription = await findOne(databases, databaseId, COLLECTIONS.subscriptions, [
      Query.equal("workspaceId", [workspaceId]),
      Query.orderDesc("$updatedAt"),
    ]);

    if (!subscription) {
      const trialDays = resolveTrialDays(plan.trialDays);
      const trialStartDate = now.toISOString();
      const trialEndDate = addDaysIso(now, trialDays);
      subscription = await databases.createDocument(
        databaseId,
        COLLECTIONS.subscriptions,
        ID.unique(),
        {
          workspaceId,
          planCode,
          state: "trialing",
          trialStartDate,
          trialEndDate,
          currentPeriodStart: trialStartDate,
          currentPeriodEnd: trialEndDate,
          pastDueSince: null,
          graceEndsAt: null,
          retryCount: 0,
          nextRetryAt: null,
          lastRetryAt: null,
          dunningStage: null,
          lastFailureReason: null,
          cancelAtPeriodEnd: false,
          couponCode: discount.couponCode,
          discountPercent: discount.discountPercent || null,
          gatewayProvider: gateway.provider,
          notes: "Subscription initialized during checkout.",
        }
      );
    }

    const invoice = await databases.createDocument(databaseId, COLLECTIONS.invoices, ID.unique(), {
      workspaceId,
      subscriptionId: subscription.$id,
      invoiceNumber: generateInvoiceNumber(now, workspaceId),
      status: "open",
      currency,
      subtotal: baseAmount,
      discountAmount: discount.discountAmount || null,
      taxAmount: 0,
      totalAmount: amountDue,
      amountDue,
      amountPaid: 0,
      dueDate: now.toISOString(),
      issuedAt: now.toISOString(),
      periodStart: formatIso(now),
      periodEnd: addDaysIso(now, 30),
      couponCode: discount.couponCode,
      metadataJson: safeJsonString({
        planCode,
        couponCode: discount.couponCode,
        initiatedBy: caller.$id,
      }),
    });

    const checkoutIdempotencyKey = `checkout:${workspaceId}:${subscription.$id}:${invoice.$id}`;
    const billingPayment = await databases.createDocument(
      databaseId,
      COLLECTIONS.billingPayments,
      ID.unique(),
      {
        workspaceId,
        subscriptionId: subscription.$id,
        invoiceId: invoice.$id,
        status: "pending",
        provider: gateway.provider,
        amount: amountDue,
        currency,
        idempotencyKey: checkoutIdempotencyKey,
      }
    );

    const txRef = generateTxRef([workspaceId, subscription.$id, invoice.$id, billingPayment.$id]);
    const checkoutSession = await gateway.createCheckoutSession({
      txRef,
      amount: amountDue,
      currency,
      customerEmail: caller.email,
      customerName: caller.name,
      description: `${plan.name} subscription`,
      successUrl: billingConfig.successUrl,
      cancelUrl: billingConfig.cancelUrl,
      webhookUrl: billingConfig.webhookUrl,
      metadata: {
        workspaceId,
        subscriptionId: subscription.$id,
        invoiceId: invoice.$id,
        paymentId: billingPayment.$id,
        planCode,
        couponCode: discount.couponCode,
        idempotencyKey: checkoutIdempotencyKey,
      },
    });

    await databases.updateDocument(
      databaseId,
      COLLECTIONS.billingPayments,
      billingPayment.$id,
      {
        providerReference: checkoutSession.providerReference || txRef,
        providerPaymentId: checkoutSession.providerPaymentId || null,
      }
    );

    await writeSubscriptionEvent(databases, databaseId, {
      workspaceId,
      subscriptionId: subscription.$id,
      eventType: "checkout_initiated",
      eventSource: "api",
      stateFrom: subscription.state,
      stateTo: subscription.state,
      idempotencyKey: checkoutIdempotencyKey,
      payload: {
        planCode,
        couponCode: discount.couponCode,
        txRef: checkoutSession.providerReference || txRef,
        gateway: gateway.provider,
      },
      actorUserId: caller.$id,
      reference: invoice.$id,
    });

    await writeAuditLog(databases, databaseId, {
      workspaceId,
      entityType: "billing_checkout",
      entityId: invoice.$id,
      action: "create",
      actorId: caller.$id,
      details: {
        subscriptionId: subscription.$id,
        planCode,
        provider: gateway.provider,
        amountDue,
        currency,
        couponCode: discount.couponCode,
      },
    });

    return res.json({
      ok: true,
      provider: gateway.provider,
      checkoutUrl: checkoutSession.checkoutUrl,
      txRef: checkoutSession.providerReference || txRef,
      invoiceId: invoice.$id,
      subscriptionId: subscription.$id,
      paymentId: billingPayment.$id,
      workspaceId,
      amountDue,
      currency,
      discountPercent: discount.discountPercent,
      discountAmount: discount.discountAmount,
      couponCode: discount.couponCode,
    });
  } catch (error) {
    const status = Number(error?.code) || 500;
    const message =
      error?.response?.message ||
      error?.message ||
      "Failed to create billing checkout session.";
    logError?.(`billingCheckout failed: ${message}`);
    return res.json({ ok: false, error: message }, status);
  }
};
