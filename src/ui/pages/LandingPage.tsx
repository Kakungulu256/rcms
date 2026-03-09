import { Link } from "react-router-dom";

type Plan = {
  name: string;
  price: string;
  description: string;
  points: string[];
  cta: string;
  highlighted?: boolean;
};

const plans = [
  {
    name: "Starter",
    price: "49,000 UGX / month",
    description: "For one small team managing day-to-day rent collection.",
    points: [
      "Up to 1 workspace",
      "Core rent, tenant, house, and expense tracking",
      "Standard exports and reports",
    ],
    cta: "Choose Starter",
  },
  {
    name: "Growth",
    price: "149,000 UGX / month",
    description: "For active teams with higher transaction volume.",
    points: ["Everything in Starter", "Larger team capacity", "Priority operational support"],
    cta: "Choose Growth",
    highlighted: true,
  },
  {
    name: "Agency",
    price: "349,000 UGX / month",
    description: "For multi-property managers working across many landlords.",
    points: ["Everything in Growth", "High usage limits", "Advanced reporting and controls"],
    cta: "Choose Agency",
  },
] satisfies Plan[];

const highlights = [
  { label: "Payment Allocation", text: "Auto-allocation to oldest arrears with clear month-by-month history." },
  { label: "Team Control", text: "Workspace-based access with role permissions for admin, clerk, and viewer." },
  { label: "Export Reports", text: "Generate monthly, tenant, and collection reports in PDF and XLSX." },
];

const stats = [
  { value: "5 days", label: "Trial Period" },
  { value: "3 roles", label: "Built-in RBAC" },
  { value: "24/7", label: "Cloud Access" },
];

const faqs = [
  {
    q: "Can I start with a trial?",
    a: "Yes. You can start with a free trial, then pick a plan when you are ready to continue.",
  },
  {
    q: "Can one workspace manage many landlords and properties?",
    a: "Yes. RCMS is designed for property managers handling multiple properties under one customer workspace.",
  },
  {
    q: "Do role permissions still apply?",
    a: "Yes. Admin, clerk, and viewer roles still control what each team member can access and do.",
  },
];

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen" style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}>
      <header
        className="landing-header sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", backgroundColor: "rgba(255, 255, 255, 0.92)" }}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-8">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                RCMS
              </div>
              <h1 className="text-base font-semibold">Rent Collection Management</h1>
            </div>
            <nav className="hidden items-center gap-5 text-sm md:flex" style={{ color: "var(--muted)" }}>
              <a href="#features" className="landing-nav-link">
                Features
              </a>
              <a href="#pricing" className="landing-nav-link">
                Pricing
              </a>
              <a href="#faq" className="landing-nav-link">
                FAQs
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="landing-btn-secondary text-sm">
              Login
            </Link>
            <Link to="/signup" className="landing-btn-primary text-sm">
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-10 md:px-8 md:pb-14 md:pt-14">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div
              className="landing-hero-shell rounded-3xl border p-6 md:p-10"
              style={{
                borderColor: "var(--border)",
                background:
                  "radial-gradient(circle at top right, rgba(79,70,229,0.14), rgba(255,255,255,0.9) 55%), var(--surface)",
              }}
            >
              <div className="mb-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "rgba(59, 130, 246, 0.3)", color: "var(--accent-strong)", backgroundColor: "rgba(59, 130, 246, 0.08)" }}>
                Live rent tracking and reporting
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Operations Platform
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
                Professional rent operations for modern property teams.
              </h2>
              <p className="mt-5 max-w-2xl text-base" style={{ color: "var(--muted)" }}>
                Manage houses, tenants, payments, expenses, security deposits, and exports from a single workspace.
                Built for property managers handling multiple landlords and properties.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/signup" className="landing-btn-primary text-sm">
                  Start 5-Day Trial
                </Link>
                <Link to="/login" className="landing-btn-secondary text-sm">
                  Login to RCMS
                </Link>
                <a href="#pricing" className="landing-btn-ghost text-sm">
                  See Pricing
                </a>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {stats.map((item) => (
                  <div
                    key={item.label}
                    className="landing-stat-card rounded-xl border px-4 py-3"
                    style={{ borderColor: "var(--border)", backgroundColor: "rgba(255, 255, 255, 0.72)" }}
                  >
                    <div className="text-lg font-semibold">{item.value}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div
                className="landing-card rounded-3xl border p-5"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              >
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                  What You Get
                </h3>
                <div className="mt-4 space-y-3">
                  {highlights.map((item) => (
                    <article
                      key={item.label}
                      className="landing-card rounded-xl border px-4 py-3"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-strong)" }}
                    >
                      <h4 className="text-sm font-semibold">{item.label}</h4>
                      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                        {item.text}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
              <div
                className="landing-card rounded-3xl border p-5"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              >
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                  Built for Daily Operations
                </h3>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Fast tenant lookup, arrears tracking, receipt uploads, report exports, and role-based approvals.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8 md:pb-14">
          <div
            className="landing-card rounded-3xl border p-6 md:p-8"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            <h3 className="text-2xl font-semibold">Why teams choose RCMS</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <article
                className="landing-card rounded-xl border p-4"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-strong)" }}
              >
                <h4 className="font-semibold">Accurate Monthly Position</h4>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Separate active and inactive arrears, apply reversals safely, and keep collection totals consistent.
                </p>
              </article>
              <article
                className="landing-card rounded-xl border p-4"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-strong)" }}
              >
                <h4 className="font-semibold">Operational Control</h4>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Grant only the actions each user needs with strong role controls and workspace-level scoping.
                </p>
              </article>
              <article
                className="landing-card rounded-xl border p-4"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-strong)" }}
              >
                <h4 className="font-semibold">Audit-Ready Exports</h4>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Generate clear reports with notes, payment status context, and consistent formatting for stakeholders.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8 md:pb-14">
          <h3 className="text-2xl font-semibold">Pricing</h3>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Pick a plan based on your team size and portfolio.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className="landing-plan-card rounded-2xl border p-5"
                style={{
                  borderColor: plan.highlighted ? "var(--accent)" : "var(--border)",
                  backgroundColor: "var(--surface)",
                  boxShadow: plan.highlighted ? "0 14px 34px rgba(59, 130, 246, 0.12)" : undefined,
                }}
              >
                <h4 className="text-lg font-semibold">{plan.name}</h4>
                <p className="mt-1 text-xl font-semibold">{plan.price}</p>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {plan.description}
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span style={{ color: "var(--muted)" }}>{point}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className="landing-btn-primary mt-5 inline-flex text-sm">
                  {plan.cta}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8 md:pb-16">
          <h3 className="text-2xl font-semibold">Frequently Asked Questions</h3>
          <div className="mt-5 space-y-3">
            {faqs.map((item) => (
              <details
                key={item.q}
                className="landing-faq-item rounded-xl border p-4"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              >
                <summary className="cursor-pointer text-base font-semibold">{item.q}</summary>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8 md:pb-16">
          <div
            className="landing-cta-band flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 md:px-7 md:py-6"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            <div>
              <h3 className="text-xl font-semibold">Ready to streamline rent operations?</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Create your workspace and start with a 5-day trial.
              </p>
            </div>
            <div className="flex gap-3">
              <Link to="/signup" className="landing-btn-primary text-sm">
                Start Free Trial
              </Link>
              <Link to="/login" className="landing-btn-secondary text-sm">
                Login
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-sm md:px-8">
          <p style={{ color: "var(--muted)" }}>RCMS. Rental operations and reporting platform.</p>
          <div className="flex items-center gap-4" style={{ color: "var(--muted)" }}>
            <a href="#pricing" className="landing-nav-link">
              Pricing
            </a>
            <a href="#faq" className="landing-nav-link">
              FAQ
            </a>
            <Link to="/login" className="landing-nav-link">
              Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
