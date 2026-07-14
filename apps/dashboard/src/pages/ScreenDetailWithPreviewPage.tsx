import { Navigate, useParams, useSearchParams } from "react-router";
import { FireTvAccessibilityAdbPanel } from "../components/FireTvAccessibilityAdbPanel";
import { LivePreviewPanel } from "../components/LivePreviewPanel";
import { ScreenDetailPage } from "./ScreensPage";

export function ScreenDetailWithPreviewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  if (!id) return <Navigate to="/screens" replace />;

  const tab = searchParams.get("tab") ?? "overview";
  if (tab === "overview") {
    return (
      <div className="screen-detail-preview-layout">
        <div className="screen-detail-preview-layout__detail">
          <ScreenDetailPage />
        </div>
        <LivePreviewPanel screenId={id} />
      </div>
    );
  }

  return (
    <>
      <ScreenDetailPage />
      {tab === "reliability" && (
        <FireTvAccessibilityAdbPanel screenId={id} />
      )}
    </>
  );
}
