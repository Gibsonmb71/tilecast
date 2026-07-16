import { Select } from "../ui";
import { Grid2X2, List } from "lucide-react";
import { DashboardSearch } from "../DashboardListToolbar";

export type ContentPickerFilter =
  "all" | "image" | "video" | "source" | "website" | "youtube" | "calendar";

export function ContentPickerToolbar({
  search,
  filter,
  sort,
  view,
  onSearch,
  onFilter,
  onSort,
  onView,
}: {
  search: string;
  filter: ContentPickerFilter;
  sort: string;
  view: "grid" | "list";
  onSearch: (value: string) => void;
  onFilter: (value: ContentPickerFilter) => void;
  onSort: (value: string) => void;
  onView: (value: "grid" | "list") => void;
}) {
  const filters: [ContentPickerFilter, string][] = [
    ["all", "All"],
    ["image", "Images"],
    ["video", "Videos"],
    ["source", "Sources"],
    ["website", "Websites"],
    ["youtube", "YouTube"],
    ["calendar", "Calendars"],
  ];
  return (
    <div className="content-picker-toolbar">
      <DashboardSearch
        autoFocus
        value={search}
        onValueChange={onSearch}
        label="Search content"
        placeholder="Search content"
      />
      <div className="content-picker-filters" aria-label="Content type">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <Select
        aria-label="Sort content"
        value={sort}
        onChange={(event) => onSort(event.target.value)}
      >
        <option value="updated">Recently updated</option>
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="name">Name</option>
      </Select>
      <span className="view-switch" aria-label="Content view">
        <button
          type="button"
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          onClick={() => onView("grid")}
        >
          <Grid2X2 size={16} />
        </button>
        <button
          type="button"
          aria-label="List view"
          aria-pressed={view === "list"}
          onClick={() => onView("list")}
        >
          <List size={16} />
        </button>
      </span>
    </div>
  );
}
