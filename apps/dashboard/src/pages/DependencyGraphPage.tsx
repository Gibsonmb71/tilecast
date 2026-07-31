import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Database,
  ExternalLink,
  FileImage,
  Focus,
  LayoutTemplate,
  ListVideo,
  Monitor,
  Network,
  Search,
  Users,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
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
};

type PositionedNode = DependencyNode & { x: number; y: number };
type Viewport = { x: number; y: number; scale: number };

const nodeWidth = 184;
const nodeHeight = 58;
const columnGap = 82;
const rowGap = 24;
const worldPadding = 42;

const typePresentation: Record<DependencyNodeType, TypePresentation> = {
  data_source: {
    label: "Data Source",
    plural: "Data Sources",
    icon: Database,
    path: (id) => `/data-sources/${id}`,
  },
  asset: {
    label: "Media",
    plural: "Media",
    icon: FileImage,
    path: () => "/assets",
  },
  widget: {
    label: "Widget",
    plural: "Widgets",
    icon: WandSparkles,
    path: (id) => `/widgets/${id}`,
  },
  layout: {
    label: "Layout",
    plural: "Layouts",
    icon: LayoutTemplate,
    path: (id) => `/layouts/${id}`,
  },
  playlist: {
    label: "Playlist",
    plural: "Playlists",
    icon: ListVideo,
    path: (id) => `/playlists/${id}`,
  },
  schedule: {
    label: "Schedule",
    plural: "Schedules",
    icon: CalendarClock,
    path: (id) => `/schedules/${id}`,
  },
  screen_group: {
    label: "Sync group",
    plural: "Sync groups",
    icon: Users,
    path: (id) => `/groups/${id}`,
  },
  screen: {
    label: "Screen",
    plural: "Screens",
    icon: Monitor,
    path: (id) => `/screens/${id}`,
  },
};

const typeOrder = Object.keys(typePresentation) as DependencyNodeType[];
const nodeKey = (type: DependencyNodeType, id: string) => `${type}:${id}`;
const emptyGraph: DependencyGraph = { nodes: [], edges: [] };

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

function layoutGraph(nodes: DependencyNode[]) {
  const positioned: PositionedNode[] = [];
  let longestColumn = 1;
  typeOrder.forEach((type, column) => {
    const typedNodes = nodes
      .filter((node) => node.type === type)
      .sort((left, right) => left.name.localeCompare(right.name));
    longestColumn = Math.max(longestColumn, typedNodes.length);
    typedNodes.forEach((node, row) => {
      positioned.push({
        ...node,
        x: worldPadding + column * (nodeWidth + columnGap),
        y: worldPadding + 46 + row * (nodeHeight + rowGap),
      });
    });
  });
  return {
    nodes: positioned,
    width:
      worldPadding * 2 +
      typeOrder.length * nodeWidth +
      (typeOrder.length - 1) * columnGap,
    height: Math.max(
      620,
      worldPadding * 2 +
        46 +
        longestColumn * nodeHeight +
        (longestColumn - 1) * rowGap,
    ),
  };
}

function edgePath(from: PositionedNode, to: PositionedNode) {
  const forward = to.x >= from.x;
  const startX = forward ? from.x + nodeWidth : from.x;
  const endX = forward ? to.x : to.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endY = to.y + nodeHeight / 2;
  const curve = Math.max(38, Math.abs(endX - startX) * 0.42);
  const firstControl = forward ? startX + curve : startX - curve;
  const secondControl = forward ? endX - curve : endX + curve;
  return `M ${startX} ${startY} C ${firstControl} ${startY}, ${secondControl} ${endY}, ${endX} ${endY}`;
}

function RelationshipNode({
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
      className={`dependency-related-node dependency-related-node--${node.type}`}
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
              <RelationshipNode
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
  const [viewport, setViewport] = useState<Viewport>({
    x: 32,
    y: 32,
    scale: 0.7,
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | {
        pointerX: number;
        pointerY: number;
        viewportX: number;
        viewportY: number;
      }
    | undefined
  >(undefined);
  const data = graph.data ?? emptyGraph;
  const layout = useMemo(() => layoutGraph(data.nodes), [data.nodes]);
  const positionedByKey = useMemo(
    () =>
      new Map(layout.nodes.map((node) => [nodeKey(node.type, node.id), node])),
    [layout.nodes],
  );
  const selected = data.nodes.find(
    (node) => nodeKey(node.type, node.id) === selectedKey,
  );

  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(undefined);
  }, [selected, selectedKey]);

  const { upstream, downstream } = useMemo(
    () => ({
      upstream: selected ? connectedNodes(data, selected, "upstream") : [],
      downstream: selected ? connectedNodes(data, selected, "downstream") : [],
    }),
    [data, selected],
  );
  const connectedKeys = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(
      [selected, ...upstream, ...downstream].map((node) =>
        nodeKey(node.type, node.id),
      ),
    );
  }, [downstream, selected, upstream]);
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
  const needle = search.trim().toLocaleLowerCase();
  const matchingKeys = useMemo(
    () =>
      new Set(
        data.nodes
          .filter(
            (node) =>
              (type === "all" || node.type === type) &&
              (!needle || node.name.toLocaleLowerCase().includes(needle)),
          )
          .map((node) => nodeKey(node.type, node.id)),
      ),
    [data.nodes, needle, type],
  );
  const filtering = type !== "all" || Boolean(needle);

  const fitGraph = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const scale = Math.min(
      1,
      (bounds.width - 48) / layout.width,
      (bounds.height - 48) / layout.height,
    );
    setViewport({
      scale,
      x: (bounds.width - layout.width * scale) / 2,
      y: Math.max(24, (bounds.height - layout.height * scale) / 2),
    });
  }, [layout.height, layout.width]);

  useEffect(() => {
    if (data.nodes.length === 0) return;
    const frame = requestAnimationFrame(fitGraph);
    return () => cancelAnimationFrame(frame);
  }, [data.nodes.length, fitGraph]);

  const zoom = (factor: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setViewport((current) => {
      const nextScale = Math.min(1.8, Math.max(0.22, current.scale * factor));
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: centerX - worldX * nextScale,
        y: centerY - worldY * nextScale,
      };
    });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    setViewport((current) => {
      const nextScale = Math.min(
        1.8,
        Math.max(0.22, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)),
      );
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".dependency-graph-node")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      viewportX: viewport.x,
      viewportY: viewport.y,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setViewport((current) => ({
      ...current,
      x: drag.viewportX + event.clientX - drag.pointerX,
      y: drag.viewportY + event.clientY - drag.pointerY,
    }));
  };

  return (
    <main className="page plugins-page dependency-graph-page">
      <PageHeader
        eyebrow={
          <Link className="back-link" to="/plugins">
            <ArrowLeft size={15} /> Plugins
          </Link>
        }
        title="Dependency Graph"
        description="Follow content and data through presentations, schedules, groups, and screens."
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
          <div className="dependency-toolbar">
            <label className="dependency-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search graph</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a node"
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
              {data.nodes.length} nodes · {data.edges.length} connections
            </span>
          </div>

          <div className="dependency-workspace">
            <section
              className={`dependency-graph-canvas${dragRef.current ? " dependency-graph-canvas--dragging" : ""}`}
              ref={canvasRef}
              aria-label="Visual dependency graph"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => {
                dragRef.current = undefined;
              }}
              onPointerCancel={() => {
                dragRef.current = undefined;
              }}
            >
              <div className="dependency-graph-controls">
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => zoom(1.2)}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => zoom(0.8)}
                >
                  <ZoomOut size={16} />
                </button>
                <button type="button" aria-label="Fit graph" onClick={fitGraph}>
                  <Focus size={16} />
                </button>
              </div>
              <div className="dependency-graph-legend" aria-hidden="true">
                <span className="dependency-graph-legend__source">Sources</span>
                <span className="dependency-graph-legend__presentation">
                  Presentations
                </span>
                <span className="dependency-graph-legend__delivery">
                  Delivery
                </span>
              </div>
              <div
                className="dependency-graph-world"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                }}
              >
                <svg
                  className="dependency-graph-lines"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="dependency-arrow"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M0,0 L7,3.5 L0,7 Z" />
                    </marker>
                    <marker
                      id="dependency-arrow-active"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M0,0 L7,3.5 L0,7 Z" />
                    </marker>
                  </defs>
                  {data.edges.map((edge, index) => {
                    const fromKey = nodeKey(edge.fromType, edge.fromId);
                    const toKey = nodeKey(edge.toType, edge.toId);
                    const from = positionedByKey.get(fromKey);
                    const to = positionedByKey.get(toKey);
                    if (!from || !to) return null;
                    const active =
                      selected &&
                      connectedKeys.has(fromKey) &&
                      connectedKeys.has(toKey);
                    return (
                      <path
                        className={`dependency-edge${active ? " dependency-edge--active" : ""}${selected && !active ? " dependency-edge--muted" : ""}`}
                        d={edgePath(from, to)}
                        key={`${fromKey}-${toKey}-${edge.relationship}-${index}`}
                        markerEnd={
                          active
                            ? "url(#dependency-arrow-active)"
                            : "url(#dependency-arrow)"
                        }
                      />
                    );
                  })}
                </svg>
                {typeOrder.map((nodeType, column) => (
                  <div
                    className="dependency-graph-column-label"
                    key={nodeType}
                    style={{
                      left: worldPadding + column * (nodeWidth + columnGap),
                      width: nodeWidth,
                    }}
                  >
                    {typePresentation[nodeType].plural}
                  </div>
                ))}
                {layout.nodes.map((node) => {
                  const key = nodeKey(node.type, node.id);
                  const presentation = typePresentation[node.type];
                  const Icon = presentation.icon;
                  const muted =
                    (selected && !connectedKeys.has(key)) ||
                    (filtering && !matchingKeys.has(key));
                  return (
                    <button
                      className={`dependency-graph-node dependency-graph-node--${node.type}${key === selectedKey ? " dependency-graph-node--selected" : ""}${muted ? " dependency-graph-node--muted" : ""}`}
                      type="button"
                      key={key}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: nodeWidth,
                        height: nodeHeight,
                      }}
                      aria-pressed={key === selectedKey}
                      onClick={() => setSelectedKey(key)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>
                        <strong>{node.name}</strong>
                        <small>{presentation.label}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="dependency-graph-hint">
                Drag to pan · Scroll to zoom · Arrows point to consumers
              </p>
            </section>

            <Panel className="dependency-detail">
              {!selected ? (
                <EmptyState
                  icon={<Network size={24} aria-hidden="true" />}
                  title="Select a node"
                  message="Choose any node to highlight its complete upstream and downstream path."
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
                  <div className="dependency-detail__relationships">
                    <RelationshipList
                      title="Direct dependencies"
                      icon={ArrowUp}
                      edges={directUpstream}
                      graph={data}
                      direction="upstream"
                      onSelect={(node) =>
                        setSelectedKey(nodeKey(node.type, node.id))
                      }
                    />
                    <RelationshipList
                      title="Direct consumers"
                      icon={ArrowDown}
                      edges={directDownstream}
                      graph={data}
                      direction="downstream"
                      onSelect={(node) =>
                        setSelectedKey(nodeKey(node.type, node.id))
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
