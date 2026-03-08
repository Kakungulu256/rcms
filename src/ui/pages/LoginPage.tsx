import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

type LoginForm = {
  email: string;
  password: string;
};

export default function LoginPage() {
  const { signIn, loading, error } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const { register, handleSubmit } = useForm<LoginForm>({
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginForm) => {
    const ok = await signIn(values.email, values.password);
    if (ok) {
      navigate(from, { replace: true });
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
              Sign in to manage tenants, track payments, and monitor expenses.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
            <h2 className="text-xl font-semibold text-white">Welcome back</h2>
            {/* <p className="mt-1 text-sm text-slate-500">
              Use your Appwrite credentials.
            </p> */}

            <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
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
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full text-sm disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
