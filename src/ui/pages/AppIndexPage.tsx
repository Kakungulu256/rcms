import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { isPlatformOwnerUser } from "../../lib/platformOwner";
import DashboardPage from "./DashboardPage";

export default function AppIndexPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading dashboard...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (isPlatformOwnerUser({ id: user.id, email: user.email })) {
    return <Navigate to="/app/platform" replace />;
  }

  if (!user.hasWorkspace) {
    return <Navigate to="/signup" replace />;
  }

  return <DashboardPage />;
}
