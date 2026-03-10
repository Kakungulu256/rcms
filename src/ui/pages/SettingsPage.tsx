import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ID, Query } from "appwrite";
import { Link, useSearchParams } from "react-router-dom";
import {
  account,
  functions,
  getScopedDocument,
  listAllDocuments,
  rcmsReceiptsBucketId,
  rcmsDatabaseId,
  storage,
  updateScopedDocument,
} from "../../lib/appwrite";
import { useToast } from "../ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { logAudit } from "../../lib/audit";
import {
  COLLECTIONS,
  type ProrationMode,
  type Workspace,
  type WorkspaceMembership,
} from "../../lib/schema";
import { formatLimitValue, getLimitStatus } from "../../lib/planLimits";
import {
  ALLOWED_BRANDING_MIME_TYPES,
  MAX_BRANDING_FILE_SIZE_BYTES,
  WATERMARK_POSITIONS,
  type WatermarkPosition,
  type WorkspaceBranding,
  clampWatermarkOpacity,
  clampWatermarkScale,
  normalizeWorkspaceBranding,
} from "../../lib/branding";
import WorkspaceInvitationsPanel from "../settings/WorkspaceInvitationsPanel";

type AppRole = "admin" | "clerk" | "viewer";
type SettingsTab = "branding" | "team";

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

function getFileViewUrl(bucketId: string, fileId: string) {
  try {
    const result = storage.getFileView(bucketId, fileId) as unknown;
    if (typeof result === "string") return result;
    if (result && typeof (result as URL).toString === "function") {
      return (result as URL).toString();
    }
    return null;
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
  const { user, canAccessFeature, planLimits } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ManageUserSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamMemberCount, setTeamMemberCount] = useState(0);
  const [workspaceDoc, setWorkspaceDoc] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [branding, setBranding] = useState<WorkspaceBranding>(() =>
    normalizeWorkspaceBranding(null)
  );
  const [brandingPreviewUrl, setBrandingPreviewUrl] = useState<string | null>(null);
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingFile, setBrandingFile] = useState<File | null>(null);
  const [prorationMode, setProrationMode] = useState<ProrationMode>("actual_days");
  const [prorationSaving, setProrationSaving] = useState(false);

  const activeWorkspaceId = user?.hasWorkspace ? user.workspaceId : "";
  const manageUsersFunctionId = import.meta.env.VITE_MANAGE_USERS_FUNCTION_ID as
    | string
    | undefined;
  const manageUsersAccess = canAccessFeature("settings.manage_users");
  const teamMemberLimitStatus = getLimitStatus(planLimits.maxTeamMembers, teamMemberCount);

  const currentTab = (searchParams.get("tab") || "branding").toLowerCase();
  const activeTab: SettingsTab = currentTab === "team" ? "team" : "branding";

  const setTab = (tab: SettingsTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const loadWorkspaceSettings = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    setBrandingLoading(true);
    try {
      const workspace = await getScopedDocument<Workspace>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.workspaces,
        documentId: activeWorkspaceId,
      });
      setWorkspaceDoc(workspace);
      const resolvedProrationMode =
        workspace?.prorationMode === "fixed_30" ? "fixed_30" : "actual_days";
      setProrationMode(resolvedProrationMode);
      if (workspace && !workspace.prorationMode) {
        updateScopedDocument({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.workspaces,
          documentId: workspace.$id,
          data: { prorationMode: "actual_days" },
        }).catch(() => null);
      }
      const normalizedBranding = normalizeWorkspaceBranding(workspace);
      setBranding(normalizedBranding);
      if (normalizedBranding.logoFileId) {
        setBrandingPreviewUrl(
          getFileViewUrl(
            normalizedBranding.logoBucketId || rcmsReceiptsBucketId,
            normalizedBranding.logoFileId
          )
        );
      } else {
        setBrandingPreviewUrl(null);
      }
    } catch {
      setWorkspaceError("Failed to load workspace settings.");
      setWorkspaceDoc(null);
      setProrationMode("actual_days");
      setBranding(normalizeWorkspaceBranding(null));
      setBrandingPreviewUrl(null);
    } finally {
      setWorkspaceLoading(false);
      setBrandingLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadTeamUsage = async () => {
      try {
        const rows = await listAllDocuments<WorkspaceMembership>({
          databaseId: rcmsDatabaseId,
          collectionId: COLLECTIONS.workspaceMemberships,
          queries: [Query.equal("status", ["active"])],
        });
        if (!active) return;
        setTeamMemberCount(rows.length);
      } catch {
        if (active) {
          setTeamMemberCount(0);
        }
      }
    };
    void loadTeamUsage();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadWorkspaceSettings();
  }, []);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("viewer");
  };

  const handleSaveProrationMode = async () => {
    if (!workspaceDoc) {
      toast.push("warning", "Workspace record not found.");
      return;
    }

    setProrationSaving(true);
    try {
      const updated = await updateScopedDocument<{ prorationMode: ProrationMode }, Workspace>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.workspaces,
        documentId: workspaceDoc.$id,
        data: {
          prorationMode,
        },
      });
      setWorkspaceDoc(updated);
      if (user) {
        void logAudit({
          entityType: "workspace_proration",
          entityId: workspaceDoc.$id,
          action: "update",
          actorId: user.id,
          details: {
            prorationMode,
          },
        });
      }
      toast.push("success", "Proration policy updated.");
    } catch (saveError) {
      toast.push(
        "error",
        saveError instanceof Error ? saveError.message : "Failed to update proration policy."
      );
    } finally {
      setProrationSaving(false);
    }
  };

  const handleSaveBranding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspaceDoc) {
      toast.push("warning", "Workspace record not found.");
      return;
    }

    setBrandingSaving(true);
    try {
      let nextLogoFileId = branding.logoFileId;
      let nextLogoFileName = branding.logoFileName;
      let nextLogoBucketId = branding.logoBucketId || rcmsReceiptsBucketId;
      const previousLogoFileId = workspaceDoc.logoFileId?.trim() || null;
      const previousLogoBucketId =
        workspaceDoc.logoBucketId?.trim() || rcmsReceiptsBucketId;

      if (brandingFile) {
        if (!ALLOWED_BRANDING_MIME_TYPES.has(brandingFile.type)) {
          throw new Error("Logo must be PNG, JPG, or WEBP.");
        }
        if (brandingFile.size > MAX_BRANDING_FILE_SIZE_BYTES) {
          throw new Error("Logo file must be 2MB or smaller.");
        }

        const uploaded = await storage.createFile(
          rcmsReceiptsBucketId,
          ID.unique(),
          brandingFile
        );
        nextLogoFileId = uploaded.$id;
        nextLogoFileName = uploaded.name || brandingFile.name;
        nextLogoBucketId = rcmsReceiptsBucketId;
      }

      const payload = {
        logoFileId: nextLogoFileId,
        logoBucketId: nextLogoFileId ? nextLogoBucketId : null,
        logoFileName: nextLogoFileId ? nextLogoFileName : null,
        wmEnabled: Boolean(branding.wmEnabled),
        wmPosition: branding.wmPosition,
        wmOpacity: clampWatermarkOpacity(branding.wmOpacity),
        wmScale: clampWatermarkScale(branding.wmScale),
      };

      const updatedWorkspace = await updateScopedDocument<typeof payload, Workspace>({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.workspaces,
        documentId: workspaceDoc.$id,
        data: payload,
      });

      if (
        previousLogoFileId &&
        previousLogoFileId !== payload.logoFileId &&
        previousLogoBucketId
      ) {
        await storage.deleteFile(previousLogoBucketId, previousLogoFileId).catch(() => null);
      }

      setWorkspaceDoc(updatedWorkspace);
      setBranding(normalizeWorkspaceBranding(updatedWorkspace));
      setBrandingFile(null);
      if (updatedWorkspace.logoFileId) {
        setBrandingPreviewUrl(
          getFileViewUrl(
            updatedWorkspace.logoBucketId || rcmsReceiptsBucketId,
            updatedWorkspace.logoFileId
          )
        );
      } else {
        setBrandingPreviewUrl(null);
      }

      if (user) {
        void logAudit({
          entityType: "workspace_branding",
          entityId: workspaceDoc.$id,
          action: "update",
          actorId: user.id,
          details: payload,
        });
      }
      toast.push("success", "Workspace branding saved.");
    } catch (saveError) {
      toast.push(
        "error",
        saveError instanceof Error ? saveError.message : "Failed to save branding."
      );
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!workspaceDoc || !workspaceDoc.logoFileId) {
      setBranding((prev) => ({
        ...prev,
        logoFileId: null,
        logoBucketId: null,
        logoFileName: null,
        wmEnabled: false,
      }));
      setBrandingFile(null);
      setBrandingPreviewUrl(null);
      return;
    }

    if (!window.confirm("Remove the current company logo?")) {
      return;
    }

    setBrandingSaving(true);
    try {
      await updateScopedDocument({
        databaseId: rcmsDatabaseId,
        collectionId: COLLECTIONS.workspaces,
        documentId: workspaceDoc.$id,
        data: {
          logoFileId: null,
          logoBucketId: null,
          logoFileName: null,
          wmEnabled: false,
        },
      });
      await storage
        .deleteFile(
          workspaceDoc.logoBucketId || rcmsReceiptsBucketId,
          workspaceDoc.logoFileId
        )
        .catch(() => null);
      setBranding((prev) => ({
        ...prev,
        logoFileId: null,
        logoBucketId: null,
        logoFileName: null,
        wmEnabled: false,
      }));
      setBrandingFile(null);
      setBrandingPreviewUrl(null);
      await loadWorkspaceSettings();
      toast.push("success", "Company logo removed.");
    } catch {
      toast.push("error", "Failed to remove company logo.");
    } finally {
      setBrandingSaving(false);
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
        workspaceId: activeWorkspaceId,
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
      if (parsed.created) {
        setTeamMemberCount((prev) => prev + 1);
      }
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
          Manage workspace policies, branding, and team permissions.
        </p>
      </header>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Workspace Policies</div>
            <p className="mt-1 text-xs text-slate-400">
              Billing is managed in the Billing Dashboard. Configure proration here.
            </p>
          </div>
          <Link to="/app/billing" className="btn-secondary text-sm">
            Open Billing Dashboard
          </Link>
        </div>

        {workspaceError ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {workspaceError}
          </div>
        ) : null}

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            Rent Proration Policy
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 text-[11px] text-slate-300"
              title="Actual days: prorate using the calendar month length. Fixed 30: prorate using 30 days regardless of the month."
              aria-label="Proration help"
            >
              ?
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Proration applies only for the move-in month. Move-out months are billed
            at the full monthly rent. Prorated amounts are rounded to the nearest 1,000.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="block text-sm text-slate-300">
              Move-in Proration Mode
              <select
                value={prorationMode}
                onChange={(event) =>
                  setProrationMode(
                    event.target.value === "fixed_30" ? "fixed_30" : "actual_days"
                  )
                }
                className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                disabled={prorationSaving || workspaceLoading}
              >
                <option value="actual_days">Actual days in month</option>
                <option value="fixed_30">Fixed 30 days</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleSaveProrationMode}
                disabled={prorationSaving || workspaceLoading}
                className="btn-secondary text-sm disabled:opacity-60"
              >
                {prorationSaving ? "Saving..." : "Save Policy"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border p-2"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("branding")}
            className={[
              "rounded-xl px-4 py-2 text-sm transition",
              activeTab === "branding"
                ? "bg-blue-600 text-white"
                : "border text-slate-300 hover:bg-slate-900/50",
            ].join(" ")}
            style={activeTab === "branding" ? undefined : { borderColor: "var(--border)" }}
          >
            Branding
          </button>
          <button
            type="button"
            onClick={() => setTab("team")}
            className={[
              "rounded-xl px-4 py-2 text-sm transition",
              activeTab === "team"
                ? "bg-blue-600 text-white"
                : "border text-slate-300 hover:bg-slate-900/50",
            ].join(" ")}
            style={activeTab === "team" ? undefined : { borderColor: "var(--border)" }}
          >
            Team & Users
          </button>
        </div>
      </div>

      {activeTab === "branding" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="text-sm font-semibold text-slate-100">Workspace Branding</div>
          <p className="mt-2 text-xs text-slate-500">
            Upload company logo and default watermark settings for report exports.
          </p>

          {brandingLoading ? (
            <div className="mt-4 text-sm text-slate-500">Loading branding settings...</div>
          ) : null}

          <form className="mt-5 space-y-5" onSubmit={handleSaveBranding}>
            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-4">
                <label className="block text-sm text-slate-300">
                  Company Logo (PNG/JPG/WEBP, max 2MB)
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setBrandingFile(file);
                      if (file) {
                        setBrandingPreviewUrl(URL.createObjectURL(file));
                      } else if (branding.logoFileId) {
                        setBrandingPreviewUrl(
                          getFileViewUrl(
                            branding.logoBucketId || rcmsReceiptsBucketId,
                            branding.logoFileId
                          )
                        );
                      } else {
                        setBrandingPreviewUrl(null);
                      }
                    }}
                    disabled={brandingSaving}
                  />
                </label>
                <div className="text-xs text-slate-500">
                  Current file: {branding.logoFileName || "No logo uploaded"}
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={branding.wmEnabled}
                    onChange={(event) =>
                      setBranding((prev) => ({ ...prev, wmEnabled: event.target.checked }))
                    }
                    disabled={brandingSaving || (!branding.logoFileId && !brandingFile)}
                  />
                  Enable watermark by default
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block text-sm text-slate-300">
                    Position
                    <select
                      value={branding.wmPosition}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmPosition: event.target.value as WatermarkPosition,
                        }))
                      }
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      disabled={brandingSaving}
                    >
                      {WATERMARK_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {position.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-slate-300">
                    Opacity ({Math.round(branding.wmOpacity * 100)}%)
                    <input
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={Math.round(branding.wmOpacity * 100)}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmOpacity: clampWatermarkOpacity(Number(event.target.value) / 100),
                        }))
                      }
                      className="mt-2 w-full"
                      disabled={brandingSaving}
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Size ({branding.wmScale}%)
                    <input
                      type="range"
                      min={10}
                      max={80}
                      step={1}
                      value={branding.wmScale}
                      onChange={(event) =>
                        setBranding((prev) => ({
                          ...prev,
                          wmScale: clampWatermarkScale(Number(event.target.value)),
                        }))
                      }
                      className="mt-2 w-full"
                      disabled={brandingSaving}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={brandingSaving}
                    className="btn-primary text-sm disabled:opacity-60"
                  >
                    {brandingSaving ? "Saving..." : "Save Branding"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    disabled={brandingSaving || (!branding.logoFileId && !brandingFile)}
                    className="btn-secondary text-sm disabled:opacity-60"
                  >
                    Remove Logo
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Watermark Preview
                </div>
                <div
                  className="relative h-64 overflow-hidden rounded-2xl border"
                  style={{ borderColor: "var(--border)", backgroundColor: "#f8fafc" }}
                >
                  <div className="absolute inset-0 p-5 text-[11px] text-slate-500">
                    <div className="font-semibold text-slate-700">RCMS Sample Report</div>
                    <div className="mt-2 space-y-1">
                      <div>Summary of Tenants&apos; Payment Status</div>
                      <div>Range: 01/03/26 to 31/03/26</div>
                      <div>Total Rent Collected: 4,500,000</div>
                    </div>
                  </div>
                  {brandingPreviewUrl && branding.wmEnabled ? (
                    <img
                      src={brandingPreviewUrl}
                      alt="Watermark preview"
                      className="pointer-events-none absolute select-none object-contain"
                      style={{
                        width: `${branding.wmScale}%`,
                        opacity: branding.wmOpacity,
                        left:
                          branding.wmPosition === "top_left" || branding.wmPosition === "bottom_left"
                            ? "10px"
                            : branding.wmPosition === "top_right" || branding.wmPosition === "bottom_right"
                              ? "auto"
                              : "50%",
                        right:
                          branding.wmPosition === "top_right" || branding.wmPosition === "bottom_right"
                            ? "10px"
                            : "auto",
                        top:
                          branding.wmPosition === "top_left" || branding.wmPosition === "top_right"
                            ? "10px"
                            : branding.wmPosition === "bottom_left" || branding.wmPosition === "bottom_right"
                              ? "auto"
                              : "50%",
                        bottom:
                          branding.wmPosition === "bottom_left" || branding.wmPosition === "bottom_right"
                            ? "10px"
                            : "auto",
                        transform:
                          branding.wmPosition === "center" ? "translate(-50%, -50%)" : undefined,
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                      {brandingPreviewUrl
                        ? "Enable watermark to preview placement."
                        : "Upload a logo to preview watermark."}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  These are default settings. Reports page allows per-export overrides.
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "team" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="text-sm font-semibold text-slate-100">Add Team User</div>
          <p className="mt-2 text-xs text-slate-500">
            For existing users, leave password empty to only update role assignment.
          </p>
          {planLimits.maxTeamMembers != null ? (
            <div className="mt-3 text-xs text-amber-300">
              Team member usage: {teamMemberLimitStatus.used.toLocaleString()} /{" "}
              {formatLimitValue(teamMemberLimitStatus.limit)}
              {teamMemberLimitStatus.reached
                ? " (limit reached - upgrade to add more users)"
                : ""}
              {teamMemberLimitStatus.reached ? (
                <Link to="/app/billing" className="ml-2 underline">
                  Open Billing
                </Link>
              ) : null}
            </div>
          ) : null}
          {!manageUsersAccess.allowed ? (
            <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 p-4 text-sm text-amber-100">
              {manageUsersAccess.reason ||
                "User management is locked on your current plan. Upgrade to continue."}
              <div className="mt-2">
                <Link to="/app/billing" className="underline">
                  Open Billing Dashboard
                </Link>
              </div>
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

          <WorkspaceInvitationsPanel />
        </div>
      )}
    </section>
  );
}
