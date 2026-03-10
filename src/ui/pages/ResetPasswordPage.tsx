import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { account } from "../../lib/appwrite";
import { useToast } from "../ToastContext";

export default function ResetPasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const userId = params.get("userId")?.trim() ?? "";
  const secret = params.get("secret")?.trim() ?? "";
  const hasToken = userId.length > 0 && secret.length > 0;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!hasToken) {
      setError("Invalid or expired recovery link.");
      return;
    }
    if (password.trim().length < 8) {
      const message = "Password must be at least 8 characters.";
      setError(message);
      toast.push("warning", message);
      return;
    }
    if (password !== confirmPassword) {
      const message = "Passwords do not match.";
      setError(message);
      toast.push("warning", message);
      return;
    }

    setSubmitting(true);
    try {
      await account.updateRecovery(userId, secret, password);
      toast.push("success", "Password reset successful.");
      navigate("/login?reset=success", { replace: true });
    } catch (resetError) {
      const message =
        resetError instanceof Error ? resetError.message : "Failed to reset password.";
      setError(message);
      toast.push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-8">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h1 className="text-2xl font-semibold text-white">Reset Password</h1>
          <p className="mt-2 text-sm text-slate-400">
            Set a new password for your RCMS account.
          </p>

          {!hasToken ? (
            <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              Invalid recovery token. Request a new password reset email from the login page.
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <label className="block text-sm text-slate-300">
                New Password
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
              <label className="block text-sm text-slate-300">
                Confirm New Password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  placeholder="Repeat password"
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
                {submitting ? "Updating password..." : "Reset Password"}
              </button>
            </form>
          )}

          <div className="mt-6">
            <Link to="/login" className="text-sm font-medium text-blue-200 hover:underline">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
