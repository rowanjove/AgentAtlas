import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { DOMAINS, ProgressStatus } from '@agent-atlas/shared';
import { apiGet } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { ElkFlowCanvas, LayoutEdgeInput, LayoutNodeInput } from '../components/ElkFlowCanvas';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Drawer, ErrorState, Select } from '../components/ui';

export function GlobalGraphPage() {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);
  const [domain, setDomain] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{
    nodes: Array<{ id: string; title: string; domain: string; status: ProgressStatus }>;
    edges: Array<{ fromId: string; toId: string; type: string }>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const url = domain ? `/api/graph?scope=global&domain=${encodeURIComponent(domain)}` : '/api/graph?scope=global';
    apiGet<typeof graph>(url)
      .then((res) => {
        if (!active) return;
        setError(null);
        setGraph(res);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '加载全局图谱失败');
      });
    return () => {
      active = false;
    };
  }, [domain, dataVersion]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph, selectedId],
  );

  const relatedEdges = useMemo(() => {
    if (!graph || !selectedId) return [];
    return graph.edges.filter((e) => e.fromId === selectedId || e.toId === selectedId);
  }, [graph, selectedId]);

  const flowNodes = useMemo<LayoutNodeInput[]>(() => {
    if (!graph) return [];
    return graph.nodes.map((n) => ({
      id: n.id,
      label: n.title,
      subtitle: n.domain,
      selected: n.id === selectedId,
      accentColor:
        n.status === 'read' || n.status === 'assessed'
          ? 'var(--success)'
          : n.status === 'needs_review'
            ? 'var(--warning)'
            : undefined,
    }));
  }, [graph, selectedId]);

  const flowEdges = useMemo<LayoutEdgeInput[]>(() => {
    if (!graph) return [];
    return graph.edges.map((e, i) => {
      const isRequires = e.type === 'requires';
      return {
        id: `gg-${i}`,
        source: isRequires ? e.toId : e.fromId,
        target: isRequires ? e.fromId : e.toId,
        label: isRequires ? '先修' : undefined,
        kind: e.type as 'requires' | 'related' | 'contrasts',
        active: selectedId ? e.fromId === selectedId || e.toId === selectedId : false,
      };
    });
  }, [graph, selectedId]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--panel)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold">全局知识网络图谱</h1>
          <Select aria-label="筛选知识域" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">全部域 ({graph?.nodes.length ?? 0} 节点)</option>
            {DOMAINS.filter((d) => d.id !== 'casebook').map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
          <span className="hidden sm:inline text-xs font-mono text-[var(--text-sec)]">
            {graph?.edges.length ?? 0} 条语义连线
          </span>
        </div>
        <Link to="/library">
          <Button size="sm" variant="outline">
            返回知识百科
          </Button>
        </Link>
      </div>

      {error && <ErrorState message={error} />}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          {graph && (
            <ElkFlowCanvas
              nodes={flowNodes}
              edges={flowEdges}
              onNodeClick={(id) => setSelectedId(id)}
            />
          )}
        </div>
        <Drawer
          open={Boolean(selectedNode)}
          onClose={() => setSelectedId(null)}
          title={selectedNode?.title ?? ''}
          subtitle={selectedNode?.id}
          width={rightPanelWidth}
          resizable
          onWidthChange={setRightPanelWidth}
        >
          {selectedNode && (
            <div className="p-4 space-y-4 text-[13px]">
              <div className="flex items-center justify-between">
                <StatusBadge status={selectedNode.status} />
                <span className="font-mono text-xs text-[var(--text-muted)]">{selectedNode.domain}</span>
              </div>
              <div className="space-y-1.5">
                <div className="font-medium text-[var(--text-sec)]">关联边 ({relatedEdges.length})</div>
                <ul className="space-y-1">
                  {relatedEdges.slice(0, 12).map((e, idx) => {
                    const otherId = e.fromId === selectedNode.id ? e.toId : e.fromId;
                    const otherTitle = graph?.nodes.find((n) => n.id === otherId)?.title ?? otherId;
                    return (
                      <li key={idx} className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--border)]">
                        <Link to={`/library/${encodeURIComponent(otherId)}`} className="hover:text-[var(--primary)] truncate">
                          {otherTitle}
                        </Link>
                        <span className="font-mono text-xs text-[var(--text-muted)] shrink-0">{e.type}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Link to={`/library/${encodeURIComponent(selectedNode.id)}`} className="block pt-2">
                <Button variant="primary" size="md" className="w-full" rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                  打开词条正文
                </Button>
              </Link>
            </div>
          )}
        </Drawer>
      </div>
    </div>
  );
}
