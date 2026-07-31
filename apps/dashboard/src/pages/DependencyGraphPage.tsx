import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Database,
  ExternalLink,
  FileImage,
  LayoutTemplate,
  ListVideo,
  Monitor,
  Network,
  Search,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
  DependencyNodeType,
} from "../api/types";
import { EmptyState, Notice, PageHeader, Panel } from "../components/ui";
import "./DependencyGraphPage.css";

type TypePresentation = {
  label: string;
  plural: string;
  icon: LucideIcon;
  path: (id: string) => string;
  layer: "source" | "presentation" | "delivery";
};

const typePresentation: Record<DependencyNodeType, TypePresentation> = {
  data_source: {
    label: "Data Source",
    plural: "Data Sources",
    icon: Database,
    path: (id) => `/data-sources/${id}`,
    layer: "source",
  },
  asset: {
    label: "Media",
    plural: "Media",
    icon: FileImage,
    path: () => "/assets",
    layer: "source",
  },
  widget: {
    label: "Widget",
    plural: "Widgets",
    icon: WandSparkles,
    path: (id) => `/widgets/${id}`,
    layer: "source",
  },
  layout: {
    label: "Layout",
    plural: "Layouts",
    icon: LayoutTemplate,
    path: (id) => `/layouts/${id}`,
    layer: "presentation",
  },
  playlist: {
    label: "Playlist",
    plural: "Playlists",
    icon: ListVideo,
    path: (id) => `/playlists/${id}`,
    layer: "presentation",
  },
  schedule: {
    label: "Schedule",
    plural: "Schedules",
    icon: CalendarClock,
    path: (id) => `/schedules/${id}`,
    layer: "delivery",
  },
  screen_group: {
    label: "Sync group",
    plural: "Sync groups",
    icon: Users,
    path: (id) => `/groups/${id}`,
    layer: "delivery",
  },
  screen: {
    label: "Screen",
    plural: "Screens",
    icon: Monitor,
    path: (id) => `/screens/${id}`,
    layer: "delivery",
  },
};

const typeOrder = Object.keys(typePresentation) as DependencyNodeType[];
const nodeKey = (type: DependencyNodeType, id: string) => `${type}:${id}`;

function connectedNodes(
  graph: DependencyGraph,
  start: DependencyNode,
  direction: "upstream" | "downstream",
) {
  const byKey = new Map(
    graph.nodes.map((node) => [nodeKey(node.type, node.id), node]),
  );
  const visited = new Set<string>([nodeKey(start.type, start.id)]);
  let frontier = [start];
  const result: DependencyNode[] = [];
  while (frontier.length > 0) {
    const next: DependencyNode[] = [];
    for (const node of frontier) {
      for (const edge of graph.edges) {
        const matches =
          direction === "downstream"
            ? edge.fromType === node.type && edge.fromId === node.id
            : edge.toType === node.type && edge.toId === node.id;
        if (!matches) continue;
        const key =
          direction === "downstream"
            ? nodeKey(edge.toType, edge.toId)
            : nodeKey(edge.fromType, edge.fromId);
        if (visited.has(key)) continue;
        visited.add(key);
        const connected = byKey.get(key);
        if (connected) {
          result.push(connected);
          next.push(connected);
        }
      }
    }
    frontier = next;
  }
  return result;
}

function NodeLink({
  node,
  relationship,
  onSelect,
}: {
  node: DependencyNode;
  relationship?: string;
  onSelect: (node: DependencyNode) => void;
}) {
  const presentation = typePresentation[node.type];
  const Icon = presentation.icon;
  return (
    <button
      className={`dependency-node dependency-node--${node.type}`}
      type="button"
      onClick={() => onSelect(node)}
    >
      <Icon size={16} aria-hidden="true" />
      <span>
        <strong>{node.name}</strong>
        <small>
          {presentation.label}
          {relationship ? ` · ${relationship}` : ""}
        </small>
      </span>
    </button>
  );
}

function RelationshipList({
  title,
  icon: Icon,
  edges,
  graph,
  direction,
  onSelect,
}: {
  title: string;
  icon: LucideIcon;
  edges: DependencyEdge[];
  graph: DependencyGraph;
  direction: "upstream" | "downstream";
  onSelect: (node: DependencyNode) => void;
}) {
  const nodes = new Map(
    graph.nodes.map((node) => [nodeKey(node.type, node.id), node]),
  );
  return (
    <section className="dependency-relationships">
      <h3>
        <Icon size={16} aria-hidden="true" />
        {title}
        <span>{edges.length}</span>
      </h3>
      {edges.length === 0 ? (
        <p className="dependency-relationships__empty">
          No direct {direction} connections.
        </p>
      ) : (
        <div className="dependency-relationships__list">
          {edges.map((edge) => {
            const key =
              direction === "upstream"
                ? nodeKey(edge.fromType, edge.fromId)
                : nodeKey(edge.toType, edge.toId);
            const node = nodes.get(key);
            return node ? (
              <NodeLink
                key={`${key}-${edge.relationship}`}
                node={node}
                relationship={edge.relationship}
                onSelect={onSelect}
              />
            ) : null;
          })}
        </div>
      )}
    </section>
  );
}

export function DependencyGraphPage() {
  const graph = useQuery({
    queryKey: ["dependency-graph"],
    queryFn: api.dependencyGraph,
  });
  const [selectedKey, setSelectedKey] = useState<string>();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<DependencyNodeType | "all">("all");
  const data = graph.data ?? { nodes: [], edges: [] };
  const selected = data.nodes.find(
    (node) => nodeKey(node.type, node.id) === selectedKey,
  );

  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(undefined);
  }, [selected, selectedKey]);

  const filteredNodes = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return data.nodes.filter(
      (node) =>
        (type === "all" || node.type === type) &&
        (!needle || node.name.toLocaleLowerCase().includes(needle)),
    );
  }, [data.nodes, search, type]);

  const directUpstream = selected
    ? data.edges.filter(
        (edge) => edge.toType === selected.type && edge.toId === selected.id,
      )
    : [];
  const directDownstream = selected
    ? data.edges.filter(
        (edge) =>
          edge.fromType === selected.type && edge.fromId === selected.id,
      )
    : [];
  const upstream = selected ? connectedNodes(data, selected, "upstream") : [];
  const downstream = selected
    ? connectedNodes(data, selected, "downstream")
    : [];

  return (
    <main className="page plugins-page dependency-graph-page">
      <PageHeader
        eyebrow={
          <Link className="back-link" to="/plugins">
            <ArrowLeft size={15} /> Plugins
          </Link>
        }
        title="Dependency Graph"
        description="Trace what feeds each presentation and where a change will appear."
      />
      {graph.isError && (
        <Notice variant="danger">
          The dependency graph could not be loaded.
        </Notice>
      )}
      {graph.isLoading ? (
        <div className="table-loading">Mapping dependencies…</div>
      ) : data.nodes.length === 0 ? (
        <EmptyState
          icon={<Network size={24} aria-hidden="true" />}
          title="Nothing to map yet"
          message="Add content, a presentation, or a screen to start building the graph."
        />
      ) : (
        <>
          <section className="dependency-overview" aria-label="Graph summary">
            {(["source", "presentation", "delivery"] as const).map(
              (layer, index) => {
                const nodes = data.nodes.filter(
                  (node) => typePresentation[node.type].layer === layer,
                );
                return (
                  <div className="dependency-overview__layer" key={layer}>
                    <span>
                      {index === 0
                        ? "Sources"
                        : index === 1
                          ? "Presentations"
                          : "Delivery"}
                    </span>
                    <strong>{nodes.length}</strong>
                    <small>
                      {typeOrder
                        .filter(
                          (nodeType) =>
                            typePresentation[nodeType].layer === layer,
                        )
                        .map((nodeType) => typePresentation[nodeType].plural)
                        .join(" · ")}
                    </small>
                    {index < 2 && (
                      <ArrowDown
                        className="dependency-overview__arrow"
                        size={18}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              },
            )}
          </section>

          <div className="dependency-toolbar">
            <label className="dependency-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search graph</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a record"
              />
            </label>
            <label>
              <span className="sr-only">Filter by type</span>
              <select
                value={type}
                onChange={(event) =>
                  setType(event.target.value as DependencyNodeType | "all")
                }
              >
                <option value="all">All types</option>
                {typeOrder.map((nodeType) => (
                  <option value={nodeType} key={nodeType}>
                    {typePresentation[nodeType].plural}
                  </option>
                ))}
              </select>
            </label>
            <span className="dependency-toolbar__count">
              {filteredNodes.length} of {data.nodes.length} records ·{" "}
              {data.edges.length} connections
            </span>
          </div>

          <div className="dependency-explorer">
            <Panel className="dependency-inventory">
              <header>
                <h2>Records</h2>
                <small>Select one to trace it</small>
              </header>
              <div className="dependency-inventory__list">
                {filteredNodes.length === 0 ? (
                  <p>No records match this filter.</p>
                ) : (
                  filteredNodes.map((node) => (
                    <NodeLink
                      key={nodeKey(node.type, node.id)}
                      node={node}
                      onSelect={(next) =>
                        setSelectedKey(nodeKey(next.type, next.id))
                      }
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel className="dependency-detail">
              {!selected ? (
                <EmptyState
                  icon={<Network size={24} aria-hidden="true" />}
                  title="Select a record"
                  message="Choose any record to see what it depends on and every downstream record it can affect."
                />
              ) : (
                <>
                  <header className="dependency-detail__header">
                    <span>
                      <small>{typePresentation[selected.type].label}</small>
                      <h2>{selected.name}</h2>
                    </span>
                    <Link
                      className="button button--secondary button--compact"
                      to={typePresentation[selected.type].path(selected.id)}
                    >
                      Open <ExternalLink size={14} aria-hidden="true" />
                    </Link>
                  </header>
                  <div className="dependency-impact">
                    <span>
                      <strong>{upstream.length}</strong>
                      upstream
                    </span>
                    <span>
                      <strong>{downstream.length}</strong>
                      downstream
                    </span>
                  </div>
                  <div className="dependency-detail__columns">
                    <RelationshipList
                      title="Direct dependencies"
                      icon={ArrowUp}
                      edges={directUpstream}
                      graph={data}
                      direction="upstream"
                      onSelect={(next) =>
                        setSelectedKey(nodeKey(next.type, next.id))
                      }
                    />
                    <RelationshipList
                      title="Direct consumers"
                      icon={ArrowDown}
                      edges={directDownstream}
                      graph={data}
                      direction="downstream"
                      onSelect={(next) =>
                        setSelectedKey(nodeKey(next.type, next.id))
                      }
                    />
                  </div>
                </>
              )}
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
