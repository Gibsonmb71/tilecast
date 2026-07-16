import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

export function DashboardListToolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`dashboard-list-toolbar ${className}`.trim()}>
      {children}
    </div>
  );
}

export function DashboardSearch({
  value,
  onValueChange,
  label,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="dashboard-search">
      <Search size={16} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
      <input
        type="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          className="dashboard-search__clear"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onValueChange("")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
