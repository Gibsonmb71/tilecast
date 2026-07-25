// UsedByPanel renders the reverse-dependency edges of one record as links.
//
// The relationships already existed in the database and were already returned by the API, but
// Studio rendered them as plain text, so a user could see that "Today's Lunch" consumed a Data
// Source and still had no way to reach it. Every record type now reports the same panel, which is
// what lets someone trace lunch.csv -> Today's Lunch -> Cafeteria Layout -> Cafeteria TV, and walk
// back the other way when asking why a screen looks stale.
import { ChevronDown, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

export type UsedByGroup = {
  // Plural noun for the group, e.g. "Widgets". Rendered as the group heading.
  label: string;
  items: { id: string; name: string; hint?: string }[];
  // Path builder for an item, e.g. (id) => `/widgets/${id}`. Omit for entries that are not
  // separately addressable.
  to?: (id: string) => string;
};

function count(groups: UsedByGroup[]) {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

export function UsedByPanel({
  groups,
  emptyMessage = "Nothing uses this yet.",
  action,
  compact = false,
}: {
  groups: UsedByGroup[];
  emptyMessage?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const total = count(groups);
  const populated = groups.filter((group) => group.items.length > 0);

  const items = (group: UsedByGroup) => (
    <ul>
      {/* One record may appear twice in a group — a Layout can bind several fields of
          the same Data Source — so the index disambiguates the key. */}
      {group.items.map((item, index) => (
        <li key={`${group.label}-${item.id}-${index}`}>
          {group.to ? (
            <Link to={group.to(item.id)}>
              <span>{item.name}</span>
              {item.hint && <small>{item.hint}</small>}
              <ExternalLink size={13} aria-hidden="true" />
            </Link>
          ) : (
            <span className="used-by__static">
              <span>{item.name}</span>
              {item.hint && <small>{item.hint}</small>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      className={`used-by${compact ? " used-by--compact" : ""}`}
      aria-labelledby="used-by-title"
    >
      <div className="used-by__header">
        <strong id="used-by-title">Used by</strong>
        {action}
      </div>
      {total === 0 ? (
        <p className="used-by__empty">{emptyMessage}</p>
      ) : compact ? (
        <div className="used-by__summary">
          {populated.map((group) => (
            <details key={group.label} className="used-by__summary-group">
              <summary>
                <span>
                  <strong>{group.items.length}</strong>
                  <small>{group.label}</small>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="used-by__summary-list">{items(group)}</div>
            </details>
          ))}
        </div>
      ) : (
        populated.map((group) => (
          <section key={group.label} className="used-by__group">
            <h4>
              {group.label}
              <span aria-hidden="true"> · {group.items.length}</span>
            </h4>
            {items(group)}
          </section>
        ))
      )}
    </aside>
  );
}
