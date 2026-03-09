import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type RequireBillingAccessProps = {
  children: React.ReactNode;
};

export default function RequireBillingAccess({ children }: RequireBillingAccessProps) {
  const { loading, billing } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading billing status...
      </div>
    );
  }

  if (billing?.accessState === "locked") {
    return (
      <Navigate
        to="/app/upgrade"
        replace
        state={{
          message:
            billing.bannerMessage ||
            "Billing is inactive. Upgrade or restore billing to continue.",
        }}
      />
    );
  }

  return <>{children}</>;
}
