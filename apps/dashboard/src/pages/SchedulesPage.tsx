import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type { ScheduleInput } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { PlayerPolicyEditor } from "./SettingsPage";
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
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function ScheduleEditorPage() {
  const { id } = useParams(),
    navigate = useNavigate(),
    auth = useAuth(),
    csrf = auth.status?.csrfToken ?? "";
  const existing = useQuery({
    queryKey: ["schedules", id],
    queryFn: () => api.schedule(id!),
    enabled: !!id,
  });
  const playlists = useQuery({
    queryKey: ["playlists", "schedule"],
    queryFn: () => api.playlists(),
  });
  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const groups = useQuery({
    queryKey: ["screen-groups"],
    queryFn: () => api.screenGroups(),
  });
  const scheduleDefaults = useQuery({
    queryKey: ["schedules", "defaults"],
    queryFn: () => api.schedules(),
  });
  const [input, setInput] = useState<ScheduleInput>({
    name: "",
    description: "",
    playlistId: "",
    type: "weekly",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    priority: 0,
    enabled: true,
    dailyStart: "09:00",
    dailyEnd: "17:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    targets: [],
  });
  useEffect(() => {
    if (existing.data) {
      const schedule = existing.data;
      setInput({
        name: schedule.name,
        description: schedule.description,
        playlistId: schedule.playlistId,
        type: schedule.type,
        timezone: schedule.timezone,
        priority: schedule.priority,
        enabled: schedule.enabled,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        oneTimeStart: schedule.oneTimeStart,
        oneTimeEnd: schedule.oneTimeEnd,
        dailyStart: schedule.dailyStart,
        dailyEnd: schedule.dailyEnd,
        daysOfWeek: schedule.daysOfWeek,
        targets: schedule.targets,
      });
    }
  }, [existing.data]);
  useEffect(() => {
    if (!id && scheduleDefaults.data?.defaultTimezone)
      setInput((value) => ({
        ...value,
        timezone: scheduleDefaults.data.defaultTimezone,
      }));
  }, [id, scheduleDefaults.data]);
  const dirty = useMemo(() => !!input.name, [input]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener("beforeunload", h);
    return () => removeEventListener("beforeunload", h);
  }, [dirty]);
  const save = useMutation({
    mutationFn: () =>
      id
        ? api.updateSchedule(id, input, csrf)
        : api.createSchedule(input, csrf),
    onSuccess: (s) => navigate(`/schedules/${s.id}`),
  });
  const removeSchedule = useMutation({
    mutationFn: () => api.deleteSchedule(id!, csrf),
    onSuccess: () => navigate("/schedules"),
  });
  const previewGroupId = input.targets.find(
    (target) => target.type === "group",
  )?.id;
  const previewGroup = useQuery({
    queryKey: ["screen-groups", previewGroupId, "preview"],
    queryFn: () => api.screenGroup(previewGroupId!),
    enabled: !!previewGroupId,
  });
  const previewScreenId =
    input.targets.find((target) => target.type === "screen")?.id ??
    previewGroup.data?.screens[0]?.id ??
    "";
  const preview = useQuery({
    queryKey: ["schedule-preview", input, previewScreenId],
    queryFn: () =>
      api.previewSchedule(previewScreenId, new Date().toISOString(), input),
    enabled:
      !!previewScreenId && !!input.playlistId && input.targets.length > 0,
  });
  const set = <K extends keyof ScheduleInput>(k: K, v: ScheduleInput[K]) =>
    setInput((x) => ({ ...x, [k]: v }));
  return (
    <section>
      <header className="page-heading">
        <div>
          <Link to="/schedules">← Schedules</Link>
          <h2>{id ? "Edit schedule" : "Create schedule"}</h2>
          <p>
            Intervals are active at their start and inactive at their exact end.
          </p>
        </div>
      </header>
      <form
        className="schedule-editor"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Name
          <input
            value={input.name}
            required
            maxLength={180}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label>
          Playlist
          <select
            value={input.playlistId}
            required
            onChange={(e) => set("playlistId", e.target.value)}
          >
            <option value="">Choose…</option>
            {playlists.data?.items.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select
            value={input.type}
            onChange={(e) =>
              set("type", e.target.value as ScheduleInput["type"])
            }
          >
            <option value="weekly">Weekly recurring</option>
            <option value="one_time">One-time</option>
          </select>
        </label>
        <label>
          Timezone
          <input
            value={input.timezone}
            required
            onChange={(e) => set("timezone", e.target.value)}
          />
        </label>
        <label>
          Priority
          <input
            type="number"
            min={-999}
            max={999}
            value={input.priority}
            onChange={(e) => set("priority", Number(e.target.value))}
          />
          <small>
            0 Normal · 100 Important · 500 Special event · 1000 reserved
          </small>
        </label>
        {input.type === "weekly" ? (
          <>
            <div className="weekday-picker">
              {weekdays.map((d, i) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={input.daysOfWeek.includes(i)}
                    onChange={(e) =>
                      set(
                        "daysOfWeek",
                        e.target.checked
                          ? [...input.daysOfWeek, i]
                          : input.daysOfWeek.filter((x) => x !== i),
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            <label>
              Daily start
              <input
                type="time"
                value={input.dailyStart}
                onChange={(e) => set("dailyStart", e.target.value)}
              />
            </label>
            <label>
              Daily end
              <input
                type="time"
                value={input.dailyEnd}
                onChange={(e) => set("dailyEnd", e.target.value)}
              />
              {input.dailyEnd! <= input.dailyStart! && (
                <small>Overnight — ends the following day</small>
              )}
            </label>
            <label>
              Start date (optional)
              <input
                type="date"
                value={input.startDate ?? ""}
                onChange={(e) => set("startDate", e.target.value || undefined)}
              />
            </label>
            <label>
              End date (optional)
              <input
                type="date"
                value={input.endDate ?? ""}
                onChange={(e) => set("endDate", e.target.value || undefined)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Start
              <input
                type="datetime-local"
                value={
                  input.oneTimeStart
                    ? new Date(
                        new Date(input.oneTimeStart).getTime() -
                          new Date(input.oneTimeStart).getTimezoneOffset() *
                            60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  set("oneTimeStart", new Date(e.target.value).toISOString())
                }
              />
            </label>
            <label>
              End
              <input
                type="datetime-local"
                value={
                  input.oneTimeEnd
                    ? new Date(
                        new Date(input.oneTimeEnd).getTime() -
                          new Date(input.oneTimeEnd).getTimezoneOffset() *
                            60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  set("oneTimeEnd", new Date(e.target.value).toISOString())
                }
              />
            </label>
          </>
        )}
        <fieldset>
          <legend>Targets</legend>
          {screens.data?.items.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={input.targets.some(
                  (t) => t.type === "screen" && t.id === s.id,
                )}
                onChange={(e) =>
                  set(
                    "targets",
                    e.target.checked
                      ? [
                          ...input.targets,
                          { type: "screen", id: s.id, name: s.name },
                        ]
                      : input.targets.filter(
                          (t) => !(t.type === "screen" && t.id === s.id),
                        ),
                  )
                }
              />
              {s.name} (screen)
            </label>
          ))}
          {groups.data?.items.map((g) => (
            <label key={g.id}>
              <input
                type="checkbox"
                checked={input.targets.some(
                  (t) => t.type === "group" && t.id === g.id,
                )}
                onChange={(e) =>
                  set(
                    "targets",
                    e.target.checked
                      ? [
                          ...input.targets,
                          { type: "group", id: g.id, name: g.name },
                        ]
                      : input.targets.filter(
                          (t) => !(t.type === "group" && t.id === g.id),
                        ),
                  )
                }
              />
              {g.name} (group)
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={input.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />{" "}
          Enabled
        </label>
        <div className="schedule-preview">
          <strong>Conflict preview</strong>
          {preview.data?.winningSchedule ? (
            <p>
              Winner now: {preview.data.winningSchedule.name} (
              {preview.data.winningSchedule.playlistName})
            </p>
          ) : (
            <p>No schedule active now; direct assignment is fallback.</p>
          )}
          {preview.data?.conflicts.map((c) => (
            <p className="notice notice--warning" key={c}>
              {c}
            </p>
          ))}
        </div>
        {save.error && (
          <div className="notice notice--error">{save.error.message}</div>
        )}
        <div>
          <button className="button button--primary" disabled={save.isPending}>
            Save schedule
          </button>{" "}
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              if (!dirty || confirm("Discard unsaved schedule changes?"))
                void navigate("/schedules");
            }}
          >
            Cancel
          </button>
          {id && (
            <button
              type="button"
              className="button button--danger-quiet"
              onClick={() => {
                if (confirm(`Delete ${input.name}?`)) removeSchedule.mutate();
              }}
            >
              Delete schedule
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
