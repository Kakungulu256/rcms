import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type RequireFeatureProps = {
  featureKey: string;
  children: React.ReactNode;
};

export default function RequireFeature({ featureKey, children }: RequireFeatureProps) {
  const { loading, canAccessFeature } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading feature access...
      </div>
    );
  }

  const decision = canAccessFeature(featureKey);
  if (!decision.allowed) {
    return (
      <Navigate
        to="/app/billing"
        replace
        state={{
          message: decision.reason ?? "This feature is locked on your plan.",
          featureKey,
        }}
      />
    );
  }

  return <>{children}</>;
}
