import { Button, PageHeader, Select } from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { PlayerPolicyEditor } from "../settings/PlayerPolicyEditor";
const canManage = (role?: string) =>
  role === "owner" || role === "administrator";
export function GroupsPage() {
  const auth = useAuth(),
    csrf = auth.status?.csrfToken ?? "",
    client = useQueryClient();
  const q = useQuery({
    queryKey: ["screen-groups"],
    queryFn: () => api.screenGroups(),
  });
  const create = useMutation({
    mutationFn: (name: string) =>
      api.createScreenGroup({ name, description: "" }, csrf),
    onSuccess: () => client.invalidateQueries({ queryKey: ["screen-groups"] }),
  });
  return (
    <section>
      <PageHeader
        title="Sync groups"
        description="Keep a set of screens on the same content, schedule, and playback position."
        actions={
          canManage(auth.status?.user?.role) ? (
            <Button
              variant="primary"
              onClick={() => {
                const name = prompt("Group name");
                if (name) create.mutate(name);
              }}
            >
              Create sync group
            </Button>
          ) : undefined
        }
      />
      <nav className="screen-primary-tabs" aria-label="Screen management">
        <Link to="/screens">Screens</Link>
        <Link to="/groups" aria-current="page">
          Sync groups
        </Link>
      </nav>
      <div className="schedule-list">
        {q.data?.items?.map((g) => (
          <Link className="schedule-card" to={`/groups/${g.id}`} key={g.id}>
            <strong>{g.name}</strong>
            <span>
              {g.membershipCount} screen{g.membershipCount === 1 ? "" : "s"}
            </span>
            <small>{g.description || "No description"}</small>
          </Link>
        ))}
        {q.data?.items?.length === 0 && (
          <div className="screen-empty">
            <h3>No sync groups yet</h3>
            <p>Group screens that should always play in sync.</p>
          </div>
        )}
      </div>
    </section>
  );
}
export function GroupDetailPage() {
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    auth = useAuth(),
    csrf = auth.status?.csrfToken ?? "",
    client = useQueryClient();
  const [screenSearch, setScreenSearch] = useState("");
  const [selectedPresentation, setSelectedPresentation] = useState("");
  const group = useQuery({
      queryKey: ["screen-groups", id],
      queryFn: () => api.screenGroup(id),
    }),
    screens = useQuery({ queryKey: ["screens"], queryFn: api.screens }),
    groups = useQuery({
      queryKey: ["screen-groups"],
      queryFn: () => api.screenGroups(),
    }),
    playlists = useQuery({
      queryKey: ["playlists", "sync-group"],
      queryFn: () => api.playlists(),
    }),
    layouts = useQuery({
      queryKey: ["layouts", "sync-group"],
      queryFn: () => api.layouts(""),
    });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["screen-groups", id] });
  const add = useMutation({
      mutationFn: (screenId: string) =>
        api.addScreenToGroup(id, screenId, csrf),
      onSuccess: refresh,
    }),
    remove = useMutation({
      mutationFn: (screenId: string) =>
        api.removeScreenFromGroup(id, screenId, csrf),
      onSuccess: refresh,
    }),
    update = useMutation({
      mutationFn: (value: { name: string; description: string }) =>
        api.updateScreenGroup(id, value, csrf),
      onSuccess: refresh,
    }),
    deleteGroup = useMutation({
      mutationFn: () => api.deleteScreenGroup(id, csrf),
      onSuccess: () => navigate("/groups"),
    }),
    assignContent = useMutation({
      mutationFn: (value: string) => {
        const [type, presentationId] = value.split(":");
        if (type === "layout" && presentationId)
          return api.assignSyncGroupLayout(id, presentationId, csrf);
        if (type === "playlist" && presentationId)
          return api.assignSyncGroupPlaylist(id, presentationId, csrf);
        return api.unassignSyncGroupPlaylist(id, csrf);
      },
      onSuccess: refresh,
    });
  useEffect(() => {
    setSelectedPresentation(
      group.data?.layoutId
        ? `layout:${group.data.layoutId}`
        : group.data?.playlistId
          ? `playlist:${group.data.playlistId}`
          : "",
    );
  }, [group.data?.layoutId, group.data?.playlistId]);
  if (!group.data) return <div className="table-loading">Loading group…</div>;
  const groupData = group.data;
  const assignedElsewhere = new Set(
    (groups.data?.items ?? [])
      .filter((candidate) => candidate.id !== id)
      .flatMap((candidate) =>
        (candidate.screens ?? []).map((screen) => screen.id),
      ),
  );
  const available =
    (screens.data?.items ?? [])
      .filter((s) => !(groupData.screens ?? []).some((m) => m.id === s.id))
      .filter((s) => !assignedElsewhere.has(s.id))
      .filter((s) =>
        `${s.name} ${s.location}`
          .toLowerCase()
          .includes(screenSearch.toLowerCase()),
      ) ?? [];
  return (
    <section>
      <PageHeader
        title={groupData.name}
        description={groupData.description || "No description"}
        actions={
          canManage(auth.status?.user?.role) ? (
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  const name = prompt("Group name", groupData.name);
                  if (name)
                    update.mutate({
                      name,
                      description:
                        prompt("Description", groupData.description) ??
                        groupData.description,
                    });
                }}
              >
                Edit sync group
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${groupData.name}? Screens will not be deleted.`,
                    )
                  )
                    deleteGroup.mutate();
                }}
              >
                Delete sync group
              </Button>
            </>
          ) : undefined
        }
      />
      <section className="detail-card assignment-card">
        <h3>Synchronized content</h3>
        <p>
          Every screen in this sync group uses this fallback content and the
          group&apos;s schedules.
        </p>
        {canManage(auth.status?.user?.role) ? (
          <div className="assignment-controls">
            <Select
              aria-label="Sync group content"
              value={selectedPresentation}
              onChange={(event) => setSelectedPresentation(event.target.value)}
            >
              <option value="">No fallback presentation</option>
              <optgroup label="Playlists">
                {playlists.data?.items?.map((playlist) => (
                  <option key={playlist.id} value={`playlist:${playlist.id}`}>
                    {playlist.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Published Layouts">
                {layouts.data?.items
                  .filter((layout) => layout.publishedRevision)
                  .map((layout) => (
                    <option key={layout.id} value={`layout:${layout.id}`}>
                      {layout.name}
                    </option>
                  ))}
              </optgroup>
            </Select>
            <button
              className="button button--primary"
              disabled={
                assignContent.isPending ||
                selectedPresentation ===
                  (groupData.layoutId
                    ? `layout:${groupData.layoutId}`
                    : groupData.playlistId
                      ? `playlist:${groupData.playlistId}`
                      : "")
              }
              onClick={() => assignContent.mutate(selectedPresentation)}
            >
              {assignContent.isPending ? "Applying…" : "Apply to sync group"}
            </button>
          </div>
        ) : (
          <strong>
            {groupData.layoutName ??
              groupData.playlistName ??
              "No fallback presentation"}
          </strong>
        )}
      </section>
      {canManage(auth.status?.user?.role) && (
        <label className="form-field">
          <span>Add ungrouped screen</span>
          <input
            type="search"
            placeholder="Search screens"
            value={screenSearch}
            onChange={(e) => setScreenSearch(e.target.value)}
          />
          {/* This label already names the search input beside it — a label names only its first
              labelable descendant — so the select states its own name. */}
          <Select
            aria-label="Add ungrouped screen"
            value=""
            onChange={(e) => add.mutate(e.target.value)}
          >
            <option value="">Choose a screen…</option>
            {available.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="schedule-list">
        {(groupData.screens ?? []).map((s) => (
          <div className="schedule-card" key={s.id}>
            <strong>{s.name}</strong>
            <span>{s.location || "No location"}</span>
            {canManage(auth.status?.user?.role) && (
              <button
                className="button button--quiet"
                onClick={() => remove.mutate(s.id)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <PlayerPolicyEditor target="group" id={id} />
    </section>
  );
}
export function SchedulesPage() {
  const auth = useAuth();
  const q = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules(),
  });
  return (
    <section>
      <PageHeader
        title="Schedules"
        description="Higher priority wins. Screens in a sync group always share the same schedule and fallback content."
        actions={
          canManage(auth.status?.user?.role) ? (
            <Link className="button button--primary" to="/schedules/new">
              Create schedule
            </Link>
          ) : undefined
        }
      />
      <div className="schedule-today">
        <h3>Schedule timeline</h3>
        <p>
          {(q.data?.items ?? []).filter((s) => s.enabled).length} enabled ·
          times evaluate in each schedule’s IANA timezone · overnight windows
          continue into the next day
        </p>
      </div>
      <div className="schedule-list">
        {q.data?.items?.map((s) => (
          <Link
            className={`schedule-card ${s.enabled ? "" : "schedule-card--disabled"}`}
            to={`/schedules/${s.id}`}
            key={s.id}
          >
            <span>
              <strong>{s.name}</strong>
              <small>{s.enabled ? "Enabled" : "Disabled"}</small>
            </span>
            <span>{s.playlistName}</span>
            <span>{s.targets.map((t) => t.name).join(", ")}</span>
            <span>
              {s.type === "weekly"
                ? `${s.dailyStart}–${s.dailyEnd} · ${s.timezone}`
                : `${new Date(s.oneTimeStart!).toLocaleString()}–${new Date(s.oneTimeEnd!).toLocaleString()}`}
            </span>
            <b>Priority {s.priority}</b>
          </Link>
        ))}
        {q.data?.items?.length === 0 && (
          <div className="screen-empty">
            <h3>No schedules yet</h3>
            <p>
              Direct screen assignments will continue to play until a schedule
              is created.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
export { ScheduleEditorPage } from "../schedules/ScheduleBuilder";
