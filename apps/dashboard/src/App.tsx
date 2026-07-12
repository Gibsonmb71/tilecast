import { Navigate, Route, Routes } from "react-router";
import { AuthPage } from "./pages/AuthPage";
import { DashboardShell, FoundationPage, PlannedPage } from "./pages/Dashboard";
import {
  PairScreenPage,
  ScreenDetailPage,
  ScreensPage,
} from "./pages/ScreensPage";
import { ContentPage } from "./pages/ContentPage";

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<AuthPage mode="setup" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route element={<DashboardShell />}>
        <Route index element={<FoundationPage />} />
        <Route path="screens" element={<ScreensPage />} />
        <Route path="screens/pair" element={<PairScreenPage />} />
        <Route path="screens/pair/:code" element={<PairScreenPage />} />
        <Route
          path="screens/pair/request/:requestId"
          element={<PairScreenPage />}
        />
        <Route path="screens/:id" element={<ScreenDetailPage />} />
        <Route path="content" element={<ContentPage />} />
        <Route
          path="playlists"
          element={<PlannedPage feature="Playlists" milestone={4} />}
        />
        <Route
          path="layouts"
          element={<PlannedPage feature="Layouts" milestone={5} />}
        />
        <Route
          path="schedules"
          element={<PlannedPage feature="Schedules" milestone={8} />}
        />
        <Route
          path="activity"
          element={<PlannedPage feature="Activity reports" milestone={9} />}
        />
        <Route
          path="settings"
          element={<PlannedPage feature="Settings" milestone={2} />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
