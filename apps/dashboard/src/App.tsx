import { Navigate, Route, Routes } from "react-router";
import { AssetFilterPortal } from "./components/AssetFilterPortal";
import { GitHubOAuthSetupPortal } from "./components/GitHubOAuthSetupPortal";
import { AuthPage } from "./pages/AuthPage";
import { DashboardShell, FoundationPage } from "./pages/Dashboard";
import { PairScreenPage, ScreensPage } from "./pages/ScreensPage";
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
import { LayoutsPage } from "./pages/LayoutsPage";
import { LayoutEditorPage } from "./pages/LayoutEditorPage";
import { AppEditorPage, AppsPage } from "./pages/AppsPage";
import { UsersPage } from "./pages/UsersPage";
import { ActivityPage } from "./pages/ActivityPage";

export function App() {
  return (
    <>
      <AssetFilterPortal />
      <GitHubOAuthSetupPortal />
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
          <Route path="assets" element={<ContentPage />} />
          <Route path="content" element={<Navigate to="/assets" replace />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/new" element={<AppEditorPage />} />
          <Route path="apps/new/:provider" element={<AppEditorPage />} />
          <Route path="apps/:id" element={<AppEditorPage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="playlists/:id" element={<PlaylistEditorPage />} />
          <Route path="layouts" element={<LayoutsPage />} />
          <Route path="layouts/:id" element={<LayoutEditorPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="schedules/new" element={<ScheduleEditorPage />} />
          <Route path="schedules/:id" element={<ScheduleEditorPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings/*" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
