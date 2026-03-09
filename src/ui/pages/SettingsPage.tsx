import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Query } from "appwrite";
import { account, databases, functions, rcmsDatabaseId } from "../../lib/appwrite";
import { useToast } from "../ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { logAudit } from "../../lib/audit";
import { getActiveWorkspaceId } from "../../lib/workspace";
import { createBillingCheckoutSession } from "../../lib/billing";
import { COLLECTIONS, type Plan } from "../../lib/schema";

type AppRole = "admin" | "clerk" | "viewer";

type ManageUserSuccess = {
  ok: true;
  created: boolean;
  role: AppRole;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type ManageUserFailure = {
  ok: false;
  error?: string;
};

type ManageUserResult = ManageUserSuccess | ManageUserFailure;

function parseExecutionBody(response?: string) {
  try {
    return response ? (JSON.parse(response) as ManageUserResult) : null;
  } catch {
    return null;
  }
}

async function executeManageUsersFunction(
  functionId: string,
  payload: Record<string, unknown>
) {
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(payload),
    false
  );

  const readBody = (value: unknown) =>
    (value as { responseBody?: string; response?: string }).responseBody ??
    (value as { responseBody?: string; response?: string }).response ??
    "";

  let latest: unknown = execution;
  let body = readBody(latest);
  let attempts = 0;

  while (
    attempts < 8 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    latest = await functions.getExecution(
      functionId,
      (latest as { $id: string }).$id
    );
    body = readBody(latest);
    attempts += 1;
  }

  return {
    parsed: parseExecutionBody(body),
    latest: latest as { errors?: string },
  };
}

export default function SettingsPage() {
  const { user, billing, canAccessFeature } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ManageUserSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const manageUsersFunctionId = import.meta.env.VITE_MANAGE_USERS_FUNCTION_ID as
    | string
    | undefined;
  const manageUsersAccess = canAccessFeature("settings.manage_users");

  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      try {
        const response = await databases.listDocuments(rcmsDatabaseId, COLLECTIONS.plans, [
          Query.equal("isActive", [true]),
          Query.orderAsc("sortOrder"),
          Query.limit(20),
        ]);
        const docs = response.documents as unknown as Plan[];
        if (!active) return;
        setPlans(docs);
        setPlanCode((current) => (current || docs[0]?.code || ""));
      } catch {
        if (active) {
          setPlans([]);
        }
      }
    };
    void loadPlans();
    return () => {
      active = false;
    };
  }, []);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("viewer");
  };

  const handleStartCheckout = async () => {
    if (!planCode.trim()) {
      toast.push("warning", "Select a plan before continuing.");
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await createBillingCheckoutSession({
        workspaceId: getActiveWorkspaceId(),
        planCode: planCode.trim(),
        couponCode: couponCode.trim() || undefined,
      });
      if (!result.ok) {
        throw new Error(result.error || "Failed to start billing checkout.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      const message =
        checkoutError instanceof Error
          ? checkoutError.message
          : "Failed to start billing checkout.";
      toast.push("error", message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    if (!manageUsersAccess.allowed) {
      const reason =
        manageUsersAccess.reason ||
        "User management is locked on your current plan.";
      setError(reason);
      toast.push("warning", reason);
      return;
    }

    if (!manageUsersFunctionId) {
      setError("Manage users function ID is missing.");
      toast.push("warning", "Manage users function ID is missing.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      toast.push("warning", "Email is required.");
      return;
    }

    if (password.trim().length > 0 && password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      toast.push("warning", "Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const jwt = await account.createJWT();
      const { parsed, latest } = await executeManageUsersFunction(manageUsersFunctionId, {
        jwt: jwt.jwt,
        workspaceId: getActiveWorkspaceId(),
        name: name.trim() || null,
        email: normalizedEmail,
        password: password.trim() || null,
        role,
      });

      if (!parsed || !parsed.ok) {
        throw new Error(parsed?.error || latest?.errors || "Failed to manage user.");
      }

      setResult(parsed);
      setPassword("");
      resetForm();
      toast.push(
        "success",
        parsed.created
          ? "User created and role assigned."
          : "User role assignment updated."
      );

      if (user) {
        void logAudit({
          entityType: "user",
          entityId: parsed.user.id,
          action: parsed.created ? "create" : "update",
          actorId: user.id,
          details: {
            email: parsed.user.email,
            role: parsed.role,
            created: parsed.created,
          },
        });
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to create or update user.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Settings</div>
        <h3 className="mt-3 text-2xl font-semibold text-white">Workspace Settings</h3>
        <p className="mt-2 text-sm text-slate-400">
          Manage billing lifecycle and team permissions.
        </p>
      </header>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="text-sm font-semibold text-slate-100">Billing Lifecycle</div>
        <p className="mt-2 text-xs text-slate-400">
          Trial, grace period, and renewal status are enforced automatically.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">State</div>
            <div className="mt-2 text-lg font-semibold text-slate-100">
              {billing?.effectiveState || billing?.state || "unknown"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Plan</div>
            <div className="mt-2 text-lg font-semibold text-slate-100">
              {billing?.planCode || "Not set"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Access</div>
            <div className="mt-2 text-lg font-semibold text-slate-100">
              {billing?.accessState || "full"}
            </div>
          </div>
        </div>

        {billing?.bannerTitle && billing?.bannerMessage ? (
          <div
            className="mt-4 rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor:
                billing.bannerTone === "danger"
                  ? "rgba(244,63,94,0.4)"
                  : billing.bannerTone === "warning"
                    ? "rgba(251,191,36,0.4)"
                    : "rgba(56,189,248,0.4)",
              backgroundColor:
                billing.bannerTone === "danger"
                  ? "rgba(190,24,93,0.15)"
                  : billing.bannerTone === "warning"
                    ? "rgba(180,83,9,0.15)"
                    : "rgba(14,116,144,0.15)",
              color: "var(--text)",
            }}
          >
            <div className="font-semibold">{billing.bannerTitle}</div>
            <div className="mt-1 text-xs text-slate-100/90">{billing.bannerMessage}</div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="block text-sm text-slate-300">
            Plan
            <select
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
            >
              {plans.length === 0 ? <option value="">No active plans</option> : null}
              {plans.map((plan) => (
                <option key={plan.$id} value={plan.code}>
                  {plan.name} ({Number(plan.priceAmount ?? 0).toLocaleString()} {plan.currency})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Coupon (optional)
            <input
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
              className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              placeholder="DISCOUNT10"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleStartCheckout}
              disabled={checkoutLoading || !planCode}
              className="btn-primary w-full text-sm disabled:opacity-60"
            >
              {checkoutLoading ? "Starting checkout..." : "Pay / Upgrade"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="text-sm font-semibold text-slate-100">Add Team User</div>
        <p className="mt-2 text-xs text-slate-500">
          For existing users, leave password empty to only update role assignment.
        </p>
        {!manageUsersAccess.allowed ? (
          <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 text-sm text-amber-100">
            {manageUsersAccess.reason ||
              "User management is locked on your current plan. Upgrade to continue."}
          </div>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Full Name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jane Doe"
                disabled={!manageUsersAccess.allowed}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jane@example.com"
                required
                disabled={!manageUsersAccess.allowed}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Password (for new users)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                disabled={!manageUsersAccess.allowed}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as AppRole)}
                disabled={!manageUsersAccess.allowed}
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
              >
                <option value="viewer">Viewer</option>
                <option value="clerk">Clerk</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting || !manageUsersAccess.allowed}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Create / Update User"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={submitting || !manageUsersAccess.allowed}
              className="btn-secondary text-sm disabled:opacity-60"
            >
              Clear
            </button>
          </div>
        </form>

        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

        {result && (
          <div className="mt-5 rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm">
            <div className="font-semibold text-emerald-200">
              {result.created ? "User created successfully." : "User role updated successfully."}
            </div>
            <div className="mt-2 text-emerald-100/90">
              {result.user.name} ({result.user.email}) is now assigned as {result.role}.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
