import { Navigate, useParams } from "react-router";
import { LivePreviewPanel } from "../components/LivePreviewPanel";
import { ScreenDetailPage } from "./ScreensPage";

export function ScreenDetailWithPreviewPage() {
  const { id } = useParams();
  if (!id) return <Navigate to="/screens" replace />;
  return (
    <div className="screen-detail-preview-layout">
      <div className="screen-detail-preview-layout__detail">
        <ScreenDetailPage />
      </div>
      <LivePreviewPanel screenId={id} />
    </div>
  );
}
