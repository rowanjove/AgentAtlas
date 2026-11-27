import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export interface LayoutNodeInput {
  id: string;
  label: string;
  subtitle?: string;
  badge?: string;
  accentColor?: string;
  selected?: boolean;
  dimmed?: boolean;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: 'requires' | 'recommended' | 'extension' | 'related' | 'contrasts' | 'flow';
  active?: boolean;
}

type ElkInstance = { layout: (graph: unknown) => Promise<{ children?: Array<{ id: string; x?: number; y?: number }> }> };
let elkPromise: Promise<ElkInstance> | null = null;
function getElk(): Promise<ElkInstance> {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then((mod) => {
      const Ctor = (mod.default ?? mod) as new () => ElkInstance;
      return new Ctor();
    });
  }
  return elkPromise;
}

export function ElkFlowCanvas({
  nodes: inputNodes,
  edges: inputEdges,
  direction = 'DOWN',
  showMiniMap = true,
  initialViewport,
  onViewportChange,
  onNodeClick,
  onNodeDoubleClick,
}: {
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
  direction?: 'DOWN' | 'RIGHT';
  showMiniMap?: boolean;
  initialViewport?: { x: number; y: number; zoom: number } | null;
  onViewportChange?: (vp: { x: number; y: number; zoom: number }) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
}) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const initialViewportRef = useRef(initialViewport);
  initialViewportRef.current = initialViewport;

  const layoutInputsRef = useRef({ nodes: inputNodes, edges: inputEdges, direction });
  layoutInputsRef.current = { nodes: inputNodes, edges: inputEdges, direction };

  const topologyKey = useMemo(
    () =>
      `${direction}::${inputNodes.map((n) => n.id).join(',')}::${inputEdges
        .map((e) => `${e.id}:${e.source}->${e.target}`)
        .join(',')}`,
    [direction, inputNodes, inputEdges],
  );

  const [layoutPositions, setLayoutPositions] = useState<{
    key: string;
    positions: Map<string, { x: number; y: number }>;
  }>({ key: '', positions: new Map() });

  useEffect(() => {
    const { nodes: curNodes, edges: curEdges, direction: curDir } = layoutInputsRef.current;
    if (curNodes.length === 0) {
      setLayoutPositions({ key: topologyKey, positions: new Map() });
      return;
    }

    let active = true;
    const nodeWidth = 240;
    const nodeHeight = 74;

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': curDir,
        'elk.spacing.nodeNode': '44',
        'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children: curNodes.map((n) => ({
        id: n.id,
        width: nodeWidth,
        height: nodeHeight,
      })),
      edges: curEdges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    getElk().then((elk) => elk.layout(elkGraph)).then((layout) => {
      if (!active) return;
      const positions = new Map<string, { x: number; y: number }>();
      for (const c of layout.children ?? []) {
        positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      }
      setLayoutPositions({ key: topologyKey, positions });

      if (rfInstanceRef.current && !initialViewportRef.current) {
        setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.2, maxZoom: 1.05 }), 25);
      }
    });

    return () => {
      active = false;
    };
  }, [topologyKey]);

  useEffect(() => {
    if (inputNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }
    if (layoutPositions.key !== topologyKey) return;

    const nodeWidth = 240;
    const nodeHeight = 74;

    const mappedNodes: Node[] = inputNodes.map((n) => {
      const pos = layoutPositions.positions.get(n.id);
      const stripe = n.selected ? 'var(--primary)' : n.accentColor || 'var(--border-strong)';
      return {
        id: n.id,
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        sourcePosition: direction === 'RIGHT' ? Position.Right : Position.Bottom,
        targetPosition: direction === 'RIGHT' ? Position.Left : Position.Top,
        data: {
          label: (
            <div className="text-left leading-snug">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text)] truncate">{n.label}</span>
                {n.badge && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--panel-sec)] text-[var(--text-sec)] shrink-0">
                    {n.badge}
                  </span>
                )}
              </div>
              {n.subtitle && (
                <div className="text-xs font-mono text-[var(--text-sec)] truncate mt-1">{n.subtitle}</div>
              )}
            </div>
          ),
        },
        style: {
          width: nodeWidth,
          minHeight: nodeHeight,
          padding: '10px 12px',
          borderRadius: '8px',
          backgroundColor: n.selected ? 'var(--selected-bg)' : 'var(--panel)',
          color: 'var(--text)',
          border: n.selected ? '1.5px solid var(--primary)' : '1px solid var(--border)',
          borderLeft: `3px solid ${stripe}`,
          opacity: n.dimmed ? 0.32 : 1,
          boxShadow: n.selected ? 'var(--shadow-sm)' : 'var(--shadow-xs)',
          cursor: 'pointer',
          transition: 'opacity 140ms ease, border-color 140ms ease, background-color 140ms ease',
        },
      };
    });

    const mappedEdges: Edge[] = inputEdges.map((e) => {
      const isDashed = e.kind === 'recommended' || e.kind === 'related';
      const isDotted = e.kind === 'extension' || e.kind === 'contrasts';
      const strokeColor = e.active
        ? 'var(--primary)'
        : e.kind === 'requires'
          ? 'var(--text-sec)'
          : e.kind === 'contrasts'
            ? 'var(--warning)'
            : 'var(--border-strong)';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        type: 'smoothstep',
        animated: Boolean(e.active),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: strokeColor,
        },
        style: {
          stroke: strokeColor,
          strokeWidth: e.active ? 2.2 : e.kind === 'requires' ? 1.6 : 1.25,
          strokeDasharray: isDashed ? '5 4' : isDotted ? '2 4' : undefined,
        },
        labelStyle: {
          fill: 'var(--text-sec)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        },
        labelBgStyle: {
          fill: 'var(--bg)',
        },
      };
    });

    setRfNodes(mappedNodes);
    setRfEdges(mappedEdges);
  }, [layoutPositions, topologyKey, inputNodes, inputEdges, direction, setRfNodes, setRfEdges]);

  return (
    <div className="w-full h-full min-h-0 bg-[var(--bg)]">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(inst) => {
          rfInstanceRef.current = inst;
          if (initialViewportRef.current) {
            inst.setViewport(initialViewportRef.current);
          } else {
            setTimeout(() => inst.fitView({ padding: 0.2, maxZoom: 1.05 }), 35);
          }
        }}
        onMoveEnd={(_ev, vp) => onViewportChange?.(vp)}
        onNodeClick={(_ev, node) => onNodeClick?.(node.id)}
        onNodeDoubleClick={(_ev, node) => onNodeDoubleClick?.(node.id)}
        fitView={!initialViewport}
        minZoom={0.25}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        {showMiniMap && <MiniMap zoomable pannable nodeColor={() => 'var(--primary)'} />}
      </ReactFlow>
    </div>
  );
}
