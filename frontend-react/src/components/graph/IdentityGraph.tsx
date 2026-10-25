/**
 * IdentityGraph — Cytoscape.js-based identity network visualization.
 *
 * Data: GET /api/results/:id/graph → { scan, graph: { nodes[], edges[] } }
 *
 * Node colors and shapes from graph_builder.py NODE_COLORS / NODE_SHAPES
 * (preserved exactly from old graph.js):
 *   name: purple #8b5cf6 diamond
 *   email: blue #3b82f6 round-rectangle
 *   phone: red #ef4444 triangle
 *   username: green #10b981 ellipse
 *   platform: amber #f59e0b hexagon
 *   url: gray #6b7280 rectangle
 *   repository: pink #ec4899 barrel
 *   breach: deep-red #dc2626 octagon
 *   metadata: teal #14b8a6 tag
 *   document: cyan #06b6d4 round-rectangle
 *   event: violet #a855f7 star
 *
 * Features preserved from old graph.js:
 *   - Cytoscape cose layout (default)
 *   - Zoom in / out / fit-to-screen
 *   - Node selection → detail panel (type, label, risk_level)
 *   - Toggle node labels
 *   - Toggle edge labels (relationship text)
 *   - Export PNG
 *   - Layout selector (cose, breadthfirst, circle, grid)
 *   - Legend panel
 *   - Edge width proportional to confidence
 *
 * Cleanup: Cytoscape instance is destroyed on unmount.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import CytoscapeLib from 'cytoscape';
import type { Core, NodeSingular } from 'cytoscape';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/shared/Badge';
import type { CytoscapeGraph, GraphNodeData, RiskLevel } from '@/types';

// ── Node colours from backend graph_builder.py NODE_COLORS ───────────────────
const NODE_COLORS: Record<string, string> = {
  name:       '#8b5cf6',
  email:      '#3b82f6',
  phone:      '#ef4444',
  username:   '#10b981',
  platform:   '#f59e0b',
  url:        '#6b7280',
  repository: '#ec4899',
  breach:     '#dc2626',
  metadata:   '#14b8a6',
  document:   '#06b6d4',
  event:      '#a855f7',
};

const NODE_SHAPES: Record<string, string> = {
  name:       'diamond',
  email:      'round-rectangle',
  phone:      'triangle',
  username:   'ellipse',
  platform:   'hexagon',
  url:        'rectangle',
  repository: 'ellipse',
  breach:     'octagon',
  metadata:   'tag',
  document:   'round-rectangle',
  event:      'star',
};

const LAYOUTS = ['cose', 'breadthfirst', 'circle', 'grid'] as const;
type LayoutName = (typeof LAYOUTS)[number];

interface IdentityGraphProps {
  graph: CytoscapeGraph;
  scanId: number;
}

interface SelectedNode {
  data: GraphNodeData;
}

export function IdentityGraph({ graph, scanId }: IdentityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [layout, setLayout] = useState<LayoutName>('cose');
  const [showLegend, setShowLegend] = useState(true);

  // Build Cytoscape stylesheet
  const buildStylesheet = useCallback(() => [
    {
      selector: 'node',
      style: {
        'background-color': (ele: NodeSingular) =>
          NODE_COLORS[ele.data('type') as string] ?? '#6b7280',
        'shape': (ele: NodeSingular) =>
          NODE_SHAPES[ele.data('type') as string] ?? 'ellipse',
        'label': showLabels ? 'data(label)' : '',
        'color': '#f8fafc',
        'font-size': 10,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 4,
        'width': 28,
        'height': 28,
        'border-width': 2,
        'border-color': 'rgba(255,255,255,0.15)',
      } as CytoscapeLib.Css.Node,
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#60a5fa',
        'border-opacity': 1,
      } as CytoscapeLib.Css.Node,
    },
    {
      selector: 'edge',
      style: {
        'width': (ele: CytoscapeLib.EdgeSingular) =>
          1 + (ele.data('confidence') as number) * 3,
        'line-color': 'rgba(148,163,184,0.4)',
        'target-arrow-color': 'rgba(148,163,184,0.4)',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': showEdgeLabels ? 'data(relationship)' : '',
        'font-size': 9,
        'color': '#94a3b8',
        'text-rotation': 'autorotate',
      } as CytoscapeLib.Css.Edge,
    },
    {
      selector: 'node.highlighted',
      style: { 'opacity': 1 } as CytoscapeLib.Css.Node,
    },
    {
      selector: 'node.faded',
      style: { 'opacity': 0.2 } as CytoscapeLib.Css.Node,
    },
    {
      selector: 'edge.faded',
      style: { 'opacity': 0.1 } as CytoscapeLib.Css.Edge,
    },
  ], [showLabels, showEdgeLabels]);

  // Init/reinit Cytoscape
  useEffect(() => {
    if (!containerRef.current || graph.nodes.length === 0) return;

    // Destroy previous instance
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const cy = CytoscapeLib({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((n) => ({ data: n.data })),
        ...graph.edges.map((e) => ({ data: e.data })),
      ],
      style: buildStylesheet() as CytoscapeLib.StylesheetStyle[],
      layout: {
        name: layout,
        animate: true,
        animationDuration: 600,
        padding: 40,
        nodeRepulsion: () => 6000,
        idealEdgeLength: () => 80,
        gravity: 0.3,
      },
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 5,
    });

    // Node click → show detail, highlight neighbourhood
    cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      setSelectedNode({ data: node.data() as GraphNodeData });

      cy.elements().removeClass('highlighted faded');
      const neighbourhood = node.closedNeighborhood();
      cy.elements().not(neighbourhood).addClass('faded');
      neighbourhood.addClass('highlighted');
    });

    // Background click → clear selection
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        cy.elements().removeClass('highlighted faded');
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout]);

  // Re-apply stylesheet when label toggles change (without re-building the graph)
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.style(buildStylesheet() as CytoscapeLib.StylesheetStyle[]).update();
  }, [showLabels, showEdgeLabels, buildStylesheet]);

  function zoomIn()  { cyRef.current?.zoom(cyRef.current.zoom() * 1.3); }
  function zoomOut() { cyRef.current?.zoom(cyRef.current.zoom() / 1.3); }
  function fitView() { cyRef.current?.fit(undefined, 40); }

  function exportPNG() {
    if (!cyRef.current) return;
    const png = cyRef.current.png({ scale: 2, bg: '#050816', full: true });
    const a = document.createElement('a');
    a.download = `dfas_graph_${scanId}.png`;
    a.href = png;
    a.click();
  }

  function changeLayout(name: LayoutName) {
    setLayout(name);
    if (!cyRef.current) return;
    cyRef.current.layout({
      name,
      animate: true,
      animationDuration: 800,
      padding: 40,
      nodeRepulsion: () => 6000,
      idealEdgeLength: () => 80,
      gravity: 0.3,
    }).run();
  }

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        title="No graph data"
        description="The identity graph has no nodes yet. Run a full scan to generate a graph."
      />
    );
  }

  const uniqueNodeTypes = [...new Set(graph.nodes.map((n) => n.data.type))];

  return (
    <div className="flex h-[600px] flex-col gap-0 rounded-xl border border-white/[0.07] bg-[#050816] overflow-hidden">
      {/* ── Controls toolbar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-3 py-2">
        {/* Layout selector */}
        <select
          id="graph-layout-select"
          value={layout}
          onChange={(e) => changeLayout(e.target.value as LayoutName)}
          className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-text-secondary border border-white/[0.08] outline-none focus:border-accent-blue/40"
          aria-label="Graph layout"
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
          ))}
        </select>

        <div className="flex gap-1">
          <ControlBtn id="btn-zoom-in" onClick={zoomIn} title="Zoom in">+</ControlBtn>
          <ControlBtn id="btn-zoom-out" onClick={zoomOut} title="Zoom out">−</ControlBtn>
          <ControlBtn id="btn-graph-fit" onClick={fitView} title="Fit to screen">⊡</ControlBtn>
        </div>

        <ControlBtn
          id="btn-toggle-labels"
          onClick={() => setShowLabels((v) => !v)}
          active={showLabels}
          title="Toggle node labels"
        >
          Labels
        </ControlBtn>
        <ControlBtn
          id="btn-toggle-edge-labels"
          onClick={() => setShowEdgeLabels((v) => !v)}
          active={showEdgeLabels}
          title="Toggle edge labels"
        >
          Edge labels
        </ControlBtn>
        <ControlBtn
          id="btn-toggle-legend"
          onClick={() => setShowLegend((v) => !v)}
          active={showLegend}
          title="Toggle legend"
        >
          Legend
        </ControlBtn>
        <ControlBtn id="btn-export-png" onClick={exportPNG} title="Export as PNG">↓ PNG</ControlBtn>

        {/* Stats */}
        <span className="ml-auto text-[10px] text-text-tertiary">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
      </div>

      {/* ── Main area ─────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {/* Cytoscape canvas */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend overlay */}
        {showLegend && (
          <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-white/[0.09] bg-black/70 p-3 backdrop-blur-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Node Types</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {uniqueNodeTypes.map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[t] ?? '#6b7280' }}
                  />
                  <span className="text-[10px] capitalize text-text-secondary">{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node detail panel */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode.data}
            onClose={() => {
              setSelectedNode(null);
              cyRef.current?.elements().removeClass('highlighted faded');
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ControlBtn({
  id,
  onClick,
  children,
  active,
  title,
}: {
  id: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-accent-blue/20 text-accent-blue'
          : 'bg-white/[0.06] text-text-tertiary hover:bg-white/[0.10] hover:text-text-secondary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function NodeDetailPanel({
  node,
  onClose,
}: {
  node: GraphNodeData;
  onClose: () => void;
}) {
  const color = NODE_COLORS[node.type as string] ?? '#6b7280';

  return (
    <div
      id="node-detail-panel"
      className="absolute right-3 top-3 z-10 w-56 rounded-lg border border-white/[0.09] bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold capitalize text-text-primary">{node.type}</span>
        </div>
        <button
          id="panel-close"
          type="button"
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <p className="text-sm font-medium text-text-primary break-all leading-tight mb-2">
        {node.label}
      </p>

      {node.risk_level && (
        <div className="mb-2">
          <Badge variant={node.risk_level as RiskLevel}>{node.risk_level}</Badge>
        </div>
      )}

      <div className="space-y-1">
        {Object.entries(node)
          .filter(([k]) => !['id', 'type', 'label', 'risk_level'].includes(k))
          .slice(0, 5)
          .map(([k, v]) => (
            <div key={k} className="text-[10px]">
              <span className="text-text-tertiary capitalize">{k}: </span>
              <span className="text-text-secondary">
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
