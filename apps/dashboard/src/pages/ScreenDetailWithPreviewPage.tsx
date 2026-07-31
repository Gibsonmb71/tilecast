import { Navigate, useParams, useSearchParams } from "react-router";
import { LivePreviewPanel } from "../components/LivePreviewPanel";
import { SnapshotHistoryPanel } from "../components/SnapshotHistoryPanel";
import { ScreenActivityPanel } from "../components/ScreenActivityPanel";
import { ScreenDetailPage, normalizeScreenDetailTab } from "./ScreensPage";

export function ScreenDetailWithPreviewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  if (!id) return <Navigate to="/screens" replace />;

  const tab = normalizeScreenDetailTab(searchParams.get("tab"));
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
      {tab === "snapshots" && (
        <section
          className="snapshot-history-card"
          aria-labelledby="snapshot-history-title"
        >
          <header>
            <h3 id="snapshot-history-title">Snapshot history</h3>
            <p>Previously captured frames reported by this player.</p>
          </header>
          <SnapshotHistoryPanel screenId={id} />
        </section>
      )}
      {tab === "activity" && <ScreenActivityPanel screenId={id} />}
    </>
  );
}
