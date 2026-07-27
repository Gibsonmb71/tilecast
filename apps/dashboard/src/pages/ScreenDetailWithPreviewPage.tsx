import { Navigate, useParams, useSearchParams } from "react-router";
import { FireTvAccessibilityAdbPanel } from "../components/FireTvAccessibilityAdbPanel";
import { LivePreviewPanel } from "../components/LivePreviewPanel";
import { ScreenActivityPanel } from "../components/ScreenActivityPanel";
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
  // The detail page renders only the selected tab's panel, so each extra panel
  // simply follows it. No wrapper hides Overview any more.
  return (
    <>
      <ScreenDetailPage />
      {tab === "activity" && <ScreenActivityPanel screenId={id} />}
      {tab === "reliability" && <FireTvAccessibilityAdbPanel screenId={id} />}
    </>
  );
}
