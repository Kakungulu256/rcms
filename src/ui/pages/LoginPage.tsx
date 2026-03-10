import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { OAuthProvider } from "appwrite";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { account } from "../../lib/appwrite";
import { useToast } from "../ToastContext";

type LoginForm = {
  email: string;
  password: string;
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

export default function LoginPage() {
  const { signIn, loading, error, user } = useAuth();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/app";
  const isTrialIntent = useMemo(
    () => new URLSearchParams(location.search).get("intent") === "trial",
    [location.search]
  );
  const oauthFailed = useMemo(
    () => new URLSearchParams(location.search).get("oauth") === "failed",
    [location.search]
  );
  const resetSuccess = useMemo(
    () => new URLSearchParams(location.search).get("reset") === "success",
    [location.search]
  );
  const { register, handleSubmit, getValues } = useForm<LoginForm>({
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!loading && user) {
      navigate("/app", { replace: true });
    }
  }, [loading, navigate, user]);

  useEffect(() => {
    if (oauthFailed) {
      setActionError("Google sign-in failed. Please try again.");
    }
  }, [oauthFailed]);

  useEffect(() => {
    if (resetSuccess) {
      toast.push("success", "Password reset successful. Sign in with your new password.");
    }
  }, [resetSuccess, toast]);

  const onSubmit = async (values: LoginForm) => {
    setActionError(null);
    const ok = await signIn(values.email, values.password);
    if (ok) {
      navigate(from, { replace: true });
    }
  };

  const handleGoogleSignIn = async () => {
    setActionError(null);
    try {
      const origin = window.location.origin;
      await account.createOAuth2Session(
        OAuthProvider.Google,
        `${origin}/app`,
        `${origin}/login?oauth=failed`
      );
    } catch (oauthError) {
      const message =
        oauthError instanceof Error ? oauthError.message : "Unable to start Google sign-in.";
      setActionError(message);
      toast.push("error", message);
    }
  };

  const handleForgotPassword = async () => {
    setActionError(null);
    const email = getValues("email")?.trim().toLowerCase() ?? "";
    if (!email) {
      const message = "Enter your email first, then click Forgot password.";
      setActionError(message);
      toast.push("warning", message);
      return;
    }
    setRecoveryLoading(true);
    try {
      const recoveryUrl = `${window.location.origin}/reset-password`;
      await account.createRecovery(email, recoveryUrl);
      toast.push("success", "Password reset link sent. Check your email.");
    } catch (recoverError) {
      const message =
        recoverError instanceof Error
          ? recoverError.message
          : "Unable to send password reset email.";
      setActionError(message);
      toast.push("error", message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <div className="text-sm text-slate-400">RCMS</div>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              Rent Collection Management
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {isTrialIntent
                ? "Start your free trial workspace. Sign in with your account to continue setup."
                : "Sign in to manage tenants, track payments, and monitor expenses."}
            </p>
            <div className="mt-4">
              <Link to="/" className="text-sm font-medium text-blue-200 hover:underline">
                Back to home
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
            <h2 className="text-xl font-semibold text-white">Welcome back</h2>
            {/* <p className="mt-1 text-sm text-slate-500">
              Use your Appwrite credentials.
            </p> */}

            <form
              className="mt-6 space-y-4"
              onSubmit={handleSubmit(onSubmit, () => {
                toast.push("warning", "Enter both email and password to continue.");
              })}
            >
              <label className="block text-sm text-slate-300">
                Email
                <input
                  type="email"
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  placeholder="you@example.com"
                  {...register("email", { required: true })}
                />
              </label>
              <label className="block text-sm text-slate-300">
                Password
                <div className="relative mt-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="input-base w-full rounded-md px-3 py-2 pr-11 text-sm"
                    placeholder="********"
                    {...register("password", { required: true })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path d="M3 3l18 18" />
                        <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                        <path d="M9.88 5.09A9.76 9.76 0 0112 5c5 0 9.27 3.11 11 7-1.01 2.27-2.67 4.2-4.73 5.5" />
                        <path d="M6.61 6.61C4.54 7.85 2.87 9.76 2 12c1.73 3.89 6 7 10 7 1.33 0 2.61-.24 3.8-.68" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>
              {error && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}
              {actionError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {actionError}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full text-sm disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
              <div className="relative py-1">
                <div className="h-px bg-slate-700/70" />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900/50 px-2 text-xs font-semibold tracking-wide text-slate-400">
                  OR
                </span>
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
              >
                <GoogleLogoIcon />
                Continue with Google
              </button>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={recoveryLoading}
                className="w-full text-sm font-medium text-blue-200 hover:underline disabled:opacity-60"
              >
                {recoveryLoading ? "Sending reset link..." : "Forgot password?"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
