import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { isPlatformOwnerUser } from "../lib/platformOwner";

export default function RequirePlatformOwner({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading platform access...
      </div>
    );
  }

  if (!user || !isPlatformOwnerUser({ id: user.id, email: user.email })) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
