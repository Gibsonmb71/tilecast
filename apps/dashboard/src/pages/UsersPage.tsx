import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, UserRoundX } from "lucide-react";
import type { User } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

type UserRole = User["role"];
type UserInput = {
  name: string;
  username: string;
  role: UserRole;
  active?: boolean;
  password?: string;
};
type ErrorResponse = { error?: { message?: string } };

async function userRequest<T>(path: string, csrfToken: string, init?: RequestInit) {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(body.error?.message ?? "Tilecast could not update this account.");
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as { data: T }).data;
}

function listUsers() {
  return userRequest<{ items: User[]; total: number }>("/users", "");
}

const roleLabels: Record<UserRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  editor: "Editor",
  viewer: "Viewer",
};

export function UsersPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";
  const currentUser = auth.status?.user;
  const canManage = ["owner", "administrator"].includes(currentUser?.role ?? "");
  const isOwner = currentUser?.role === "owner";
  const users = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: canManage,
  });
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const create = useMutation({
    mutationFn: (input: UserInput) =>
      userRequest<User>("/users", csrf, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      setName("");
      setUsername("");
      setPassword("");
      setRole("viewer");
      await client.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (!canManage) {
    return (
      <div className="notice notice--error">
        Owner or Administrator access is required to manage Studio users.
      </div>
    );
  }

  const allowedRoles: UserRole[] = isOwner
    ? ["owner", "administrator", "editor", "viewer"]
    : ["editor", "viewer"];

  return (
    <section className="user-management">
      <header className="user-management__header">
        <h2>Studio users</h2>
        <p>
          Give each person an individual sign-in and assign only the permissions
          they need. Appearance and density preferences remain separate for every
          account.
        </p>
      </header>

      <section className="user-management__form" aria-labelledby="add-user-title">
        <h3 id="add-user-title">Add a user</h3>
        <p>Passwords must contain at least 12 characters.</p>
        <div className="user-management__fields">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Username
            <input
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Temporary password
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {allowedRoles.map((value) => (
                <option key={value} value={value}>
                  {roleLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={
              create.isPending ||
              name.trim().length < 2 ||
              username.trim().length < 3 ||
              password.length < 12
            }
            onClick={() =>
              create.mutate({
                name: name.trim(),
                username: username.trim(),
                password,
                role,
              })
            }
          >
            <Plus size={16} /> {create.isPending ? "Adding…" : "Add user"}
          </button>
        </div>
        {create.error && (
          <div className="notice notice--error" role="alert">
            {create.error.message}
          </div>
        )}
      </section>

      {users.isLoading ? (
        <div className="table-loading">Loading users…</div>
      ) : users.error ? (
        <div className="notice notice--error" role="alert">
          {users.error.message}
        </div>
      ) : (
        <div className="user-management__list">
          {users.data?.items.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              currentUser={currentUser!}
              allowedRoles={
                isOwner || user.role === "editor" || user.role === "viewer"
                  ? allowedRoles
                  : [user.role]
              }
              csrf={csrf}
              onChanged={() => client.invalidateQueries({ queryKey: ["users"] })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UserRow({
  user,
  currentUser,
  allowedRoles,
  csrf,
  onChanged,
}: {
  user: User;
  currentUser: User;
  allowedRoles: UserRole[];
  csrf: string;
  onChanged: () => Promise<unknown>;
}) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<UserRole>(user.role);
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState("");
  useEffect(() => {
    setName(user.name);
    setUsername(user.username);
    setRole(user.role);
    setActive(user.active);
    setPassword("");
  }, [user]);
  const update = useMutation({
    mutationFn: () =>
      userRequest<User>(`/users/${user.id}`, csrf, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          role,
          active,
          ...(password ? { password } : {}),
        }),
      }),
    onSuccess: async () => {
      setPassword("");
      await onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      userRequest<void>(`/users/${user.id}`, csrf, { method: "DELETE" }),
    onSuccess: onChanged,
  });
  const isSelf = user.id === currentUser.id;
  const canEdit =
    currentUser.role === "owner" ||
    (currentUser.role === "administrator" &&
      ["editor", "viewer"].includes(user.role));

  return (
    <article className="user-row">
      <div className="user-row__identity">
        <strong>{user.name}</strong>
        <span>{user.username}</span>
        <small>
          {roleLabels[user.role]} · {user.active ? "Active" : "Inactive"}
          {user.lastLoginAt
            ? ` · Last signed in ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.lastLoginAt))}`
            : " · Never signed in"}
        </small>
      </div>
      <div className="user-row__editor">
        <label>
          Name
          <input
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Username
          <input
            value={username}
            disabled={!canEdit}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Role
          <select
            value={role}
            disabled={!canEdit}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {allowedRoles.map((value) => (
              <option key={value} value={value}>
                {roleLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          New password
          <input
            type="password"
            value={password}
            disabled={!canEdit}
            placeholder="Leave unchanged"
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="user-row__active">
          <input
            type="checkbox"
            checked={active}
            disabled={!canEdit || isSelf}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
      </div>
      <div className="user-row__actions">
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={
            !canEdit ||
            update.isPending ||
            name.trim().length < 2 ||
            username.trim().length < 3 ||
            (password.length > 0 && password.length < 12)
          }
          onClick={() => update.mutate()}
        >
          <Save size={15} /> {update.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="button button--danger-quiet button--compact"
          disabled={!canEdit || isSelf || remove.isPending || !user.active}
          onClick={() => {
            if (confirm(`Deactivate ${user.name}?`)) remove.mutate();
          }}
        >
          <UserRoundX size={15} /> Deactivate
        </button>
      </div>
      {(update.error || remove.error) && (
        <div className="notice notice--error" role="alert">
          {(update.error ?? remove.error)?.message}
        </div>
      )}
    </article>
  );
}
