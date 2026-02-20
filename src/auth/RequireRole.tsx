import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { AppRole } from "./rbac";

type Props = {
  allow: AppRole[];
  children: React.ReactNode;
};

export default function RequireRole({ allow, children }: Props) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading access...
      </div>
    );
  }

  if (!user || !role || !allow.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

