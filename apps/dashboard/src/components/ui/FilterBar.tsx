import { useCallback, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { X } from "lucide-react";
import { Select } from "./SignalSelect";
import { DashboardSearch } from "../DashboardListToolbar";

export type FilterOption = { value: string; label: string };

type FilterBase = {
  key: string;
  label: string;
  /**
   * Keeps the control out of the bar while still chipping the value. Use for
   * filters presented elsewhere, such as inside an advanced disclosure, so an
   * active filter is never invisible just because its control is put away.
   */
  hidden?: boolean;
};

export type FilterDefinition =
  | (FilterBase & { kind: "search"; placeholder: string })
  | (FilterBase & {
      kind: "select";
      options: readonly FilterOption[];
      /** Text for the empty value, such as "All screens". */
      allLabel: string;
    })
  | (FilterBase & { kind: "text"; placeholder: string });

export type FilterValues = Record<string, string>;

/**
 * Filter state held in the URL so a filtered view can be reloaded, bookmarked,
 * and shared. Parameters the caller does not own, such as the active tab, are
 * left untouched.
 */
export function useUrlFilters(definitions: readonly FilterDefinition[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const keys = definitions.map((definition) => definition.key).join(",");
  const values = useMemo(() => {
    const result: FilterValues = {};
    for (const key of keys ? keys.split(",") : []) {
      result[key] = searchParams.get(key) ?? "";
    }
    return result;
  }, [keys, searchParams]);

  const set = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clear = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of keys ? keys.split(",") : []) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [keys, setSearchParams]);

  return { values, set, clear };
}

/**
 * Renders a filter row from declarative definitions, and reflects every active
 * filter as a removable chip so a narrowed result set never looks like an empty
 * one.
 */
export function FilterBar({
  definitions,
  values,
  onChange,
  onClear,
  children,
  label = "Filters",
  className = "",
}: {
  definitions: readonly FilterDefinition[];
  values: FilterValues;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  /** Extra controls, such as an advanced-filter disclosure. */
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`filter-bar ${className}`.trim()}>
      <div className="filter-bar__controls" role="group" aria-label={label}>
        {definitions
          .filter((definition) => !definition.hidden)
          .map((definition) => (
            <FilterControl
              key={definition.key}
              definition={definition}
              value={values[definition.key] ?? ""}
              onChange={(value) => onChange(definition.key, value)}
            />
          ))}
        {children}
      </div>
      <FilterChips
        definitions={definitions}
        values={values}
        onChange={onChange}
        onClear={onClear}
      />
    </div>
  );
}

function FilterControl({
  definition,
  value,
  onChange,
}: {
  definition: FilterDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  if (definition.kind === "search") {
    return (
      <DashboardSearch
        value={value}
        onValueChange={onChange}
        label={definition.label}
        placeholder={definition.placeholder}
      />
    );
  }
  if (definition.kind === "text") {
    return (
      <input
        className="filter-bar__text"
        value={value}
        aria-label={definition.label}
        placeholder={definition.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Select
      aria-label={definition.label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{definition.allLabel}</option>
      {definition.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * The active filters, as chips. Search is excluded: its value is already
 * visible in its own field, and it carries its own clear control.
 */
export function FilterChips({
  definitions,
  values,
  onChange,
  onClear,
}: {
  definitions: readonly FilterDefinition[];
  values: FilterValues;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const active = definitions
    .filter(
      (definition) => definition.kind !== "search" && values[definition.key],
    )
    .map((definition) => ({
      definition,
      value: values[definition.key] ?? "",
    }));
  if (active.length === 0) return null;
  return (
    <div className="filter-chips" aria-label="Active filters">
      {active.map(({ definition, value }) => {
        const shown = describeValue(definition, value);
        return (
          <button
            key={definition.key}
            type="button"
            className="filter-chip"
            // The visible text is repeated verbatim so the accessible name
            // still contains the label a sighted person is reading.
            aria-label={`Remove filter ${definition.label}: ${shown}`}
            onClick={() => onChange(definition.key, "")}
          >
            <strong>{definition.label}:</strong>
            <span>{shown}</span>
            <X size={13} aria-hidden="true" />
          </button>
        );
      })}
      <button type="button" className="filter-chips__clear" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

/** Chips show the option label a person chose, not the identifier behind it. */
function describeValue(definition: FilterDefinition, value: string) {
  if (definition.kind !== "select") return value;
  return (
    definition.options.find((option) => option.value === value)?.label ?? value
  );
}
