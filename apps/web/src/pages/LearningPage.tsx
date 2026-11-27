import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  List,
  Network,
  Plus,
  Search,
  AlertTriangle,
  ArrowRight,
  Clock,
  FlaskConical,
  Trash2,
  Pencil,
} from 'lucide-react';
import { ProgressStatus } from '@agent-atlas/shared';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { ElkFlowCanvas, LayoutEdgeInput, LayoutNodeInput } from '../components/ElkFlowCanvas';
import { StatusBadge } from '../components/StatusBadge';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Drawer,
  ErrorState,
  Input,
  Progress,
  Select,
  Switch,
  Tabs,
  toast,
} from '../components/ui';

interface PathSummary {
  id: string;
  title: string;
  enTitle: string;
  goal: string;
  estimatedHours: number;
  doneCount: number;
  assessedCount: number;
  requiredTotal: number;
  isCustom?: boolean;
  stages: Array<{ id: string; title: string; description?: string; nodeIds: string[] }>;
}

interface PathNodeDetail {
  id: string;
  slug: string;
  title: string;
  enTitle: string;
  summary: string;
  objectives: string[];
  domain: string;
  level: string;
  estimatedMinutes: number;
  requires: string[];
  related: string[];
  labIds: string[];
  requiredInPath: boolean;
  status: ProgressStatus;
  missingPrereqs: string[];
}

interface PathDetailResponse {
  path: {
    id: string;
    title: string;
    enTitle: string;
    goal: string;
    estimatedHours?: number;
    stages: Array<{ id: string; title: string; description?: string; nodeIds: string[] }>;
    requiredNodeIds: string[];
    optionalNodeIds: string[];
    extensionEdges: Array<{ fromId: string; toId: string; kind: 'recommended' | 'extension' }>;
    isCustom?: boolean;
  };
  nodes: PathNodeDetail[];
}

interface KnowledgeListItem {
  id: string;
  title: string;
  domain: string;
}

export function LearningPage() {
  const { pathId } = useParams<{ pathId?: string }>();
  const navigate = useNavigate();
  const roadmapState = useAppStore((s) => s.roadmap);
  const updateRoadmap = useAppStore((s) => s.updateRoadmap);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);
  const setPageBreadcrumb = useAppStore((s) => s.setPageBreadcrumb);
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion);
  const dataVersion = useAppStore((s) => s.dataVersion);

  const activePathId = pathId || roadmapState.selectedPathId || 'agent-foundations';

  const [paths, setPaths] = useState<{ presetPaths: PathSummary[]; customPaths: PathSummary[] } | null>(null);
  const [detail, setDetail] = useState<PathDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchNode, setSearchNode] = useState('');
  const [drawerOpenInGraph, setDrawerOpenInGraph] = useState(false);

  // Custom Path Dialog
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [allNodes, setAllNodes] = useState<KnowledgeListItem[]>([]);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customGoal, setCustomGoal] = useState('');
  const [selectedCustomNodes, setSelectedCustomNodes] = useState<string[]>([]);

  useEffect(() => {
    if (pathId && pathId !== roadmapState.selectedPathId) {
      updateRoadmap({ selectedPathId: pathId, viewport: null, focusedStageId: null });
    }
  }, [pathId, roadmapState.selectedPathId, updateRoadmap]);

  useEffect(() => {
    apiGet<{ presetPaths: PathSummary[]; customPaths: PathSummary[] }>('/api/paths')
      .then(setPaths)
      .catch((e) => setError(e instanceof Error ? e.message : '加载学习路径列表失败'));
  }, [dataVersion]);

  useEffect(() => {
    apiGet<PathDetailResponse>(`/api/paths/${encodeURIComponent(activePathId)}`)
      .then((res) => {
        setError(null);
        setDetail(res);
        setDrawerOpenInGraph(false);
        setPageBreadcrumb([{ label: '学习路线', to: '/learn' }, { label: res.path.title }]);
        if (!roadmapState.selectedNodeId || !res.nodes.some((n) => n.id === roadmapState.selectedNodeId)) {
          updateRoadmap({ selectedNodeId: res.nodes[0]?.id ?? null });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载路径详情失败'));
  }, [activePathId, dataVersion]);

  const nodeMap = useMemo(() => new Map((detail?.nodes ?? []).map((n) => [n.id, n])), [detail]);
  const selectedNode = roadmapState.selectedNodeId ? nodeMap.get(roadmapState.selectedNodeId) ?? null : null;

  const focusedNodeIds = useMemo(() => {
    if (!detail || !roadmapState.focusedStageId) return null;
    const st = detail.path.stages.find((s) => s.id === roadmapState.focusedStageId);
    return st ? new Set(st.nodeIds) : null;
  }, [detail, roadmapState.focusedStageId]);

  const visibleNodes = useMemo(() => {
    if (!detail) return [];
    return detail.nodes.filter((n) => {
      if (roadmapState.onlyRequired && !n.requiredInPath) return false;
      return true;
    });
  }, [detail, roadmapState.onlyRequired]);

  const graphData = useMemo(() => {
    if (!detail) return { nodes: [] as LayoutNodeInput[], edges: [] as LayoutEdgeInput[] };
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const q = searchNode.trim().toLowerCase();

    const nodes: LayoutNodeInput[] = visibleNodes.map((n) => {
      const accent =
        n.status === 'read' || n.status === 'assessed'
          ? 'var(--success)'
          : n.status === 'needs_review'
            ? 'var(--warning)'
            : n.status === 'in_progress'
              ? 'var(--primary)'
              : 'var(--border-strong)';
      const matchesQuery =
        !q || n.title.toLowerCase().includes(q) || n.enTitle.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
      const matchesStage = !focusedNodeIds || focusedNodeIds.has(n.id);
      return {
        id: n.id,
        label: n.title,
        subtitle: `${n.requiredInPath ? '必学' : '扩展'} · ${n.estimatedMinutes}m`,
        badge: n.status === 'assessed' ? '已自测' : n.status === 'read' ? '已读' : n.status === 'needs_review' ? '待复习' : undefined,
        accentColor: accent,
        selected: roadmapState.selectedNodeId === n.id,
        dimmed: !matchesQuery || !matchesStage,
      };
    });

    const edges: LayoutEdgeInput[] = [];
    const edgeSeen = new Set<string>();
    const addEdge = (fromId: string, toId: string, kind: LayoutEdgeInput['kind'], label?: string) => {
      if (!visibleIds.has(fromId) || !visibleIds.has(toId)) return;
      const key = `${fromId}->${toId}:${kind}`;
      if (edgeSeen.has(key)) return;
      edgeSeen.add(key);
      edges.push({ id: key, source: fromId, target: toId, kind, label });
    };

    for (const n of visibleNodes) {
      for (const req of n.requires) {
        addEdge(req, n.id, 'requires', '先修');
      }
    }
    for (const st of detail.path.stages) {
      for (let i = 0; i < st.nodeIds.length - 1; i++) {
        const a = st.nodeIds[i];
        const b = st.nodeIds[i + 1];
        if (!edgeSeen.has(`${a}->${b}:requires`)) {
          addEdge(a, b, 'recommended');
        }
      }
    }
    for (const ext of detail.path.extensionEdges ?? []) {
      addEdge(ext.fromId, ext.toId, ext.kind, ext.kind === 'extension' ? '扩展' : '推荐');
    }

    return { nodes, edges };
  }, [detail, visibleNodes, searchNode, focusedNodeIds, roadmapState.selectedNodeId]);

  const setStatus = async (nodeId: string, status: ProgressStatus) => {
    try {
      await apiMutate('PUT', `/api/progress/${encodeURIComponent(nodeId)}`, { status });
      bumpDataVersion();
      toast.success('学习状态已更新');
    } catch (e) {
      toast.error('更新学习状态失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const openCustomModal = async (editExisting = false) => {
    try {
      if (allNodes.length === 0) {
        const res = await apiGet<{ items: KnowledgeListItem[] }>('/api/knowledge');
        setAllNodes(res.items);
      }
      if (editExisting && detail?.path.isCustom) {
        setEditingCustomId(detail.path.id);
        setCustomTitle(detail.path.title);
        setCustomGoal(detail.path.goal);
        setSelectedCustomNodes(detail.path.stages.flatMap((s) => s.nodeIds));
      } else {
        setEditingCustomId(null);
        setCustomTitle('');
        setCustomGoal('');
        setSelectedCustomNodes([]);
      }
      setCustomModalOpen(true);
    } catch (e) {
      toast.error('加载知识节点失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const moveCustomNode = (idx: number, delta: -1 | 1) => {
    setSelectedCustomNodes((prev) => {
      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return copy;
    });
  };

  const saveCustomPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim() || selectedCustomNodes.length === 0) return;
    try {
      const created = await apiMutate<{ id: string }>('POST', '/api/custom-paths', {
        id: editingCustomId ?? undefined,
        title: customTitle.trim(),
        goal: customGoal.trim() || '自定义学习路径',
        stages: [{ id: 'custom-s1', title: '自定义学习阶段', nodeIds: selectedCustomNodes }],
      });
      setCustomModalOpen(false);
      setEditingCustomId(null);
      setCustomTitle('');
      setCustomGoal('');
      setSelectedCustomNodes([]);
      bumpDataVersion();
      toast.success('自定义学习路线已保存');
      navigate(`/learn/${encodeURIComponent(created.id)}`);
    } catch (e) {
      toast.error('保存自定义路线失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const deleteCustomPath = async () => {
    if (!detail?.path.isCustom) return;
    try {
      await apiMutate('DELETE', `/api/custom-paths/${encodeURIComponent(detail.path.id)}`);
      setConfirmDeleteOpen(false);
      bumpDataVersion();
      toast.info('已删除自定义路线');
      navigate('/learn/agent-foundations');
    } catch (e) {
      toast.error('删除自定义路线失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const allPathList = [...(paths?.presetPaths ?? []), ...(paths?.customPaths ?? [])];
  const requiredDone = detail
    ? detail.nodes.filter((n) => n.requiredInPath && (n.status === 'read' || n.status === 'assessed')).length
    : 0;
  const requiredTotal = detail?.path.requiredNodeIds.length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Control Toolbar */}
      <div className="border-b border-[var(--border)] bg-[var(--panel)] px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            aria-label="当前路线"
            value={activePathId}
            onChange={(e) => {
              updateRoadmap({ selectedPathId: e.target.value, viewport: null, focusedStageId: null });
              navigate(`/learn/${encodeURIComponent(e.target.value)}`);
            }}
          >
            {allPathList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.isCustom ? `[自定义] ${p.title}` : p.title} ({p.doneCount}/{p.requiredTotal})
              </option>
            ))}
          </Select>

          <Button size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => openCustomModal(false)}>
            自定义路线
          </Button>

          {detail?.path.isCustom && (
            <>
              <Button size="sm" variant="outline" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openCustomModal(true)}>
                编辑
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5 text-[var(--error)]" />} onClick={() => setConfirmDeleteOpen(true)}>
                删除
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {roadmapState.viewMode === 'graph' && (
            <div className="w-40">
              <Input
                type="search"
                controlSize="sm"
                leftIcon={<Search className="h-3.5 w-3.5" />}
                value={searchNode}
                onChange={(e) => setSearchNode(e.target.value)}
                placeholder="定位节点..."
              />
            </div>
          )}

          <Switch
            checked={roadmapState.onlyRequired}
            onChange={(checked) => updateRoadmap({ onlyRequired: checked })}
            label="只看必学"
          />

          <Tabs
            ariaLabel="路线展示模式"
            variant="segmented"
            value={roadmapState.viewMode}
            onChange={(next) => updateRoadmap({ viewMode: next })}
            items={[
              { id: 'list', label: '课程清单', icon: <List className="h-3.5 w-3.5" /> },
              { id: 'graph', label: '依赖关系图', icon: <Network className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {/* Main Content */}
      {roadmapState.viewMode === 'list' ? (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-[920px] mx-auto space-y-8">
            {detail && (
              <header className="pb-5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="space-y-1">
                  <h1 className="text-xl font-semibold tracking-tight">{detail.path.title}</h1>
                  <p className="text-sm text-[var(--text-sec)]">{detail.path.goal}</p>
                </div>
                <div className="w-full sm:w-48 shrink-0">
                  <Progress
                    value={requiredDone}
                    max={Math.max(1, requiredTotal)}
                    label={`必学 ${requiredDone}/${requiredTotal}`}
                    showPercent
                  />
                </div>
              </header>
            )}

            {detail?.path.stages.map((st, stageIdx) => {
              const stageNodes = st.nodeIds
                .map((id) => nodeMap.get(id))
                .filter((n): n is PathNodeDetail => Boolean(n) && (!roadmapState.onlyRequired || n!.requiredInPath));
              if (stageNodes.length === 0) return null;
              return (
                <section key={st.id} className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        阶段 {stageIdx + 1} · {st.title}
                      </h2>
                      {st.description && <p className="text-[13px] text-[var(--text-sec)] mt-0.5">{st.description}</p>}
                    </div>
                    <span className="text-xs font-mono text-[var(--text-muted)] shrink-0">{stageNodes.length} 节</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)] overflow-hidden">
                    {stageNodes.map((n, nodeIdx) => (
                      <div
                        key={n.id}
                        className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--panel-hover)] transition-colors"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="text-[13px] font-mono text-[var(--text-muted)] pt-0.5 shrink-0 w-7">
                            {stageIdx + 1}.{nodeIdx + 1}
                          </span>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                to={`/library/${encodeURIComponent(n.id)}`}
                                className="text-[15px] font-medium text-[var(--text)] hover:text-[var(--primary)] transition-colors"
                              >
                                {n.title}
                              </Link>
                              <Badge tone={n.requiredInPath ? 'primary' : 'neutral'}>
                                {n.requiredInPath ? '必学' : '选读'}
                              </Badge>
                              <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {n.estimatedMinutes}m
                              </span>
                            </div>
                            <p className="text-[13px] text-[var(--text-sec)] line-clamp-1">{n.summary}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 pl-10 sm:pl-0">
                          <StatusBadge status={n.status} />
                          {n.labIds.length > 0 && (
                            <Link to={`/lab/${encodeURIComponent(n.labIds[0])}`}>
                              <Button size="xs" variant="outline" leftIcon={<FlaskConical className="h-3 w-3 text-[var(--primary)]" />}>
                                实验
                              </Button>
                            </Link>
                          )}
                          <Link to={`/library/${encodeURIComponent(n.id)}`}>
                            <Button size="xs" variant="primary" rightIcon={<ArrowRight className="h-3 w-3" />}>
                              阅读
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        /* Graph View */
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {detail && (
              <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--panel-sec)] flex flex-wrap items-center justify-between gap-2 text-[13px] shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[var(--text-sec)] mr-1">聚焦阶段:</span>
                  <button
                    type="button"
                    onClick={() => updateRoadmap({ focusedStageId: null })}
                    className={`px-2 py-0.5 rounded-[var(--radius-xs)] border cursor-pointer transition-colors ${
                      !roadmapState.focusedStageId
                        ? 'border-[var(--primary)] bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                        : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text-sec)] hover:text-[var(--text)]'
                    }`}
                  >
                    全部
                  </button>
                  {detail.path.stages.map((st, idx) => {
                    const active = roadmapState.focusedStageId === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => updateRoadmap({ focusedStageId: active ? null : st.id })}
                        className={`px-2 py-0.5 rounded-[var(--radius-xs)] border cursor-pointer transition-colors ${
                          active
                            ? 'border-[var(--primary)] bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                            : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text-sec)] hover:text-[var(--text)]'
                        }`}
                      >
                        {idx + 1}. {st.title}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-[var(--text-sec)]">
                  <span>── 先修</span>
                  <span>- - 推荐</span>
                  <span>··· 扩展</span>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0">
              <ElkFlowCanvas
                nodes={graphData.nodes}
                edges={graphData.edges}
                direction="DOWN"
                initialViewport={roadmapState.viewport}
                onViewportChange={(vp) => updateRoadmap({ viewport: vp })}
                onNodeClick={(id) => {
                  updateRoadmap({ selectedNodeId: id });
                  setDrawerOpenInGraph(true);
                }}
                onNodeDoubleClick={(id) => navigate(`/library/${encodeURIComponent(id)}`)}
              />
            </div>
          </div>

          <Drawer
            open={drawerOpenInGraph && Boolean(selectedNode)}
            onClose={() => setDrawerOpenInGraph(false)}
            title={selectedNode?.title ?? '节点详情'}
            subtitle={selectedNode?.enTitle}
            width={rightPanelWidth}
            resizable
            onWidthChange={setRightPanelWidth}
          >
            {selectedNode && (
              <div className="p-4 space-y-4 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={selectedNode.status} />
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    约 {selectedNode.estimatedMinutes}m · {selectedNode.level}
                  </span>
                </div>

                {selectedNode.missingPrereqs.length > 0 && (
                  <div className="border border-[var(--warning)]/40 bg-[var(--warning-bg)] rounded-[var(--radius-sm)] p-2.5 space-y-1">
                    <div className="flex items-center gap-1 font-medium text-[var(--warning)]">
                      <AlertTriangle className="h-3.5 w-3.5" /> 建议前置知识
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.missingPrereqs.map((pid) => (
                        <Link key={pid} to={`/library/${encodeURIComponent(pid)}`} className="underline font-mono text-xs">
                          {pid}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="font-medium text-[var(--text-sec)]">简介</div>
                  <p className="leading-relaxed text-[var(--text)]">{selectedNode.summary}</p>
                </div>

                <div className="space-y-1">
                  <div className="font-medium text-[var(--text-sec)]">学习目标</div>
                  <ul className="space-y-1 list-disc pl-4 text-[var(--text)]">
                    {selectedNode.objectives.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-[var(--text-sec)]">更新状态</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['not_started', 'in_progress', 'read', 'needs_review'] as ProgressStatus[]).map((st) => (
                      <Button
                        key={st}
                        size="xs"
                        variant="outline"
                        active={selectedNode.status === st}
                        onClick={() => setStatus(selectedNode.id, st)}
                      >
                        {st === 'not_started' ? '未学习' : st === 'in_progress' ? '学习中' : st === 'read' ? '标为已读' : '需复习'}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border)] space-y-2">
                  <Link to={`/library/${encodeURIComponent(selectedNode.id)}`} className="block">
                    <Button variant="primary" size="md" className="w-full" rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                      进入阅读与自测
                    </Button>
                  </Link>
                  {selectedNode.labIds.length > 0 && (
                    <Link to={`/lab/${encodeURIComponent(selectedNode.labIds[0])}`} className="block">
                      <Button variant="outline" size="sm" className="w-full" leftIcon={<FlaskConical className="h-3.5 w-3.5 text-[var(--primary)]" />}>
                        打开配套实验
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Drawer>
        </div>
      )}

      {/* Custom Path Dialog */}
      <Dialog
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        title={editingCustomId ? '编辑自定义学习路线' : '创建自定义学习路线'}
        maxWidth="660px"
        footer={
          <>
            <Button variant="outline" onClick={() => setCustomModalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!customTitle.trim() || selectedCustomNodes.length === 0}
              onClick={saveCustomPath}
            >
              保存并打开路线
            </Button>
          </>
        }
      >
        <form onSubmit={saveCustomPath} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium space-y-1">
              <span>路线名称</span>
              <Input
                required
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="例如：本周安全与 MCP 专项"
              />
            </label>
            <label className="block text-xs font-medium space-y-1">
              <span>学习目标</span>
              <Input
                value={customGoal}
                onChange={(e) => setCustomGoal(e.target.value)}
                placeholder="简述目标工程能力"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[var(--text-sec)]">候选知识节点</div>
              <div className="max-h-52 overflow-y-auto border border-[var(--border)] rounded-[var(--radius-sm)] p-2 space-y-1 bg-[var(--bg)]">
                {allNodes.map((n) => {
                  const checked = selectedCustomNodes.includes(n.id);
                  return (
                    <Checkbox
                      key={n.id}
                      checked={checked}
                      onChange={() =>
                        setSelectedCustomNodes((prev) =>
                          checked ? prev.filter((id) => id !== n.id) : [...prev, n.id],
                        )
                      }
                      label={n.title}
                      className="w-full py-0.5"
                    />
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[var(--text-sec)]">
                已选顺序（{selectedCustomNodes.length} 个）
              </div>
              <div className="max-h-52 overflow-y-auto border border-[var(--border)] rounded-[var(--radius-sm)] p-2 space-y-1 bg-[var(--bg)]">
                {selectedCustomNodes.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)] py-6 text-center">从左侧勾选要加入的课程</div>
                ) : (
                  selectedCustomNodes.map((nid, idx) => (
                    <div
                      key={nid}
                      className="flex items-center justify-between gap-1 text-xs border border-[var(--border)] rounded-[var(--radius-xs)] px-2 py-1 bg-[var(--panel)]"
                    >
                      <span className="truncate font-mono text-[11px]">
                        {idx + 1}. {nid}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveCustomNode(idx, -1)}
                          disabled={idx === 0}
                          className="px-1.5 py-0.5 border border-[var(--border)] rounded disabled:opacity-30 cursor-pointer"
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCustomNode(idx, 1)}
                          disabled={idx === selectedCustomNodes.length - 1}
                          className="px-1.5 py-0.5 border border-[var(--border)] rounded disabled:opacity-30 cursor-pointer"
                          title="下移"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomNodes((prev) => prev.filter((id) => id !== nid))}
                          className="px-1 text-[var(--error)] cursor-pointer"
                          title="移除"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={deleteCustomPath}
        title="删除自定义路线"
        message={`确定删除「${detail?.path.title ?? ''}」吗？不会影响已记录的阅读进度和笔记。`}
        confirmLabel="删除"
        destructive
      />
    </div>
  );
}
