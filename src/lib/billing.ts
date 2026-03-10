import { account, functions } from "./appwrite";

export type BillingCheckoutRequest = {
  workspaceId?: string;
  planCode: string;
  couponCode?: string;
  successUrl?: string;
  cancelUrl?: string;
};

export type BillingCheckoutSuccess = {
  ok: true;
  provider: string;
  checkoutUrl: string;
  txRef: string;
  invoiceId: string;
  subscriptionId: string;
  paymentId: string;
  workspaceId: string;
  amountDue: number;
  currency: string;
  discountPercent: number;
  discountAmount: number;
  couponCode?: string | null;
};

export type BillingCheckoutFailure = {
  ok: false;
  error?: string;
};

export type BillingCheckoutResult = BillingCheckoutSuccess | BillingCheckoutFailure;

export type BillingVerifyRequest = {
  workspaceId?: string;
  transactionId: string;
  txRef?: string;
  paymentId?: string;
};

export type BillingVerifySuccess = {
  ok: true;
  provider: string;
  status: string;
  workspaceId: string;
  subscriptionId: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  idempotencyKey?: string | null;
  providerReference?: string | null;
};

export type BillingVerifyFailure = {
  ok: false;
  error?: string;
};

export type BillingVerifyResult = BillingVerifySuccess | BillingVerifyFailure;

function parseExecutionBody(response?: string) {
  try {
    return response
      ? (JSON.parse(response) as BillingCheckoutResult | BillingVerifyResult)
      : null;
  } catch {
    return null;
  }
}

function readExecutionBody(value: unknown) {
  return (
    (value as { responseBody?: string; response?: string }).responseBody ??
    (value as { responseBody?: string; response?: string }).response ??
    ""
  );
}

export async function createBillingCheckoutSession(
  payload: BillingCheckoutRequest
): Promise<BillingCheckoutResult> {
  const functionId = import.meta.env.VITE_BILLING_CHECKOUT_FUNCTION_ID as string | undefined;
  if (!functionId) {
    return { ok: false, error: "Billing checkout function ID is missing." };
  }

  const jwt = await account.createJWT();
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify({
      ...payload,
      jwt: jwt.jwt,
    }),
    false
  );

  let latest: unknown = execution;
  let body = readExecutionBody(latest);
  let attempts = 0;

  while (
    attempts < 12 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    latest = await functions.getExecution(functionId, (latest as { $id: string }).$id);
    body = readExecutionBody(latest);
    attempts += 1;
  }

  const parsed = parseExecutionBody(body) as BillingCheckoutResult | null;
  if (parsed) return parsed;
  return {
    ok: false,
    error:
      (latest as { errors?: string }).errors ||
      "Billing checkout function returned an invalid response.",
  };
}

export async function verifyBillingPayment(
  payload: BillingVerifyRequest
): Promise<BillingVerifyResult> {
  const functionId = import.meta.env.VITE_BILLING_VERIFY_FUNCTION_ID as string | undefined;
  if (!functionId) {
    return { ok: false, error: "Billing verify function ID is missing." };
  }

  const jwt = await account.createJWT();
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify({
      ...payload,
      jwt: jwt.jwt,
    }),
    false
  );

  let latest: unknown = execution;
  let body = readExecutionBody(latest);
  let attempts = 0;

  while (
    attempts < 12 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    latest = await functions.getExecution(functionId, (latest as { $id: string }).$id);
    body = readExecutionBody(latest);
    attempts += 1;
  }

  const parsed = parseExecutionBody(body) as BillingVerifyResult | null;
  if (parsed) return parsed;
  return {
    ok: false,
    error:
      (latest as { errors?: string }).errors ||
      "Billing verify function returned an invalid response.",
  };
}
