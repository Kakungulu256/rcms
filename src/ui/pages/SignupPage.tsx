import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ID, OAuthProvider } from "appwrite";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { account, functions } from "../../lib/appwrite";
import { setActiveWorkspaceId } from "../../lib/workspace";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../ToastContext";

type BootstrapWorkspaceResult =
  | {
      ok: true;
      created: boolean;
      workspace: {
        $id: string;
        name: string;
      };
      subscription?: {
        state?: string;
        trialEndDate?: string;
      };
    }
  | {
      ok: false;
      error?: string;
    };

function GoogleLogoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C34.216 32.658 29.65 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.046 6.053 29.268 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.148 35.091 26.715 36 24 36c-5.173 0-9.625-3.332-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-1.091 3.051-4 5.45-7.914 5.45-2.698 0-5.116-.898-7.174-2.4l6.19 5.238C29.86 42.023 24 44 24 44c11.045 0 20-8.955 20-20 0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function parseExecutionBody(response?: string) {
  try {
    return response ? (JSON.parse(response) as BootstrapWorkspaceResult) : null;
  } catch {
    return null;
  }
}

async function executeBootstrapFunction(functionId: string, payload: Record<string, unknown>) {
  const execution = await functions.createExecution(functionId, JSON.stringify(payload), false);
  const readBody = (value: unknown) =>
    (value as { responseBody?: string; response?: string }).responseBody ??
    (value as { responseBody?: string; response?: string }).response ??
    "";

  let latest: unknown = execution;
  let body = readBody(latest);
  let attempts = 0;
  while (
    attempts < 10 &&
    (!body ||
      (latest as { status?: string }).status === "waiting" ||
      (latest as { status?: string }).status === "processing")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    latest = await functions.getExecution(functionId, (latest as { $id: string }).$id);
    body = readBody(latest);
    attempts += 1;
  }

  return {
    parsed: parseExecutionBody(body),
    latest: latest as { errors?: string },
  };
}

export default function SignupPage() {
  const { user, loading, signIn, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const bootstrapFunctionId = import.meta.env
    .VITE_BOOTSTRAP_WORKSPACE_FUNCTION_ID as string | undefined;
  const oauthFailed = useMemo(
    () => new URLSearchParams(location.search).get("oauth") === "failed",
    [location.search]
  );

  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user?.hasWorkspace) {
      navigate("/app", { replace: true });
    }
  }, [loading, navigate, user]);

  useEffect(() => {
    if (oauthFailed) {
      setError("Google sign-up failed. Please try again.");
    }
  }, [oauthFailed]);

  useEffect(() => {
    if (!workspaceName.trim() && user?.name?.trim()) {
      setWorkspaceName(`${user.name.trim()} Workspace`);
    }
  }, [user, workspaceName]);

  const runWorkspaceBootstrap = async (nameInput: string) => {
    if (!bootstrapFunctionId) {
      const message = "Signup bootstrap function ID is missing.";
      setError(message);
      toast.push("error", message);
      return;
    }
    const normalizedWorkspaceName = nameInput.trim();
    if (normalizedWorkspaceName.length < 3) {
      const message = "Workspace name must be at least 3 characters.";
      setError(message);
      toast.push("warning", message);
      return;
    }

    const jwt = await account.createJWT();
    const { parsed, latest } = await executeBootstrapFunction(bootstrapFunctionId, {
      jwt: jwt.jwt,
      workspaceName: normalizedWorkspaceName,
    });

    if (!parsed || !parsed.ok || !parsed.workspace?.$id) {
      const parsedError = parsed && !parsed.ok ? parsed.error : null;
      throw new Error(parsedError || latest?.errors || "Workspace bootstrap failed.");
    }

    setActiveWorkspaceId(parsed.workspace.$id);
    await refresh();
    toast.push("success", "Trial started. Welcome to RCMS.");
    navigate("/app", { replace: true });
  };

  const handleGoogleSignup = async () => {
    setError(null);
    try {
      const origin = window.location.origin;
      await account.createOAuth2Session(
        OAuthProvider.Google,
        `${origin}/signup`,
        `${origin}/signup?oauth=failed`
      );
    } catch (oauthError) {
      const message =
        oauthError instanceof Error ? oauthError.message : "Unable to start Google sign-up.";
      setError(message);
      toast.push("error", message);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const normalizedName = fullName.trim();
    const normalizedWorkspaceName = workspaceName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedName) {
      const message = "Full name is required.";
      setError(message);
      toast.push("warning", message);
      return;
    }
    if (!normalizedEmail) {
      const message = "Email is required.";
      setError(message);
      toast.push("warning", message);
      return;
    }
    if (normalizedPassword.length < 8) {
      const message = "Password must be at least 8 characters.";
      setError(message);
      toast.push("warning", message);
      return;
    }

    setSubmitting(true);
    try {
      await account.create(ID.unique(), normalizedEmail, normalizedPassword, normalizedName);
      const signedIn = await signIn(normalizedEmail, normalizedPassword);
      if (!signedIn) {
        throw new Error("Account was created, but sign-in failed.");
      }
      await runWorkspaceBootstrap(normalizedWorkspaceName);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to create account.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await runWorkspaceBootstrap(workspaceName);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to complete workspace setup.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const isWorkspaceSetupMode = Boolean(user && !user.hasWorkspace);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <div className="text-sm text-slate-400">RCMS</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Start Your Free Trial</h1>
            <p className="mt-3 text-sm text-slate-500">
              Create your workspace, get admin access, and start managing tenants, payments,
              expenses, and reports in minutes.
            </p>
            <div className="mt-6 space-y-2 text-sm text-slate-400">
              <div>1. Create account</div>
              <div>2. Workspace is provisioned automatically</div>
              <div>3. Trial starts immediately</div>
            </div>
            <div className="mt-6">
              <Link to="/" className="text-sm font-medium text-blue-200 hover:underline">
                Back to home
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
            <h2 className="text-xl font-semibold text-white">
              {isWorkspaceSetupMode ? "Complete Workspace Setup" : "Create account"}
            </h2>

            {!isWorkspaceSetupMode ? (
              <>
                <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                  <label className="block text-sm text-slate-300">
                    Full Name
                    <input
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      placeholder="Jane Doe"
                      required
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Workspace / Company Name
                    <input
                      type="text"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      placeholder="Acme Property Managers"
                      required
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      placeholder="you@example.com"
                      required
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                      placeholder="At least 8 characters"
                      minLength={8}
                      required
                    />
                  </label>

                  {error && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={submitting} className="btn-primary w-full text-sm disabled:opacity-60">
                    {submitting ? "Creating workspace..." : "Create Account"}
                  </button>
                </form>

                <div className="relative mt-5 py-1">
                  <div className="h-px bg-slate-700/70" />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900/50 px-2 text-xs font-semibold tracking-wide text-slate-400">
                    OR
                  </span>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleGoogleSignup}
                    className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
                  >
                    <GoogleLogoIcon />
                    Continue with Google
                  </button>
                </div>

                <p className="mt-5 text-sm text-slate-500">
                  Already have an account?{" "}
                  <Link to="/login" className="font-medium text-blue-200 hover:underline">
                    Login
                  </Link>
                </p>
              </>
            ) : (
              <form className="mt-6 space-y-4" onSubmit={handleCompleteWorkspace}>
                <p className="text-sm text-slate-400">
                  You are signed in. Set your workspace name to finish onboarding.
                </p>
                <label className="block text-sm text-slate-300">
                  Workspace / Company Name
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                    placeholder="Acme Property Managers"
                    required
                  />
                </label>
                {error && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </div>
                )}
                <button type="submit" disabled={submitting} className="btn-primary w-full text-sm disabled:opacity-60">
                  {submitting ? "Finishing setup..." : "Complete Setup"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
