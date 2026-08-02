import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";

export type ScreenManagementTab = "screens" | "groups" | "bulk";

/* Screens, Display Groups, and Bulk changes are peers, but each page used to
   build its own strip: Screens listed all three, Display Groups listed two, and
   Bulk changes listed none. Landing on Bulk changes therefore dropped the strip
   entirely and left the breadcrumb as the only way back. One component keeps the
   three in step and marks the current page instead of hiding its tab. */
export function ScreenManagementTabs({
  current,
  className = "",
}: {
  current: ScreenManagementTab;
  className?: string;
}) {
  const auth = useAuth();
  const role = auth.status?.user?.role;
  const canManage = role === "owner" || role === "administrator";

  return (
    <nav
      className={`view-tabs ${className}`.trim()}
      aria-label="Screen management"
    >
      <Link
        to="/screens"
        aria-current={current === "screens" ? "page" : undefined}
      >
        Screens
      </Link>
      <Link
        to="/groups"
        aria-current={current === "groups" ? "page" : undefined}
      >
        Display Groups
      </Link>
      {canManage && (
        <Link
          to="/screens/bulk"
          aria-current={current === "bulk" ? "page" : undefined}
        >
          Bulk changes
        </Link>
      )}
    </nav>
  );
}
