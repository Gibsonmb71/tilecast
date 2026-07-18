import { Select, ToggleGroup, ViewToggle } from "../ui";
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
      <ToggleGroup
        className="content-picker-filters"
        label="Content type"
        value={filter}
        onValueChange={onFilter}
        items={filters.map(([value, label]) => ({ value, label }))}
      />
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
      <ViewToggle value={view} onValueChange={onView} label="Content view" />
    </div>
  );
}
