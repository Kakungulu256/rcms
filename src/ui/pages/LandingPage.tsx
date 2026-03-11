import { Query } from "appwrite";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { COLLECTIONS, decodeJson, type Plan } from "../../lib/schema";
import { databases, rcmsDatabaseId } from "../../lib/appwrite";
import { formatLimitValue, parsePlanLimits } from "../../lib/planLimits";

type PlanCard = {
  name: string;
  description: string;
  points: string[];
  cta: string;
  highlighted?: boolean;
  trialDays?: number;
  isTrial?: boolean;
  limits: {
    houses: string;
    tenants: string;
    exports: string;
  };
  terms: Record<
    "monthly" | "six_months" | "annual",
    {
      label: string;
      display: string;
      savingsPercent?: number;
      billingNote?: string;
    }
  >;
  contactUrl?: string | null;
  isEnterprise?: boolean;
};

const fallbackPlans = [
  {
    name: "Trial",
    description: "Short trial access to explore the essentials.",
    points: [
      "Try the core workflow with light limits",
      "See how arrears allocation and reports work",
      "Upgrade anytime to unlock full capacity",
    ],
    cta: "Start Free Trial",
    trialDays: 5,
    isTrial: true,
    limits: {
      houses: "10 houses",
      tenants: "20 active tenants",
      exports: "10 exports / month",
    },
    terms: {
      monthly: { label: "Monthly", display: "UGX 0 / month" },
      six_months: { label: "6 months", display: "UGX 0 / month" },
      annual: { label: "Annual", display: "UGX 0 / month" },
    },
  },
  {
    name: "Starter",
    description: "For small landlords and teams managing a few houses.",
    points: [
      "Quick setup for day-to-day rent operations",
      "Track tenants, houses, payments, and expenses",
      "Basic reporting and exports",
    ],
    cta: "Start with Starter",
    limits: {
      houses: "10 houses",
      tenants: "20 active tenants",
      exports: "10 exports / month",
    },
    terms: {
      monthly: { label: "Monthly", display: "Pay as you go" },
      six_months: { label: "6 months", display: "Save 10% with 6 months upfront", savingsPercent: 10 },
      annual: { label: "Annual", display: "Save 20% with yearly billing", savingsPercent: 20 },
    },
  },
  {
    name: "Growth",
    description: "For growing portfolios that need more tenants and exports.",
    points: [
      "Everything in Starter, with higher limits",
      "More team members and faster reporting",
      "Great for steady monthly collections",
    ],
    cta: "Choose Growth",
    highlighted: true,
    limits: {
      houses: "40 houses",
      tenants: "120 active tenants",
      exports: "60 exports / month",
    },
    terms: {
      monthly: { label: "Monthly", display: "Pay as you go" },
      six_months: { label: "6 months", display: "Save 10% with 6 months upfront", savingsPercent: 10 },
      annual: { label: "Annual", display: "Save 20% with yearly billing", savingsPercent: 20 },
    },
  },
  {
    name: "Agency",
    description: "For agencies managing many houses and tenants at scale.",
    points: [
      "Everything in Growth, with premium limits",
      "Built for multi-property management",
      "Advanced reporting and controls",
    ],
    cta: "Choose Agency",
    limits: {
      houses: "600 houses",
      tenants: "2,000 active tenants",
      exports: "1,000 exports / month",
    },
    terms: {
      monthly: { label: "Monthly", display: "Pay as you go" },
      six_months: { label: "6 months", display: "Save 10% with 6 months upfront", savingsPercent: 10 },
      annual: { label: "Annual", display: "Save 20% with yearly billing", savingsPercent: 20 },
    },
  },
  {
    name: "Enterprise",
    description: "Unlimited scale with dedicated support and tailored onboarding.",
    points: [
      "Unlimited houses, tenants, and exports",
      "Custom onboarding and support",
      "Tailored pricing for large portfolios",
    ],
    cta: "Contact Admin",
    limits: {
      houses: "Unlimited houses",
      tenants: "Unlimited tenants",
      exports: "Unlimited exports",
    },
    terms: {
      monthly: { label: "Monthly", display: "Talk to us for enterprise pricing" },
      six_months: { label: "6 months", display: "Talk to us for enterprise pricing" },
      annual: { label: "Annual", display: "Talk to us for enterprise pricing" },
    },
    contactUrl: "/login",
    isEnterprise: true,
  },
] satisfies PlanCard[];

const defaultPlanPoints = [
  "Role-based team access (admin, clerk, viewer)",
  "Tenants, houses, payments, expenses, and deposits",
  "Export-ready operational reports",
];

type BillingDiscounts = {
  sixMonthPercent: number;
  annualPercent: number;
};

function formatCurrency(amount: number, currency: string | undefined) {
  const isoCurrency = String(currency ?? "UGX").trim().toUpperCase() || "UGX";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: isoCurrency,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toLocaleString()} ${isoCurrency}`;
  }
}

function normalizeDiscounts(metadata: Record<string, unknown> | null): BillingDiscounts {
  const sixMonthPercent = Number(metadata?.sixMonthDiscountPercent ?? metadata?.discount6MonthsPercent);
  const annualPercent = Number(metadata?.annualDiscountPercent ?? metadata?.discountAnnualPercent);
  return {
    sixMonthPercent: Number.isFinite(sixMonthPercent) ? Math.min(Math.max(sixMonthPercent, 0), 60) : 10,
    annualPercent: Number.isFinite(annualPercent) ? Math.min(Math.max(annualPercent, 0), 60) : 20,
  };
}

function buildTermPricing(params: {
  amount: number | undefined;
  currency: string | undefined;
  discounts: BillingDiscounts;
  isTrial: boolean;
}) {
  const { amount, currency, discounts, isTrial } = params;
  if (!Number.isFinite(amount as number)) {
    return {
      monthly: { label: "Monthly", display: "Talk to us for enterprise pricing" },
      six_months: { label: "6 months", display: "Talk to us for enterprise pricing" },
      annual: { label: "Annual", display: "Talk to us for enterprise pricing" },
    };
  }

  const monthlyDisplay = `${formatCurrency(Number(amount), currency)} / month`;
  if (isTrial) {
    return {
      monthly: { label: "Monthly", display: monthlyDisplay },
      six_months: { label: "6 months", display: monthlyDisplay },
      annual: { label: "Annual", display: monthlyDisplay },
    };
  }

  const sixMonthsTotal = Number(amount) * 6 * (1 - discounts.sixMonthPercent / 100);
  const annualTotal = Number(amount) * 12 * (1 - discounts.annualPercent / 100);

  return {
    monthly: { label: "Monthly", display: monthlyDisplay, billingNote: "Billed monthly" },
    six_months: {
      label: "6 months",
      display: `${formatCurrency(sixMonthsTotal, currency)} total`,
      savingsPercent: discounts.sixMonthPercent,
      billingNote: "Billed every 6 months",
    },
    annual: {
      label: "Annual",
      display: `${formatCurrency(annualTotal, currency)} total`,
      savingsPercent: discounts.annualPercent,
      billingNote: "Billed yearly",
    },
  };
}

const highlights = [
  { label: "Payment Allocation", text: "Auto-allocation to oldest arrears with clear month-by-month history." },
  { label: "Team Control", text: "Workspace-based access with role permissions for admin, clerk, and viewer." },
  { label: "Export Reports", text: "Generate monthly, tenant, and collection reports in PDF and XLSX." },
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
  const [plans, setPlans] = useState<PlanCard[]>(fallbackPlans);
  const [pricingSource, setPricingSource] = useState<"catalog" | "fallback">("fallback");
  const [billingTerm, setBillingTerm] = useState<"monthly" | "six_months" | "annual">("monthly");

  useEffect(() => {
    let cancelled = false;

    const loadPlans = async () => {
      try {
        const response = await databases.listDocuments(rcmsDatabaseId, COLLECTIONS.plans, [
          Query.equal("isActive", [true]),
          Query.orderAsc("sortOrder"),
          Query.limit(20),
        ]);

        const planCards = (response.documents as unknown as Plan[])
          .map((document, index) => {
            const metadata = decodeJson<{
              points?: string[];
              cta?: string;
              highlighted?: boolean;
              contactUrl?: string;
              contactLabel?: string;
              isEnterprise?: boolean;
            }>(document.metadataJson);
            const points =
              Array.isArray(metadata?.points) && metadata.points.length > 0
                ? metadata.points.filter((point) => String(point).trim().length > 0)
                : defaultPlanPoints;
            const limits = parsePlanLimits(document);
            const isEnterprisePlan =
              Boolean(metadata?.isEnterprise) ||
              String(document.code || "").toLowerCase().includes("enterprise");
            const isTrialPlan =
              String(document.code || "").toLowerCase().includes("trial") ||
              String(document.name || "").toLowerCase().includes("trial") ||
              (Number(document.priceAmount ?? 0) === 0 && Number(document.trialDays ?? 0) > 0);
            const discounts = isTrialPlan ? { sixMonthPercent: 0, annualPercent: 0 } : normalizeDiscounts((metadata ?? {}) as Record<string, unknown>);
            const termPricing = buildTermPricing({
              amount: isEnterprisePlan ? undefined : document.priceAmount,
              currency: document.currency,
              discounts,
              isTrial: isTrialPlan,
            });

            return {
              name: document.name || document.code || `Plan ${index + 1}`,
              description:
                document.description?.trim() ||
                "Flexible plan for operational rent collection and reporting.",
              points,
              cta:
                metadata?.cta?.trim() ||
                (isEnterprisePlan ? "Contact Admin" : `Choose ${document.name || "Plan"}`),
              highlighted: Boolean(metadata?.highlighted),
              trialDays: Number(document.trialDays ?? 0),
              isTrial: isTrialPlan,
              limits: {
                houses: `${formatLimitValue(isEnterprisePlan ? null : limits.maxHouses)} houses`,
                tenants: `${formatLimitValue(isEnterprisePlan ? null : limits.maxActiveTenants)} active tenants`,
                exports: `${formatLimitValue(isEnterprisePlan ? null : limits.exportsPerMonth)} exports / month`,
              },
              terms: termPricing,
              contactUrl: metadata?.contactUrl?.trim() || null,
              isEnterprise: isEnterprisePlan,
            };
          })
          .filter((plan) => plan.name.trim().length > 0);

        if (cancelled || planCards.length === 0) return;

        const hasEnterprise = planCards.some((plan) => plan.isEnterprise);
        const mergedPlans = hasEnterprise ? planCards : [...planCards, fallbackPlans[fallbackPlans.length - 1]];

        mergedPlans.sort((a, b) => {
          if (a.highlighted && !b.highlighted) return -1;
          if (!a.highlighted && b.highlighted) return 1;
          return 0;
        });
        setPlans(mergedPlans);
        setPricingSource("catalog");
      } catch {
        if (!cancelled) {
          setPlans(fallbackPlans);
          setPricingSource("fallback");
        }
      }
    };

    void loadPlans();

    return () => {
      cancelled = true;
    };
  }, []);

  const trialLabel = useMemo(() => {
    const candidate = plans
      .map((plan) => Number(plan.trialDays ?? 0))
      .find((days) => Number.isFinite(days) && days > 0);
    if (candidate && candidate > 0) {
      return `${candidate.toLocaleString()} days`;
    }
    return "Configurable";
  }, [plans]);

  const stats = useMemo(
    () => [
      { value: trialLabel, label: "Trial Period" },
      { value: "3 roles", label: "Built-in RBAC" },
      { value: "24/7", label: "Cloud Access" },
    ],
    [trialLabel]
  );

  return (
    <div className="landing-page min-h-screen" style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}>
      <header
        className="landing-header sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", backgroundColor: "rgba(255, 255, 255, 0.92)" }}
      >
        <div className="landing-header-inner mx-auto w-full max-w-6xl px-4 py-4 md:px-8">
          <div className="landing-header-brand">
            <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              RCMS
            </div>
            <h1 className="text-base font-semibold">Rent Collection Management</h1>
          </div>
          <nav className="landing-header-nav" style={{ color: "var(--muted)" }}>
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
          <div className="landing-header-actions">
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
        <section className="landing-hero-area mx-auto w-full max-w-6xl px-4 pb-10 pt-10 md:px-8 md:pb-14 md:pt-14">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="landing-hero-shell rounded-3xl border p-6 md:p-10">
              <div className="mb-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "rgba(59, 130, 246, 0.3)", color: "var(--accent-strong)", backgroundColor: "rgba(59, 130, 246, 0.08)" }}>
                Rent operations workspace
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Operations Platform
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
                Rent collection, simplified for every property team.
              </h2>
              <p className="mt-4 max-w-xl text-base" style={{ color: "var(--muted)" }}>
                Track houses, tenants, payments, and expenses in one clean workspace — with clear arrears and export-ready reporting.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/signup" className="landing-btn-primary text-sm">
                  Start Free Trial
                </Link>
                <Link to="/login" className="landing-btn-secondary text-sm">
                  Login to RCMS
                </Link>
                <a href="#pricing" className="landing-btn-ghost text-sm">
                  See Pricing
                </a>
              </div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                No credit card required
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

            <div className="landing-hero-preview">
              <div className="preview-card">
                <div className="preview-header">
                  <div>
                    <div className="label">Dashboard Summary</div>
                    <div className="value">March 2026</div>
                  </div>
                  <div className="pill">Live</div>
                </div>
                <div className="preview-cards">
                  <div className="preview-tile">
                    <div className="label">Occupancy</div>
                    <div className="value">0 occupied / 0 vacant</div>
                    <div className="meta">0 total houses as of 11/03/26</div>
                  </div>
                  <div className="preview-tile">
                    <div className="label">Rent Expected</div>
                    <div className="value">UGX 0</div>
                    <div className="meta">For Mar 2026</div>
                  </div>
                  <div className="preview-tile">
                    <div className="label">Rent Collected</div>
                    <div className="value">UGX 0</div>
                    <div className="meta">0 payment records</div>
                  </div>
                  <div className="preview-tile">
                    <div className="label">Outstanding Arrears</div>
                    <div className="value">UGX 0</div>
                    <div className="meta">Active tenants only</div>
                  </div>
                </div>
                <div className="preview-footer">
                  <span>Plan usage visible</span>
                  <span>Exports ready</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8 md:pb-14">
          <div className="grid gap-5 md:grid-cols-2">
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
          <div className="landing-pricing-header">
            <h3 className="text-2xl font-semibold">Pricing</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Compare houses, tenants, and exports across plans. Pay monthly, 6 months, or yearly.
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {pricingSource === "catalog"
                ? "Pricing is loaded from the live plan catalog."
                : "Plan catalog is not reachable yet. Showing fallback package cards."}
            </p>
            <div className="landing-pricing-toggle">
              {[
                { id: "monthly" as const, label: "Monthly" },
                { id: "six_months" as const, label: "6 months" },
                { id: "annual" as const, label: "Annual" },
              ].map((term) => (
                <button
                  key={term.id}
                  type="button"
                  onClick={() => setBillingTerm(term.id)}
                  className={[
                    "landing-pricing-pill",
                    billingTerm === term.id ? "is-active" : "",
                  ].join(" ")}
                >
                  <span className="label">{term.label}</span>
                  {term.id !== "monthly" ? (
                    <span className="badge">
                      -{term.id === "six_months" ? 10 : 20}%
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="landing-pricing-row">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={[
                  "landing-plan-card",
                  plan.highlighted ? "is-highlighted" : "",
                  plan.isTrial ? "is-trial" : "",
                ].join(" ")}
                style={{
                  borderColor: plan.highlighted ? "var(--accent)" : "var(--border)",
                  backgroundColor: "var(--surface)",
                  boxShadow: plan.highlighted ? "0 14px 34px rgba(59, 130, 246, 0.12)" : undefined,
                }}
              >
                {plan.terms[billingTerm]?.savingsPercent ? (
                  <span
                    className="landing-discount-chip"
                    style={{
                      borderColor: "rgba(16, 185, 129, 0.4)",
                      backgroundColor: "rgba(16, 185, 129, 0.12)",
                      color: "#047857",
                    }}
                  >
                    Save {plan.terms[billingTerm].savingsPercent}%
                  </span>
                ) : null}
                <div className="landing-plan-head">
                  <div>
                    <h4 className="plan-name">{plan.name}</h4>
                    <p className="plan-price">{plan.terms[billingTerm].display}</p>
                    {plan.terms[billingTerm].billingNote ? (
                      <p className="plan-billing-note">{plan.terms[billingTerm].billingNote}</p>
                    ) : null}
                    {plan.isTrial && plan.trialDays ? (
                      <p className="plan-trial-note">Free for {plan.trialDays} days</p>
                    ) : null}
                  </div>
                  {plan.highlighted ? (
                    <span className="plan-popular">Popular</span>
                  ) : null}
                </div>
                <p className="plan-description">{plan.description}</p>
                <div className="plan-limits-inline">
                  <span className="plan-limit-chip">Houses: {plan.limits.houses}</span>
                  <span className="plan-limit-chip">Tenants: {plan.limits.tenants}</span>
                  <span className="plan-limit-chip">Exports: {plan.limits.exports}</span>
                </div>
                <div className="landing-plan-cta mt-5">
                  {plan.isEnterprise ? (
                    <a
                      href={plan.contactUrl || "/login"}
                      className="landing-btn-primary inline-flex text-sm"
                    >
                      {plan.cta}
                    </a>
                  ) : (
                    <Link to="/signup" className="landing-btn-primary inline-flex text-sm">
                      {plan.cta}
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
          <details className="landing-plan-details">
            <summary>What&apos;s included in every plan</summary>
            <ul>
              {defaultPlanPoints.map((point) => (
                <li key={point}>
                  <span className="dot" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </details>
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
                Create your workspace and start with a {trialLabel.toLowerCase()} trial.
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                No credit card required
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
