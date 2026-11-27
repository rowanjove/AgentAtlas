import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bookmark,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  ListTree,
  Network,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import {
  AssessmentQuestion,
  GlossaryTerm,
  KnowledgeNode,
  ProgressStatus,
  SourceEntry,
} from '@agent-atlas/shared';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { StatusBadge } from '../components/StatusBadge';
import { ElkFlowCanvas, LayoutEdgeInput, LayoutNodeInput } from '../components/ElkFlowCanvas';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Radio,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Tree,
  toast,
} from '../components/ui';

interface SearchNodeItem {
  id: string;
  title: string;
  enTitle: string;
  domain: string;
  type: string;
  level: string;
  summary: string;
  status: ProgressStatus;
  snippet: string;
}

interface RelatedNodeItem {
  nodeId: string;
  title: string;
  domain: string;
  relationType: string;
  direction: 'incoming' | 'outgoing';
  status: ProgressStatus;
}

interface NodeDetailResponse {
  node: KnowledgeNode;
  progress: { nodeId: string; status: ProgressStatus; lastReadAt: string | null; readRevision: number };
  isBookmarked: boolean;
  notes: Array<{ id: string; nodeId: string; body: string; updatedAt: string }>;
  sources: SourceEntry[];
  assessments: AssessmentQuestion[];
  labs: Array<{ id: string; title: string }>;
  relatedNodes: RelatedNodeItem[];
}

interface LocalGraphResponse {
  nodes: Array<{ id: string; title: string; domain: string; status: ProgressStatus }>;
  edges: Array<{ fromId: string; toId: string; type: string }>;
}

const REL_PRIORITY: Record<string, number> = {
  requires: 1,
  contrasts: 2,
  implements: 3,
  'example-of': 4,
  supersedes: 5,
  related: 6,
};

const LEVEL_ZH: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高阶',
};

function highlightMatch(text: string, q: string) {
  const clean = q.trim();
  if (!clean) return text;
  const idx = text.toLowerCase().indexOf(clean.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + clean.length)}</mark>
      {text.slice(idx + clean.length)}
    </>
  );
}

export function LibraryPage() {
  const { nodeId } = useParams<{ nodeId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion);
  const openTutor = useAppStore((s) => s.openTutor);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);
  const setPageBreadcrumb = useAppStore((s) => s.setPageBreadcrumb);

  const [focusMode, setFocusMode] = useState(false);
  const [rightPanel, setRightPanel] = useState<'none' | 'toc' | 'graph' | 'meta'>('none');
  const [leftTab, setLeftTab] = useState<'tree' | 'glossary'>('tree');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [domainFilter, setDomainFilter] = useState(searchParams.get('domain') ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState<SearchNodeItem[]>([]);
  const [domains, setDomains] = useState<Array<{ id: string; title: string }>>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);

  const [detail, setDetail] = useState<NodeDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeHeading, setActiveHeading] = useState<string>('');
  const [expandedTermId, setExpandedTermId] = useState<string | null>(null);
  const [localGraph, setLocalGraph] = useState<LocalGraphResponse | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [attemptResults, setAttemptResults] = useState<Record<string, { isCorrect: boolean }>>({});
  const [hoverPreview, setHoverPreview] = useState<{ item: SearchNodeItem; top: number; left: number } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastLoggedNodeRef = useRef<string | null>(null);

  useEffect(() => {
    const qParam = searchParams.get('q') ?? '';
    const dParam = searchParams.get('domain') ?? '';
    setQuery(qParam);
    setDomainFilter(dParam);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const url = `/api/knowledge?q=${encodeURIComponent(query)}&domain=${encodeURIComponent(domainFilter)}&status=${encodeURIComponent(statusFilter)}`;
    apiGet<{ items: SearchNodeItem[]; domains: Array<{ id: string; title: string }> }>(url)
      .then((res) => {
        if (!active) return;
        setLoadError(null);
        setItems(res.items);
        setDomains(res.domains);
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : '加载目录失败');
      });
    return () => {
      active = false;
    };
  }, [query, domainFilter, statusFilter, dataVersion]);

  useEffect(() => {
    if (!nodeId && items.length > 0) {
      navigate(`/library/${encodeURIComponent(items[0].id)}`, { replace: true });
    }
  }, [nodeId, items, navigate]);

  useEffect(() => {
    apiGet<{ items: GlossaryTerm[] }>('/api/glossary')
      .then((r) => setGlossary(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedAnswers({});
    setAttemptResults({});
    setExpandedTermId(null);
    setHoverPreview(null);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    let active = true;
    apiGet<NodeDetailResponse>(`/api/knowledge/${encodeURIComponent(nodeId)}`)
      .then((res) => {
        if (!active) return;
        setLoadError(null);
        setDetail(res);
        setPageBreadcrumb([
          { label: '知识百科', to: '/library' },
          { label: res.node.title },
        ]);
        if (lastLoggedNodeRef.current !== res.node.id) {
          lastLoggedNodeRef.current = res.node.id;
          apiMutate('POST', '/api/reading-history', { nodeId: res.node.id }).catch(() => {});
        }
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : '加载知识节点失败');
      });
    apiGet<LocalGraphResponse>(`/api/graph?scope=local&nodeId=${encodeURIComponent(nodeId)}&depth=2`)
      .then((res) => {
        if (active) setLocalGraph(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [nodeId, dataVersion, setPageBreadcrumb]);

  useEffect(() => {
    if (!detail) return;
    const headings = Array.from(document.querySelectorAll('article.mx-auto h2[id], article.mx-auto h3[id]'));
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible?.target.id) {
          setActiveHeading(visible.target.id);
        }
      },
      { rootMargin: '-72px 0px -65% 0px', threshold: 0.1 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [detail]);

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const inlineTerms = useMemo(() => {
    if (!detail || glossary.length === 0) return [];
    const haystack = `${detail.node.title} ${detail.node.summary} ${detail.node.body}`.toLowerCase();
    return glossary
      .filter((g) => g.nodeId === detail.node.id || haystack.includes(g.term.toLowerCase()) || haystack.includes(g.zhTerm.toLowerCase()))
      .slice(0, 6);
  }, [detail, glossary]);

  const dedupedRelated = useMemo(() => {
    if (!detail) return [];
    const best = new Map<string, RelatedNodeItem>();
    for (const r of detail.relatedNodes) {
      const existing = best.get(r.nodeId);
      if (!existing || (REL_PRIORITY[r.relationType] ?? 99) < (REL_PRIORITY[existing.relationType] ?? 99)) {
        best.set(r.nodeId, r);
      }
    }
    return [...best.values()];
  }, [detail]);

  const currentIdx = useMemo(() => items.findIndex((i) => i.id === detail?.node.id), [items, detail?.node.id]);
  const prevNode = currentIdx > 0 ? items[currentIdx - 1] : null;
  const nextNode = currentIdx >= 0 && currentIdx < items.length - 1 ? items[currentIdx + 1] : null;

  const treeGroups = useMemo(() => {
    const map = new Map<string, SearchNodeItem[]>();
    for (const item of items) {
      const list = map.get(item.domain) ?? [];
      list.push(item);
      map.set(item.domain, list);
    }
    return domains
      .filter((d) => map.has(d.id))
      .map((d) => {
        const list = map.get(d.id) ?? [];
        const hasActive = list.some((it) => it.id === nodeId);
        return {
          id: d.id,
          label: d.title,
          meta: String(list.length),
          defaultOpen: hasActive || Boolean(query.trim()) || Boolean(domainFilter),
          children: list.map((it) => {
            const dotColor =
              it.status === 'read' || it.status === 'assessed'
                ? 'bg-[var(--success)]'
                : it.status === 'needs_review'
                  ? 'bg-[var(--warning)]'
                  : it.status === 'in_progress'
                    ? 'bg-[var(--primary)]'
                    : null;
            return {
              id: it.id,
              label: it.title,
              to: `/library/${encodeURIComponent(it.id)}`,
              active: nodeId === it.id,
              trailing: dotColor ? <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} /> : undefined,
            };
          }),
        };
      });
  }, [domains, items, nodeId, query, domainFilter]);

  const localFlowData = useMemo(() => {
    if (!localGraph || !detail) {
      return { nodes: [] as LayoutNodeInput[], edges: [] as LayoutEdgeInput[] };
    }
    return {
      nodes: localGraph.nodes.map((n) => ({
        id: n.id,
        label: n.title,
        selected: n.id === detail.node.id,
      })),
      edges: localGraph.edges.map((e, idx) => {
        const isRequires = e.type === 'requires';
        return {
          id: `lg-${idx}`,
          source: isRequires ? e.toId : e.fromId,
          target: isRequires ? e.fromId : e.toId,
          label: isRequires ? '先修' : undefined,
          kind: e.type as 'requires' | 'related' | 'contrasts',
        };
      }),
    };
  }, [localGraph, detail]);

  const markStatus = async (status: ProgressStatus) => {
    if (!detail) return;
    try {
      await apiMutate('PUT', `/api/progress/${encodeURIComponent(detail.node.id)}`, { status });
      bumpDataVersion();
      toast.success(status === 'read' ? '已标记为已阅读' : '已标记为待复习');
    } catch (e) {
      toast.error('更新状态失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const toggleBookmark = async () => {
    if (!detail) return;
    const next = !detail.isBookmarked;
    try {
      await apiMutate('POST', `/api/bookmarks/${encodeURIComponent(detail.node.id)}`, { active: next });
      bumpDataVersion();
      toast.info(next ? '已加入收藏夹' : '已移出收藏夹');
    } catch (e) {
      toast.error('收藏操作失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !noteInput.trim()) return;
    try {
      await apiMutate('POST', '/api/notes', { nodeId: detail.node.id, body: noteInput.trim() });
      setNoteInput('');
      bumpDataVersion();
      toast.success('笔记已保存到本地');
    } catch (e) {
      toast.error('保存笔记失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await apiMutate('DELETE', `/api/notes/${encodeURIComponent(id)}`);
      bumpDataVersion();
      toast.info('已删除笔记');
    } catch (e) {
      toast.error('删除笔记失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const submitQuiz = async (q: AssessmentQuestion) => {
    const opt = selectedAnswers[q.id];
    if (!opt) return;
    try {
      const res = await apiMutate<{ isCorrect: boolean }>('POST', `/api/assessments/${encodeURIComponent(q.id)}/attempt`, {
        selectedOptionId: opt,
      });
      setAttemptResults((prev) => ({ ...prev, [q.id]: { isCorrect: res.isCorrect } }));
      bumpDataVersion();
    } catch (e) {
      toast.error('提交自测失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const toggleRightPanel = (panel: 'toc' | 'graph' | 'meta') => {
    setRightPanel((cur) => (cur === panel ? 'none' : panel));
  };

  const handleArticlePointerOver = (e: React.MouseEvent<HTMLElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href^="/library/"]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const targetId = decodeURIComponent(href.slice('/library/'.length).split(/[?#]/)[0]);
    const matched = itemById.get(targetId);
    if (!matched) return;
    const rect = anchor.getBoundingClientRect();
    setHoverPreview({
      item: matched,
      top: Math.min(window.innerHeight - 130, rect.bottom + 8),
      left: Math.min(window.innerWidth - 310, Math.max(16, rect.left)),
    });
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left Knowledge Tree & Glossary */}
      {!focusMode && (
        <aside className="w-[248px] shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col overflow-hidden">
          <div className="px-3 pt-2 border-b border-[var(--border)] space-y-2.5 pb-2.5">
            <Tabs
              ariaLabel="目录与词典切换"
              variant="segmented"
              value={leftTab}
              onChange={setLeftTab}
              className="w-full"
              items={[
                { id: 'tree', label: '目录', count: items.length },
                { id: 'glossary', label: '术语', count: glossary.length },
              ]}
            />

            {leftTab === 'tree' && (
              <div className="space-y-2">
                <Input
                  type="search"
                  controlSize="xs"
                  leftIcon={<Search className="h-3.5 w-3.5" />}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (e.target.value) next.set('q', e.target.value);
                      else next.delete('q');
                      return next;
                    });
                  }}
                  placeholder="筛选知识点..."
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <Select
                    aria-label="筛选知识域"
                    controlSize="xs"
                    className="w-full"
                    value={domainFilter}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDomainFilter(val);
                      setSearchParams((prev) => {
                        const next = new URLSearchParams(prev);
                        if (val) next.set('domain', val);
                        else next.delete('domain');
                        return next;
                      });
                    }}
                  >
                    <option value="">全部域</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="筛选状态"
                    controlSize="xs"
                    className="w-full"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">全部状态</option>
                    <option value="not_started">未学习</option>
                    <option value="read">已阅读</option>
                    <option value="assessed">已自测</option>
                    <option value="needs_review">需复习</option>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5">
            {leftTab === 'tree' ? (
              query.trim() ? (
                items.length === 0 ? (
                  <EmptyState title="无匹配词条" description="请尝试缩短或更换检索词。" />
                ) : (
                  <div className="space-y-1">
                    {items.map((item) => (
                      <Link
                        key={item.id}
                        to={`/library/${encodeURIComponent(item.id)}`}
                        className={`block px-2.5 py-2 rounded-[var(--radius-xs)] text-[13px] transition-colors ${
                          nodeId === item.id
                            ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                            : 'hover:bg-[var(--panel-sec)] text-[var(--text)]'
                        }`}
                      >
                        <div className="truncate font-medium">{highlightMatch(item.title, query)}</div>
                        {item.snippet && (
                          <div className="text-xs text-[var(--text-sec)] line-clamp-2 mt-0.5">
                            {highlightMatch(item.snippet.replace(/<\/?mark>/g, ''), query)}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                )
              ) : (
                <Tree groups={treeGroups} />
              )
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {glossary.map((g) => (
                  <div key={g.id} className="py-2.5 text-[13px] space-y-1">
                    <div className="font-medium text-[var(--text)]">
                      {g.zhTerm} <span className="font-mono text-xs text-[var(--text-muted)] font-normal">/ {g.term}</span>
                    </div>
                    <p className="text-[var(--text-sec)] leading-relaxed">{g.definition}</p>
                    {g.controversyNotes && (
                      <p className="text-xs text-[var(--warning)]">辨析：{g.controversyNotes}</p>
                    )}
                    {g.nodeId && (
                      <Link to={`/library/${encodeURIComponent(g.nodeId)}`} className="inline-block text-[var(--primary)] hover:underline">
                        主词条 →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Center Editorial Reading Canvas */}
      <div ref={scrollContainerRef} className="flex-1 min-w-0 overflow-y-auto px-6 md:px-10 py-6">
        {loadError && <ErrorState message={loadError} />}

        {!detail && !loadError && (
          <div className="mx-auto space-y-4" style={{ maxWidth: 'var(--reader-width)' }}>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-56 w-full" />
          </div>
        )}

        {detail && (
          <article
            className="mx-auto space-y-8"
            style={{ maxWidth: 'var(--reader-width)' }}
            onMouseOver={handleArticlePointerOver}
            onMouseLeave={() => setHoverPreview(null)}
          >
            {/* Top Context Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 text-[13px] text-[var(--text-sec)]">
                <span>{LEVEL_ZH[detail.node.level] ?? detail.node.level}</span>
                <span>·</span>
                <span>约 {detail.node.estimatedMinutes} 分钟</span>
                <span>·</span>
                <StatusBadge status={detail.progress.status} />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  size="xs"
                  variant="outline"
                  active={rightPanel === 'toc'}
                  leftIcon={<ListTree className="h-3.5 w-3.5" />}
                  onClick={() => toggleRightPanel('toc')}
                >
                  目录
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  active={rightPanel === 'graph'}
                  leftIcon={<Network className="h-3.5 w-3.5" />}
                  onClick={() => toggleRightPanel('graph')}
                >
                  关联图谱
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  active={rightPanel === 'meta'}
                  onClick={() => toggleRightPanel('meta')}
                >
                  来源与关联 ({dedupedRelated.length})
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  leftIcon={focusMode ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  onClick={() => setFocusMode((v) => !v)}
                  title="切换沉浸阅读模式"
                >
                  {focusMode ? '退出专注' : '专注'}
                </Button>
              </div>
            </div>

            {/* Editorial Document Header */}
            <header className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <h1 className="text-[26px] font-semibold tracking-tight leading-snug text-[var(--text)]">
                    {detail.node.title}
                  </h1>
                  <p className="text-[13px] font-mono text-[var(--text-muted)]">
                    {detail.node.id} · {detail.node.enTitle}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    active={detail.isBookmarked}
                    leftIcon={<Bookmark className="h-3.5 w-3.5" />}
                    onClick={toggleBookmark}
                  >
                    {detail.isBookmarked ? '已收藏' : '收藏'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />}
                    onClick={() => openTutor(detail.node.id)}
                  >
                    问导师
                  </Button>
                </div>
              </div>

              {detail.labs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {detail.labs.map((lab) => (
                    <Link key={lab.id} to={`/lab/${encodeURIComponent(lab.id)}`}>
                      <Badge tone="primary" className="px-2.5 py-1 text-xs hover:underline">
                        <FlaskConical className="h-3.5 w-3.5" />
                        <span>配套互动实验：{lab.title} →</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </header>

            {/* Flat Inline Glossary Reference */}
            {inlineTerms.length > 0 && (
              <section className="py-3.5 px-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] space-y-2.5">
                <div className="text-[13px] font-medium text-[var(--text-sec)]">本篇核心术语速查</div>
                <div className="flex flex-wrap gap-1.5">
                  {inlineTerms.map((term) => {
                    const isOpen = expandedTermId === term.id;
                    return (
                      <Button
                        key={term.id}
                        size="xs"
                        variant="outline"
                        active={isOpen}
                        onClick={() => setExpandedTermId(isOpen ? null : term.id)}
                      >
                        {term.zhTerm} · {term.term}
                      </Button>
                    );
                  })}
                </div>
                {expandedTermId && (() => {
                  const activeTerm = inlineTerms.find((t) => t.id === expandedTermId);
                  if (!activeTerm) return null;
                  return (
                    <div className="text-[13px] border-t border-[var(--border)] pt-2.5 space-y-1">
                      <div className="font-medium text-[var(--text)]">
                        {activeTerm.zhTerm} ({activeTerm.term})
                      </div>
                      <p className="text-[var(--text-sec)] leading-relaxed">{activeTerm.definition}</p>
                      {activeTerm.controversyNotes && (
                        <p className="text-xs text-[var(--warning)]">辨析：{activeTerm.controversyNotes}</p>
                      )}
                    </div>
                  );
                })()}
              </section>
            )}

            {/* Main Markdown Prose (No Card Boxing) */}
            <MarkdownRenderer content={detail.node.body} />

            {/* Clean Divider Completion Bar */}
            <section className="pt-6 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-[var(--text-sec)]">记录当前词条学习状态</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={() => markStatus('read')}
                >
                  标记已阅读
                </Button>
                <Button size="sm" variant="outline" onClick={() => markStatus('needs_review')}>
                  标记待复习
                </Button>
              </div>
            </section>

            {/* Editorial Inline Self-Assessment */}
            {detail.assessments.length > 0 && (
              <section className="pt-6 border-t border-[var(--border)] space-y-5">
                <div>
                  <h2 className="text-[17px] font-semibold">理解与工程判断自测</h2>
                  <p className="text-[13px] text-[var(--text-sec)] mt-0.5">
                    答对将更新为「已自测」，错题自动收录至错题本。
                  </p>
                </div>
                {detail.assessments.map((q) => {
                  const chosen = selectedAnswers[q.id];
                  const outcome = attemptResults[q.id];
                  return (
                    <div key={q.id} className="space-y-3">
                      <p className="text-sm font-medium leading-relaxed">{q.prompt}</p>
                      <div className="space-y-2">
                        {q.options.map((opt) => (
                          <div
                            key={opt.id}
                            className={`rounded-[var(--radius-sm)] border px-3.5 py-2.5 transition-colors ${
                              chosen === opt.id
                                ? 'border-[var(--primary)] bg-[var(--selected-bg)]'
                                : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]'
                            }`}
                          >
                            <Radio
                              name={q.id}
                              checked={chosen === opt.id}
                              onChange={() => setSelectedAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                              label={<span className="leading-relaxed">{opt.text}</span>}
                            />
                          </div>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!chosen}
                        onClick={() => submitQuiz(q)}
                      >
                        提交判断
                      </Button>
                      {outcome && (
                        <div
                          className={`p-3.5 rounded-[var(--radius-sm)] border text-[13px] space-y-1 ${
                            outcome.isCorrect
                              ? 'border-[var(--success)]/45 bg-[var(--success-bg)]'
                              : 'border-[var(--error)]/45 bg-[var(--error-bg)]'
                          }`}
                        >
                          <div className="font-semibold">
                            {outcome.isCorrect ? '判断正确 · 节点已更新为「已自测」' : '判断有误 · 已记入错题复习本'}
                          </div>
                          <p className="leading-relaxed text-[var(--text)]">{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Personal Engineering Notes */}
            <section className="pt-6 border-t border-[var(--border)] space-y-3 text-[13px]">
              <h2 className="text-base font-semibold flex items-center gap-1.5">
                <StickyNote className="h-4 w-4 text-[var(--primary)]" /> 个人工程笔记
              </h2>
              <form onSubmit={addNote} className="space-y-2.5">
                <Textarea
                  rows={3}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="记录工程判断、实战疑惑或反例批注..."
                />
                <Button type="submit" size="sm" variant="primary" disabled={!noteInput.trim()}>
                  保存笔记到本地
                </Button>
              </form>
              {detail.notes.length > 0 && (
                <div className="divide-y divide-[var(--border)] border-t border-[var(--border)] pt-2">
                  {detail.notes.map((n) => (
                    <div key={n.id} className="py-3 space-y-1.5">
                      <p className="whitespace-pre-wrap leading-relaxed text-sm">{n.body}</p>
                      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span>{new Date(n.updatedAt).toLocaleString()}</span>
                        <Button
                          size="xs"
                          variant="ghost"
                          leftIcon={<Trash2 className="h-3 w-3 text-[var(--error)]" />}
                          onClick={() => deleteNote(n.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Prev / Next Editorial Navigation */}
            {(prevNode || nextNode) && (
              <nav aria-label="上下篇导航" className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-[var(--border)] text-xs">
                {prevNode ? (
                  <Link
                    to={`/library/${encodeURIComponent(prevNode.id)}`}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] hover:border-[var(--primary)] p-4 bg-[var(--panel)] transition-colors"
                  >
                    <div className="text-[var(--text-muted)]">← 上一篇</div>
                    <div className="font-medium mt-1 text-sm text-[var(--text)]">{prevNode.title}</div>
                  </Link>
                ) : (
                  <div />
                )}
                {nextNode && (
                  <Link
                    to={`/library/${encodeURIComponent(nextNode.id)}`}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] hover:border-[var(--primary)] p-4 bg-[var(--panel)] text-right transition-colors"
                  >
                    <div className="text-[var(--text-muted)]">下一篇 →</div>
                    <div className="font-medium mt-1 text-sm text-[var(--text)]">{nextNode.title}</div>
                  </Link>
                )}
              </nav>
            )}
          </article>
        )}
      </div>

      {/* Wikilink Hover Preview Card */}
      {hoverPreview && hoverPreview.item.id !== detail?.node.id && (
        <div
          role="tooltip"
          style={{ top: `${hoverPreview.top}px`, left: `${hoverPreview.left}px` }}
          className="fixed z-[var(--z-popover)] w-72 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-md)] p-3 text-xs space-y-1.5 pointer-events-none"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[var(--text)] truncate">{hoverPreview.item.title}</span>
            <StatusBadge status={hoverPreview.item.status} compact />
          </div>
          <p className="text-[var(--text-sec)] line-clamp-2 leading-relaxed">{hoverPreview.item.summary}</p>
          <div className="font-mono text-[10px] text-[var(--text-muted)]">{hoverPreview.item.id}</div>
        </div>
      )}

      {/* Resizable Auxiliary Right Drawer */}
      <Drawer
        open={!focusMode && Boolean(detail) && rightPanel !== 'none'}
        onClose={() => setRightPanel('none')}
        title={rightPanel === 'toc' ? '页内目录' : rightPanel === 'graph' ? '局部关联图谱' : '参考来源与关联知识'}
        width={rightPanelWidth}
        resizable
        onWidthChange={setRightPanelWidth}
      >
        {detail && (
          <div className="p-4 space-y-4 text-[13px]">
            {rightPanel === 'toc' && (
              <ul className="space-y-1">
                {detail.node.headings.map((h) => (
                  <li key={h.slug} style={{ paddingLeft: `${(h.level - 2) * 12}px` }}>
                    <a
                      href={`#${h.slug}`}
                      className={`block py-1 px-2 rounded-[var(--radius-xs)] truncate transition-colors ${
                        activeHeading === h.slug
                          ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                          : 'text-[var(--text-sec)] hover:text-[var(--text)]'
                      }`}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {rightPanel === 'graph' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-sec)]">1–2 跳关联网络</span>
                  <Link to="/library/graph" className="text-[var(--primary)] hover:underline">
                    全局图谱 →
                  </Link>
                </div>
                {localGraph && localGraph.nodes.length > 0 && (
                  <div className="h-[340px] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
                    <ElkFlowCanvas
                      nodes={localFlowData.nodes}
                      edges={localFlowData.edges}
                      showMiniMap={false}
                      onNodeClick={(id) => navigate(`/library/${encodeURIComponent(id)}`)}
                    />
                  </div>
                )}
              </div>
            )}

            {rightPanel === 'meta' && (
              <div className="space-y-5">
                {dedupedRelated.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-[var(--text-sec)]">关联知识（已去重）</h4>
                    <ul className="divide-y divide-[var(--border)]">
                      {dedupedRelated.map((r) => (
                        <li key={r.nodeId} className="py-2 flex items-center justify-between gap-2">
                          <Link to={`/library/${encodeURIComponent(r.nodeId)}`} className="hover:text-[var(--primary)] truncate">
                            {r.title}
                          </Link>
                          <Badge tone="neutral" className="font-mono text-[10px] shrink-0">
                            {r.relationType}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  <h4 className="font-semibold text-[var(--text-sec)]">参考来源</h4>
                  <ul className="space-y-2">
                    {detail.sources.map((s) => (
                      <li key={s.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] p-2.5">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                        >
                          <span>{s.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <div className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
                          {s.kind} · {s.licenseStatus} · {s.verifiedAt}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
