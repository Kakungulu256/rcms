import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

type LoginForm = {
  email: string;
  password: string;
};

export default function LoginPage() {
  const { signIn, loading, error } = useAuth();
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
              Rental Collection Management
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
                <input
                  type="password"
                  className="input-base mt-2 w-full rounded-md px-3 py-2 text-sm"
                  placeholder="********"
                  {...register("password", { required: true })}
                />
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
