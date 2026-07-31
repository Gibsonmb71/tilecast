import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ScreenScope } from "../api/types";

// No selection means the whole fleet. That is stated rather than implied,
// because an empty list of grants reads equally well as "nothing", and getting
// it backwards would look like a lockout.
export function ScreenScopeEditor({
  userId,
  userRole,
  csrf,
  disabled,
}: {
  userId: string;
  userRole: string;
  csrf: string;
  disabled?: boolean;
}) {
  const scopes = useQuery({
    queryKey: ["screen-scopes", userId],
    queryFn: () => api.userScreenScopes(userId),
    enabled: userRole !== "owner",
  });
  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: api.locations,
    enabled: userRole !== "owner",
  });
  const groups = useQuery({
    queryKey: ["screen-groups"],
    queryFn: () => api.screenGroups(),
    enabled: userRole !== "owner",
  });

  const [selected, setSelected] = useState<ScreenScope[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // A response without the array must not take the dialog down with it: this
    // editor is embedded in the account editor, which has its own work to do.
    if (scopes.data) setSelected(scopes.data.scopes ?? []);
  }, [scopes.data]);

  const save = useMutation({
    mutationFn: () => api.putUserScreenScopes(userId, selected, csrf),
    onSuccess: () => {
      setSaved(true);
      void scopes.refetch();
    },
  });

  if (userRole === "owner")
    return (
      <p className="role-description">
        Owner access applies to the entire fleet.
      </p>
    );

  const toggle = (scope: ScreenScope, on: boolean) => {
    setSaved(false);
    setSelected((current) =>
      on
        ? [...current, scope]
        : current.filter(
            (item) => !(item.type === scope.type && item.id === scope.id),
          ),
    );
  };
  const has = (type: string, id: string) =>
    selected.some((item) => item.type === type && item.id === id);

  return (
    <div className="screen-scope-editor">
      <p className="role-description">
        {selected.length === 0
          ? "This account can operate every screen. Select buildings or sync groups to narrow it."
          : `This account can operate screens in ${selected.length} selected ${selected.length === 1 ? "place" : "places"} only. It still sees the whole content library.`}
      </p>

      {scopes.isLoading ? (
        <div className="table-loading">Loading scope…</div>
      ) : (
        <>
          <fieldset className="setting-control--checks">
            <legend className="field__label">Locations</legend>
            {!locations.data?.items?.length ? (
              <span className="setting-dependency">No locations exist.</span>
            ) : (
              locations.data.items.map((location) => (
                <label className="check-option" key={location.id}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={has("location", location.id)}
                    onChange={(event) =>
                      toggle(
                        { type: "location", id: location.id },
                        event.target.checked,
                      )
                    }
                  />
                  {location.name}
                </label>
              ))
            )}
          </fieldset>

          <fieldset className="setting-control--checks">
            <legend className="field__label">Sync groups</legend>
            {!groups.data?.items?.length ? (
              <span className="setting-dependency">No sync groups exist.</span>
            ) : (
              groups.data.items.map((group) => (
                <label className="check-option" key={group.id}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={has("group", group.id)}
                    onChange={(event) =>
                      toggle(
                        { type: "group", id: group.id },
                        event.target.checked,
                      )
                    }
                  />
                  {group.name}
                </label>
              ))
            )}
          </fieldset>

          <div className="settings-subsection__action">
            <div>{saved && <span>Screen scope saved.</span>}</div>
            <button
              className="button"
              type="button"
              disabled={disabled || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save screen scope"}
            </button>
          </div>
          {save.error && (
            <div className="notice notice--error" role="alert">
              {save.error.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
