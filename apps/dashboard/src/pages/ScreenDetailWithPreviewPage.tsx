import { Navigate, useParams, useSearchParams } from "react-router";
import { LivePreviewPanel } from "../components/LivePreviewPanel";
import { ScreenDetailPage } from "./ScreensPage";

export function ScreenDetailWithPreviewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  if (!id) return <Navigate to="/screens" replace />;

  const isOverview = (searchParams.get("tab") ?? "overview") === "overview";
  if (!isOverview) return <ScreenDetailPage />;

  return (
    <div className="screen-detail-preview-layout">
      <div className="screen-detail-preview-layout__detail">
        <ScreenDetailPage />
      </div>
      <LivePreviewPanel screenId={id} />
    </div>
  );
}
