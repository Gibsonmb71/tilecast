import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
      <header className="page-heading">
        <div>
          <h2>Screen groups</h2>
          <p>
            Target schedules to reusable sets of screens. A screen may belong to
            multiple groups.
          </p>
        </div>
        {canManage(auth.status?.user?.role) && (
          <button
            className="button button--primary"
            onClick={() => {
              const n = prompt("Group name");
              if (n) create.mutate(n);
            }}
          >
            Create group
          </button>
        )}
      </header>
      <div className="schedule-list">
        {q.data?.items.map((g) => (
          <Link className="schedule-card" to={`/groups/${g.id}`} key={g.id}>
            <strong>{g.name}</strong>
            <span>
              {g.membershipCount} screen{g.membershipCount === 1 ? "" : "s"}
            </span>
            <small>{g.description || "No description"}</small>
          </Link>
        ))}
        {q.data?.items.length === 0 && (
          <div className="screen-empty">
            <h3>No groups yet</h3>
            <p>Create a group to schedule several screens together.</p>
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
  const group = useQuery({
      queryKey: ["screen-groups", id],
      queryFn: () => api.screenGroup(id),
    }),
    screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
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
    });
  if (!group.data) return <div className="table-loading">Loading group…</div>;
  const groupData = group.data;
  const available =
    screens.data?.items
      .filter((s) => !groupData.screens.some((m) => m.id === s.id))
      .filter((s) =>
        `${s.name} ${s.location}`
          .toLowerCase()
          .includes(screenSearch.toLowerCase()),
      ) ?? [];
  return (
    <section>
      <header className="page-heading">
        <div>
          <Link to="/groups">← Groups</Link>
          <h2>{groupData.name}</h2>
          <p>{groupData.description || "No description"}</p>
        </div>
        {canManage(auth.status?.user?.role) && (
          <span className="heading-actions">
            <button
              className="button button--quiet"
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
              Edit group
            </button>
            <button
              className="button button--danger-quiet"
              onClick={() => {
                if (
                  confirm(
                    `Delete ${groupData.name}? Screens will not be deleted.`,
                  )
                )
                  deleteGroup.mutate();
              }}
            >
              Delete group
            </button>
          </span>
        )}
      </header>
      {canManage(auth.status?.user?.role) && (
        <label className="form-field">
          <span>Add screen</span>
          <input
            type="search"
            placeholder="Search screens"
            value={screenSearch}
            onChange={(e) => setScreenSearch(e.target.value)}
          />
          <select value="" onChange={(e) => add.mutate(e.target.value)}>
            <option value="">Choose a screen…</option>
            {available.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="schedule-list">
        {groupData.screens.map((s) => (
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
      <header className="page-heading">
        <div>
          <h2>Schedules</h2>
          <p>
            Higher priority wins; direct screen targets beat groups at equal
            priority. Direct assignments remain fallback content.
          </p>
        </div>
        {canManage(auth.status?.user?.role) && (
          <Link className="button button--primary" to="/schedules/new">
            Create schedule
          </Link>
        )}
      </header>
      <div className="schedule-today">
        <h3>Schedule timeline</h3>
        <p>
          {q.data?.items.filter((s) => s.enabled).length ?? 0} enabled · times
          evaluate in each schedule’s IANA timezone · overnight windows continue
          into the next day
        </p>
      </div>
      <div className="schedule-list">
        {q.data?.items.map((s) => (
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
        {q.data?.items.length === 0 && (
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
