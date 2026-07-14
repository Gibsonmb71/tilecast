import { Navigate, Route, Routes } from "react-router";
import { AuthPage } from "./pages/AuthPage";
import { DashboardShell, FoundationPage, PlannedPage } from "./pages/Dashboard";
import {
  PairScreenPage,
  ScreensPage,
} from "./pages/ScreensPage";
import { ScreenDetailWithPreviewPage } from "./pages/ScreenDetailWithPreviewPage";
import { ContentPage } from "./pages/ContentPage";
import { PlaylistEditorPage, PlaylistsPage } from "./pages/PlaylistsPage";
import {
  GroupsPage,
  GroupDetailPage,
  SchedulesPage,
  ScheduleEditorPage,
} from "./pages/SchedulesPage";
import { SettingsPage } from "./pages/SettingsPage";

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
        <Route path="screens/:id" element={<ScreenDetailWithPreviewPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/:id" element={<GroupDetailPage />} />
        <Route path="content" element={<ContentPage />} />
        <Route path="playlists" element={<PlaylistsPage />} />
        <Route path="playlists/:id" element={<PlaylistEditorPage />} />
        <Route
          path="layouts"
          element={<PlannedPage feature="Layouts" milestone={5} />}
        />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="schedules/new" element={<ScheduleEditorPage />} />
        <Route path="schedules/:id" element={<ScheduleEditorPage />} />
        <Route
          path="activity"
          element={<PlannedPage feature="Activity reports" milestone={9} />}
        />
        <Route path="settings/*" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
