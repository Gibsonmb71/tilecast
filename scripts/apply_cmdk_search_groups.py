from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"Could not find {label}")
    return source.replace(old, new, 1)


topbar_path = Path("apps/dashboard/src/components/StudioTopbar.tsx")
source = topbar_path.read_text()

if "type CommandGroupName" not in source:
    start = source.index("type CommandResult = {")
    end = source.index("function breadcrumbQueryKey", start)
    command_search = '''type CommandGroupName =
  | "Quick actions"
  | "Screens"
  | "Content"
  | "Presentations"
  | "Scheduling"
  | "Administration"
  | "Navigation";

type CommandAction = "upload-media";

type CommandResult = {
  id: string;
  label: string;
  description: string;
  to?: string;
  action?: CommandAction;
  category: CommandGroupName;
  Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
  score: number;
};

type CommandPermissions = {
  canCreate: boolean;
  canPair: boolean;
};

type Breadcrumb = { label: string; to: string };
type CommandProvider = {
  id: string;
  results: () => (Omit<CommandResult, "score"> & { keywords?: string[] })[];
};

const statusLabels: Record<ScreenStatus, string> = {
  online: "Online",
  recent: "Recently online",
  stale: "Stale",
  offline: "Offline",
  disabled: "Disabled",
  revoked: "Pairing revoked",
};

const notificationGroups: { priority: NotificationPriority; label: string }[] =
  [
    { priority: "critical", label: "Critical" },
    { priority: "warning", label: "Needs attention" },
    { priority: "info", label: "Info" },
  ];

const commandGroupOrder: CommandGroupName[] = [
  "Quick actions",
  "Screens",
  "Content",
  "Presentations",
  "Scheduling",
  "Administration",
  "Navigation",
];

const defaultRouteIds = new Set([
  "route:/",
  "route:/screens",
  "route:/assets",
  "route:/playlists",
  "route:/layouts",
  "route:/schedules",
]);

function platformShortcut() {
  if (typeof navigator === "undefined") return "⌘K";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

export function fuzzyScore(query: string, candidate: string) {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = candidate.toLocaleLowerCase();
  if (!needle) return 1;
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0)
    return 200 - exactIndex - (haystack.length - needle.length);

  let candidateIndex = 0;
  let gaps = 0;
  for (const character of needle) {
    const match = haystack.indexOf(character, candidateIndex);
    if (match < 0) return -1;
    gaps += match - candidateIndex;
    candidateIndex = match + 1;
  }
  return 100 - gaps - (haystack.length - needle.length);
}

function resultIcon(to: string) {
  if (to.startsWith("/screens") || to.startsWith("/groups")) return Monitor;
  if (to.startsWith("/assets")) return Image;
  if (to.startsWith("/playlists")) return ListVideo;
  if (to.startsWith("/layouts")) return Layers3;
  if (to.startsWith("/schedules")) return CalendarClock;
  if (to.startsWith("/settings") || to.startsWith("/preferences"))
    return Settings;
  return FileSliders;
}

function routeGroup(to: string): CommandGroupName {
  if (to.startsWith("/screens") || to.startsWith("/groups")) return "Screens";
  if (
    to.startsWith("/assets") ||
    to.startsWith("/widgets") ||
    to.startsWith("/data-sources")
  )
    return "Content";
  if (to.startsWith("/playlists") || to.startsWith("/layouts"))
    return "Presentations";
  if (to.startsWith("/schedules")) return "Scheduling";
  if (
    to.startsWith("/settings") ||
    to.startsWith("/preferences") ||
    to.startsWith("/approvals") ||
    to.startsWith("/activity")
  )
    return "Administration";
  return "Navigation";
}

function collectRouteResults(routes: readonly RouteObject[]) {
  const results: (Omit<CommandResult, "score"> & { keywords?: string[] })[] = [];
  const seen = new Set<string>();
  const visit = (route: RouteObject) => {
    const item = studioRouteHandle(route).search;
    if (item && !seen.has(item.to)) {
      seen.add(item.to);
      results.push({
        id: `route:${item.to}`,
        label: item.label,
        description: item.description,
        to: item.to,
        category: routeGroup(item.to),
        Icon: resultIcon(item.to),
        keywords: item.keywords,
      });
    }
    route.children?.forEach(visit);
  };
  routes.forEach(visit);
  return results;
}

function collectActionResults(permissions: CommandPermissions) {
  const results: (Omit<CommandResult, "score"> & { keywords?: string[] })[] = [];
  if (permissions.canPair) {
    results.push({
      id: "action:pair-screen",
      label: "Pair a screen",
      description: "Connect a new signage player",
      to: "/screens/pair",
      category: "Quick actions",
      Icon: MonitorCheck,
      keywords: ["add screen", "new device", "player"],
    });
  }
  if (permissions.canCreate) {
    results.push(
      {
        id: "action:upload-media",
        label: "Upload media",
        description: "Add images, videos, or documents",
        action: "upload-media",
        category: "Quick actions",
        Icon: Upload,
        keywords: ["content", "asset", "file"],
      },
      {
        id: "action:create-playlist",
        label: "Create playlist",
        description: "Build a new fullscreen presentation",
        to: "/playlists?create=1",
        category: "Quick actions",
        Icon: ListVideo,
        keywords: ["new presentation"],
      },
      {
        id: "action:create-layout",
        label: "Create layout",
        description: "Arrange content on a presentation canvas",
        to: "/layouts?create=1",
        category: "Quick actions",
        Icon: Layers3,
        keywords: ["new presentation", "canvas"],
      },
      {
        id: "action:create-schedule",
        label: "Create schedule",
        description: "Plan where and when content plays",
        to: "/schedules/new",
        category: "Quick actions",
        Icon: CalendarClock,
        keywords: ["new deployment", "publish"],
      },
    );
  }
  return results;
}

export function buildCommandResults(
  routes: readonly RouteObject[],
  screens: Screen[],
  query: string,
  permissions: CommandPermissions = { canCreate: true, canPair: true },
) {
  const providers: CommandProvider[] = [
    { id: "actions", results: () => collectActionResults(permissions) },
    { id: "routes", results: () => collectRouteResults(routes) },
    {
      id: "screens",
      results: () =>
        screens.map((screen) => ({
          id: `screen:${screen.id}`,
          label: screen.name,
          description: `${statusLabels[screen.status]}${screen.location ? ` · ${screen.location}` : ""}`,
          to: `/screens/${screen.id}`,
          category: "Screens" as const,
          Icon: Monitor,
          keywords: [
            screen.location,
            screen.platform,
            "screen",
            "player",
          ].filter(Boolean),
        })),
    },
  ];

  const normalizedQuery = query.trim();
  const results = providers
    .flatMap((provider) => provider.results())
    .map((result) => ({
      ...result,
      score: fuzzyScore(
        normalizedQuery,
        [result.label, result.description, ...(result.keywords ?? [])].join(" "),
      ),
    }))
    .filter((result) => result.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        commandGroupOrder.indexOf(left.category) -
          commandGroupOrder.indexOf(right.category),
    ) as CommandResult[];

  if (!normalizedQuery) {
    return results.filter(
      (result) =>
        result.category === "Quick actions" || defaultRouteIds.has(result.id),
    );
  }

  return results.slice(0, 20);
}

function groupCommandResults(results: CommandResult[]) {
  return commandGroupOrder
    .map((name) => ({
      name,
      results: results.filter((result) => result.category === name),
    }))
    .filter((group) => group.results.length > 0);
}

'''
    source = source[:start] + command_search + source[end:]

    palette_start = source.index("function CommandPalette({")
    palette_end = source.index("\n\nexport function StudioTopbar", palette_start)
    palette = '''function CommandPalette({
  open,
  onClose,
  onUpload,
  routes,
  screens,
  canCreate,
  canPair,
}: {
  open: boolean;
  onClose: () => void;
  onUpload: () => void;
  routes: readonly RouteObject[];
  screens: Screen[];
  canCreate: boolean;
  canPair: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const results = buildCommandResults(routes, screens, query, {
    canCreate,
    canPair,
  });
  const groups = groupCommandResults(results);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const select = (result: CommandResult) => {
    onClose();
    if (result.action === "upload-media") {
      onUpload();
      return;
    }
    if (result.to) void navigate(result.to);
  };

  return (
    <Dialog
      open={open}
      title="Search Tilecast"
      className="command-palette-dialog"
      onClose={onClose}
    >
      <Command
        className="command-palette"
        label="Search Tilecast"
        loop
        shouldFilter={false}
      >
        <label className="command-palette__input">
          <Search size={18} aria-hidden="true" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search screens, media, playlists…"
            aria-label="Search Tilecast"
          />
          <kbd>{platformShortcut()}</kbd>
        </label>
        <Command.List
          className="command-palette__results"
          label="Search results"
        >
          <Command.Empty className="command-palette__empty">
            {query.trim()
              ? `No results for “${query.trim()}”.`
              : "No destinations available."}
          </Command.Empty>
          {groups.map((group) => (
            <Command.Group
              className="command-palette__group"
              heading={group.name}
              key={group.name}
            >
              {group.results.map((result) => (
                <Command.Item
                  className="command-palette__result"
                  key={result.id}
                  value={result.id}
                  onSelect={() => select(result)}
                >
                  <result.Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{result.label}</strong>
                    <small>{result.description}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <footer className="command-palette__footer">
          <span>↑↓ Move</span>
          <span>Enter Open</span>
          <span>Esc Close</span>
        </footer>
      </Command>
    </Dialog>
  );
}'''
    source = source[:palette_start] + palette + source[palette_end:]

    old_call = '''      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        routes={routes}
        screens={screens.data?.items ?? []}
      />'''
    new_call = '''      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onUpload={() => setUploadOpen(true)}
        routes={routes}
        screens={screens.data?.items ?? []}
        canCreate={canCreate}
        canPair={canPair}
      />'''
    source = replace_once(source, old_call, new_call, "CommandPalette invocation")
    topbar_path.write_text(source)

app_path = Path("apps/dashboard/src/App.tsx")
app_source = app_path.read_text()
if 'search: search(\n            "Sync groups"' not in app_source:
    old_groups = '''        path: "groups",
        handle: { breadcrumb: "Sync groups" },'''
    new_groups = '''        path: "groups",
        handle: {
          breadcrumb: "Sync groups",
          search: search(
            "Sync groups",
            "Keep multiple screens playing in lockstep",
            "/groups",
            ["screen groups", "synchronized playback"],
          ),
        },'''
    app_source = replace_once(app_source, old_groups, new_groups, "Sync groups route")
    app_path.write_text(app_source)

css_path = Path("apps/dashboard/src/styles/topbar.css")
css = css_path.read_text()
if ".command-palette__group [cmdk-group-heading]" not in css:
    css = replace_once(
        css,
        '''  overflow-y: auto;
  padding: var(--tc-space-2);
}''',
        '''  overflow-y: auto;
  padding: var(--tc-space-2);
  scroll-padding-block: var(--tc-space-2);
}''',
        "command list scroll padding",
    )
    css = replace_once(
        css,
        "grid-template-columns: auto minmax(0, 1fr) auto auto;",
        "grid-template-columns: auto minmax(0, 1fr) auto;",
        "command result columns",
    )
    css = replace_once(
        css,
        '''.command-palette__results small,
.command-palette__results em {
  color: var(--tc-text-secondary);
  font: var(--tc-text-supporting);
}

.command-palette__results em {
  font-style: normal;
}
''',
        '''.command-palette__results small {
  color: var(--tc-text-secondary);
  font: var(--tc-text-supporting);
}

.command-palette__group + .command-palette__group {
  margin-top: var(--tc-space-2);
}

.command-palette__group [cmdk-group-heading] {
  padding: var(--tc-space-2) var(--tc-space-3) var(--tc-space-1);
  color: var(--tc-text-disabled);
  font: var(--tc-text-supporting);
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
''',
        "command group styling",
    )
    css = replace_once(
        css,
        '''  .command-palette__results em,
  .command-palette__footer {''',
        '''  .command-palette__footer {''',
        "mobile command footer selector",
    )
    css_path.write_text(css)

test_path = Path("apps/dashboard/src/components/StudioTopbar.test.tsx")
tests = test_path.read_text()
if 'it("groups useful actions and destinations in the command menu"' not in tests:
    marker = '''  it("shows active alerts and keeps global actions in the utility region", async () => {'''
    additions = '''  it("groups useful actions and destinations in the command menu", async () => {
    renderTopbar();
    await waitFor(() => expect(api.screens).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Search Tilecast" }));

    expect(
      await screen.findByText("Quick actions", {
        selector: "[cmdk-group-heading]",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Screens", { selector: "[cmdk-group-heading]" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /Create playlist/ }),
    ).toBeTruthy();
  });

  it("finds sync groups and opens upload from a command action", async () => {
    renderTopbar();
    await waitFor(() => expect(api.screens).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Search Tilecast" }));
    const searchInput = await screen.findByRole("combobox", {
      name: "Search Tilecast",
    });
    fireEvent.change(searchInput, { target: { value: "sync" } });

    expect(
      await screen.findByRole("option", { name: /Sync groups/ }),
    ).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "upload" } });
    fireEvent.click(
      await screen.findByRole("option", { name: /Upload media/ }),
    );
    expect(screen.getByRole("dialog", { name: "Upload media" })).toBeTruthy();
  });

'''
    tests = replace_once(tests, marker, additions + marker, "topbar test insertion")
    test_path.write_text(tests)
