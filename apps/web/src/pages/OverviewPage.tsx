import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bookmark,
  Clock,
  FlaskConical,
  Network,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HardDrive,
} from 'lucide-react';
import { ProgressStatus } from '@agent-atlas/shared';
import { apiGet } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, ErrorState, Progress, Skeleton } from '../components/ui';

interface OverviewData {
  domains: Array<{ id: string; order: number; title: string; enTitle: string; description: string }>;
  stats: {
    nodes: number;
    relations: number;
    paths: number;
    assessments: number;
    labs: number;
    sources: number;
    glossary: number;
    ecosystem: number;
    casebooks: number;
  };
  progressSummary: {
    totalNodes: number;
    readOrAssessed: number;
    assessedOnly: number;
    inProgress: number;
    needsReview: number;
  };
  recentReading: Array<{
    nodeId: string;
    title: string;
    enTitle: string;
    domain: string;
    visitedAt: string;
    status: ProgressStatus;
  }>;
  bookmarks: Array<{ nodeId: string; title: string; domain: string; createdAt: string }>;
  recentNotes: Array<{ id: string; nodeId: string; body: string; updatedAt: string }>;
  needsReviewNodes: Array<{ nodeId: string; title: string; domain: string }>;
  wrongAttemptsCount: number;
  pathSummaries: Array<{
    id: string;
    title: string;
    enTitle: string;
    goal: string;
    requiredTotal: number;
    doneCount: number;
    assessedCount: number;
  }>;
}

const CORE_PATH_IDS = new Set(['agent-foundations', 'agent-developer', 'agent-architect']);

const QUICK_TOPICS = [
  { label: 'Agent 分类与选型边界', nodeId: 'agent.taxonomy' },
  { label: 'Function Calling 契约', nodeId: 'tools.function-calling' },
  { label: 'MCP 协议架构', nodeId: 'tools.mcp-architecture' },
];

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const dataVersion = useAppStore((s) => s.dataVersion);

  const load = () => {
    apiGet<OverviewData>('/api/overview')
      .then((res) => {
        setError(null);
        setData(res);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  if (error) {
    return <ErrorState title="加载工作台失败" message={error} onRetry={load} />;
  }

  if (!data) {
    return (
      <div className="max-w-[1120px] mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-4">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-4 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  const latestNode = data.recentReading[0];
  const corePaths = data.pathSummaries.filter((p) => CORE_PATH_IDS.has(p.id));
  const extraPaths = data.pathSummaries.filter((p) => !CORE_PATH_IDS.has(p.id));
  const overallPct =
    data.progressSummary.totalNodes > 0
      ? Math.round((data.progressSummary.readOrAssessed / data.progressSummary.totalNodes) * 100)
      : 0;

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-7 space-y-8">
      {/* Editorial Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[var(--border)]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
            AI Agent Engineering 研究与学习工作台
          </h1>
          <p className="text-sm text-[var(--text-sec)] mt-1.5">
            {data.stats.nodes} 篇知识词条 · {data.stats.labs} 个确定性实验 · {data.stats.assessments} 道工程判断 · {data.stats.casebooks} 篇架构案例
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/library/graph">
            <Button variant="outline" size="sm" leftIcon={<Network className="h-3.5 w-3.5" />}>
              全局图谱
            </Button>
          </Link>
          <Link to="/lab/agent-loop">
            <Button variant="secondary" size="sm" leftIcon={<FlaskConical className="h-3.5 w-3.5" />}>
              进入实验室
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Column */}
        <div className="lg:col-span-8 space-y-8">
          {/* Primary Focus Bar: Resume Reading or Recommended First Lesson */}
          <section aria-label="继续学习" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5">
            {latestNode ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-[13px] text-[var(--text-sec)]">
                    <Clock className="h-3.5 w-3.5 text-[var(--primary)]" />
                    <span>最近阅读</span>
                    <StatusBadge status={latestNode.status} />
                  </div>
                  <h2 className="text-lg font-semibold truncate">{latestNode.title}</h2>
                  <div className="text-xs font-mono text-[var(--text-muted)] truncate">
                    {latestNode.nodeId} · {latestNode.enTitle}
                  </div>
                </div>
                <Link to={`/library/${encodeURIComponent(latestNode.nodeId)}`} className="shrink-0">
                  <Button variant="primary" size="md" rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                    继续阅读
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-[13px] text-[var(--text-sec)]">
                    <Badge tone="primary">起始节点</Badge>
                    <span>建议从 Token 预算与上下文窗口切入</span>
                  </div>
                  <h2 className="text-lg font-semibold">Token 与上下文窗口工程</h2>
                  <p className="text-[13px] text-[var(--text-sec)]">
                    理解长上下文注意力衰减、预算切分与后续 Agent 执行循环的基础约束。
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link to="/library/llm.tokens-context">
                    <Button variant="primary" size="md" rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                      开始阅读
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* Learning Tracks List */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text)]">学习路线</h2>
              <Link to="/learn" className="text-[13px] text-[var(--primary)] hover:underline">
                查看全部路线 →
              </Link>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)]">
              {[...corePaths, ...(showAllPaths ? extraPaths : [])].map((p) => {
                const pct = p.requiredTotal > 0 ? Math.round((p.doneCount / p.requiredTotal) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    to={`/learn/${encodeURIComponent(p.id)}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-3.5 hover:bg-[var(--panel-hover)] transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-medium text-[var(--text)] truncate">
                          {p.title.replace('路径', '')}
                        </span>
                        <span className="text-xs font-mono text-[var(--text-muted)] shrink-0">
                          {p.doneCount}/{p.requiredTotal}
                        </span>
                      </div>
                      <p className="text-[13px] text-[var(--text-sec)] line-clamp-1">{p.goal}</p>
                    </div>
                    <div className="w-full sm:w-36 shrink-0">
                      <Progress value={pct} size="xs" showPercent />
                    </div>
                  </Link>
                );
              })}
            </div>

            {extraPaths.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllPaths((v) => !v)}
                className="inline-flex items-center gap-1 text-[13px] text-[var(--text-sec)] hover:text-[var(--primary)] cursor-pointer"
              >
                {showAllPaths ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span>{showAllPaths ? '收起专项路线' : `显示其余 ${extraPaths.length} 条专项路线`}</span>
              </button>
            )}
          </section>

          {/* Compact Knowledge Domains Index */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text)]">知识领域索引</h2>
              <button
                type="button"
                onClick={() => setShowAllDomains((v) => !v)}
                className="text-[13px] text-[var(--primary)] hover:underline cursor-pointer"
              >
                {showAllDomains ? '仅看核心 6 域' : `展开全部 ${data.domains.length} 域`}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--border)] overflow-hidden">
              {(showAllDomains ? data.domains : data.domains.slice(0, 6)).map((d) => (
                <Link
                  key={d.id}
                  to={d.id === 'casebook' ? '/casebook' : `/library?domain=${encodeURIComponent(d.id)}`}
                  className="bg-[var(--panel)] hover:bg-[var(--panel-hover)] px-4 py-3 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text)] truncate">{d.title}</div>
                    <div className="text-[13px] text-[var(--text-sec)] truncate mt-0.5">{d.description}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right Utility Sidebar */}
        <aside className="lg:col-span-4 space-y-6">
          {/* Progress Overview */}
          <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">掌握进度</h2>
              <span className="text-[13px] font-mono text-[var(--text-sec)]">
                {data.progressSummary.readOrAssessed}/{data.progressSummary.totalNodes} 篇
              </span>
            </div>
            <Progress value={overallPct} showPercent />
            <div className="flex items-center justify-between text-[13px] text-[var(--text-sec)] pt-1 border-t border-[var(--border)]">
              <span>已通过自测</span>
              <span className="font-mono text-[var(--text)]">{data.progressSummary.assessedOnly} 篇</span>
            </div>

            {(data.needsReviewNodes.length > 0 || data.wrongAttemptsCount > 0) && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--warning)]/35 bg-[var(--warning-bg)] p-3 text-[13px] space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-[var(--warning)]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>待复习事项</span>
                </div>
                {data.needsReviewNodes.map((n) => (
                  <Link key={n.nodeId} to={`/library/${encodeURIComponent(n.nodeId)}`} className="block hover:underline truncate">
                    · {n.title}
                  </Link>
                ))}
                {data.wrongAttemptsCount > 0 && (
                  <Link to="/my-learning" className="block hover:underline">
                    · {data.wrongAttemptsCount} 道错题待巩固 →
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* Key Concept Entry Points */}
          <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2.5">
            <h2 className="text-sm font-semibold">高频核心议题</h2>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {QUICK_TOPICS.map((t) => (
                <li key={t.nodeId}>
                  <Link
                    to={`/library/${encodeURIComponent(t.nodeId)}`}
                    className="py-2 flex items-center justify-between gap-2 text-[var(--text-sec)] hover:text-[var(--primary)] transition-colors"
                  >
                    <span className="truncate">{t.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Recent Activity */}
          {data.recentReading.length > 0 && (
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">最近查阅</h2>
                <Link to="/my-learning" className="text-[13px] text-[var(--primary)] hover:underline">
                  全部记录
                </Link>
              </div>
              <ul className="space-y-2 text-[13px]">
                {data.recentReading.slice(0, 5).map((item) => (
                  <li key={item.nodeId} className="flex items-center justify-between gap-2">
                    <Link to={`/library/${encodeURIComponent(item.nodeId)}`} className="hover:text-[var(--primary)] truncate">
                      {item.title}
                    </Link>
                    <StatusBadge status={item.status} compact />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Bookmarks */}
          {data.bookmarks.length > 0 && (
            <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Bookmark className="h-3.5 w-3.5 text-[var(--primary)]" />
                  <span>收藏夹</span>
                </h2>
                <Link to="/my-learning" className="text-[13px] text-[var(--primary)] hover:underline">
                  管理
                </Link>
              </div>
              <ul className="space-y-1.5 text-[13px]">
                {data.bookmarks.slice(0, 5).map((b) => (
                  <li key={b.nodeId}>
                    <Link to={`/library/${encodeURIComponent(b.nodeId)}`} className="text-[var(--text-sec)] hover:text-[var(--primary)] block truncate">
                      {b.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Quiet Offline Status */}
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--text-sec)]">
            <HardDrive className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
            <span>本地 SQLite + FTS5 离线运行中 · 快捷键 Ctrl+K 检索</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
