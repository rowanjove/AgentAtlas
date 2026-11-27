import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Bookmark, Clock, StickyNote, AlertTriangle, Trash2 } from 'lucide-react';
import { AssessmentQuestion, ProgressStatus } from '@agent-atlas/shared';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { StatusBadge } from '../components/StatusBadge';
import { Button, EmptyState, Table, Tabs, toast } from '../components/ui';

export function MyLearningPage() {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion);

  const [tab, setTab] = useState<'overview' | 'wrong' | 'notes' | 'bookmarks' | 'history'>('overview');
  const [progress, setProgress] = useState<{
    items: Array<{ nodeId: string; status: ProgressStatus; lastReadAt: string | null; updatedAt: string }>;
    history: Array<{ id: number; nodeId: string; previousStatus: string | null; newStatus: string; reason: string; createdAt: string }>;
    readingHistory: Array<{ nodeId: string; visitedAt: string }>;
  } | null>(null);
  const [notes, setNotes] = useState<Array<{ id: string; nodeId: string; body: string; updatedAt: string }>>([]);
  const [bookmarks, setBookmarks] = useState<Array<{ nodeId: string; createdAt: string }>>([]);
  const [assessments, setAssessments] = useState<{
    items: AssessmentQuestion[];
    attempts: Array<{
      id: string;
      assessmentId: string;
      nodeId: string;
      selectedOptionId: string;
      isCorrect: boolean;
      needsReview: boolean;
      createdAt: string;
    }>;
  } | null>(null);
  const [nodeMap, setNodeMap] = useState<Map<string, { title: string; domain: string }>>(new Map());

  useEffect(() => {
    Promise.all([
      apiGet<typeof progress>('/api/progress'),
      apiGet<{ items: typeof notes }>('/api/notes'),
      apiGet<{ items: typeof bookmarks }>('/api/bookmarks'),
      apiGet<typeof assessments>('/api/assessments'),
      apiGet<{ items: Array<{ id: string; title: string; domain: string }> }>('/api/knowledge'),
    ])
      .then(([p, n, b, a, k]) => {
        setProgress(p);
        setNotes(n.items);
        setBookmarks(b.items);
        setAssessments(a);
        setNodeMap(new Map(k.items.map((x) => [x.id, { title: x.title, domain: x.domain }])));
      })
      .catch((e) => toast.error('加载学习记录失败', e instanceof Error ? e.message : '未知错误'));
  }, [dataVersion]);

  const wrongAttempts = (assessments?.attempts ?? []).filter((a) => !a.isCorrect && a.needsReview);
  const qMap = new Map((assessments?.items ?? []).map((q) => [q.id, q]));

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-7 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">个人学习中心 My Learning</h1>
          <p className="text-[13px] text-[var(--text-sec)] mt-1">
            所有掌握进度、错题复盘、笔记与收藏均保存在本地 SQLite。
          </p>
        </div>
        <Link to="/settings">
          <Button size="sm" variant="outline">
            数据备份与恢复 →
          </Button>
        </Link>
      </header>

      <Tabs
        ariaLabel="学习记录分类"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: '掌握总览', count: progress?.items.length ?? 0 },
          { id: 'wrong', label: '错题与待复习', count: wrongAttempts.length },
          { id: 'notes', label: '个人笔记', count: notes.length },
          { id: 'bookmarks', label: '收藏夹', count: bookmarks.length },
          { id: 'history', label: '阅读与审计历史', count: progress?.readingHistory.length ?? 0 },
        ]}
      />

      {tab === 'overview' && progress && (
        progress.items.length === 0 ? (
          <EmptyState title="尚未记录任何学习节点" description="打开任意知识百科词条即可记录阅读与自测状态。" />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-sec)] text-xs text-[var(--text-sec)]">
                <th className="px-4 py-2.5 text-left font-medium">知识词条</th>
                <th className="px-4 py-2.5 text-left font-medium">更新时间</th>
                <th className="px-4 py-2.5 text-right font-medium">掌握状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {progress.items.map((item) => (
                <tr key={item.nodeId} className="hover:bg-[var(--panel-hover)] transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/library/${encodeURIComponent(item.nodeId)}`} className="font-medium hover:text-[var(--primary)]">
                      {nodeMap.get(item.nodeId)?.title ?? item.nodeId}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">{item.nodeId}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-sec)] font-mono">
                    {new Date(item.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}

      {tab === 'wrong' && (
        <div className="space-y-3">
          {wrongAttempts.length === 0 ? (
            <EmptyState title="当前没有待复习的错题" />
          ) : (
            wrongAttempts.map((att) => {
              const q = qMap.get(att.assessmentId);
              return (
                <div
                  key={att.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--warning)] flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {nodeMap.get(att.nodeId)?.title ?? att.nodeId}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiMutate('POST', `/api/assessments/attempts/${encodeURIComponent(att.id)}/resolve`);
                          bumpDataVersion();
                          toast.success('已标记为已复习理解');
                        } catch (e) {
                          toast.error('操作失败', e instanceof Error ? e.message : '未知错误');
                        }
                      }}
                    >
                      标为已理解
                    </Button>
                  </div>
                  {q && (
                    <>
                      <p className="text-sm font-medium text-[var(--text)]">{q.prompt}</p>
                      <p className="text-[var(--text-sec)] leading-relaxed">解析：{q.explanation}</p>
                    </>
                  )}
                  <Link to={`/library/${encodeURIComponent(att.nodeId)}`} className="inline-block text-[var(--primary)] hover:underline">
                    回到词条重新自测 →
                  </Link>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="space-y-2.5">
          {notes.length === 0 ? (
            <EmptyState title="暂无个人笔记" description="在任意知识词条文末均可记录工程笔记。" />
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/library/${encodeURIComponent(n.nodeId)}`} className="font-semibold text-[var(--primary)] flex items-center gap-1.5 hover:underline">
                    <StickyNote className="h-3.5 w-3.5" />
                    <span>{nodeMap.get(n.nodeId)?.title ?? n.nodeId}</span>
                  </Link>
                  <Button
                    size="xs"
                    variant="ghost"
                    leftIcon={<Trash2 className="h-3.5 w-3.5 text-[var(--error)]" />}
                    onClick={async () => {
                      try {
                        await apiMutate('DELETE', `/api/notes/${encodeURIComponent(n.id)}`);
                        bumpDataVersion();
                        toast.info('已删除笔记');
                      } catch (e) {
                        toast.error('删除笔记失败', e instanceof Error ? e.message : '未知错误');
                      }
                    }}
                  >
                    删除
                  </Button>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed text-[13px] text-[var(--text)]">{n.body}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'bookmarks' && (
        bookmarks.length === 0 ? (
          <EmptyState title="暂无收藏词条" />
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)]">
            {bookmarks.map((b) => (
              <div key={b.nodeId} className="px-4 py-3 flex items-center justify-between text-xs">
                <Link
                  to={`/library/${encodeURIComponent(b.nodeId)}`}
                  className="font-medium text-[13px] hover:text-[var(--primary)] flex items-center gap-2"
                >
                  <Bookmark className="h-3.5 w-3.5 text-[var(--primary)]" />
                  <span>{nodeMap.get(b.nodeId)?.title ?? b.nodeId}</span>
                </Link>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await apiMutate('POST', `/api/bookmarks/${encodeURIComponent(b.nodeId)}`, { active: false });
                      bumpDataVersion();
                      toast.info('已取消收藏');
                    } catch (e) {
                      toast.error('取消收藏失败', e instanceof Error ? e.message : '未知错误');
                    }
                  }}
                >
                  取消收藏
                </Button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'history' && progress && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-[13px]">
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-[var(--primary)]" /> 最近访问词条
            </h2>
            <div className="divide-y divide-[var(--border)]">
              {progress.readingHistory.map((r) => (
                <div key={r.nodeId} className="py-2 flex justify-between gap-2">
                  <Link to={`/library/${encodeURIComponent(r.nodeId)}`} className="hover:text-[var(--primary)] truncate">
                    {nodeMap.get(r.nodeId)?.title ?? r.nodeId}
                  </Link>
                  <span className="text-xs text-[var(--text-muted)] font-mono shrink-0">
                    {new Date(r.visitedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Award className="h-4 w-4 text-[var(--success)]" /> 状态变更审计日志
            </h2>
            <div className="divide-y divide-[var(--border)]">
              {progress.history.slice(0, 20).map((h) => (
                <div key={h.id} className="py-2 flex justify-between gap-2">
                  <span className="truncate font-mono text-xs">
                    {h.nodeId}: {h.previousStatus ?? 'none'} → <strong>{h.newStatus}</strong>
                  </span>
                  <span className="text-[var(--text-muted)] shrink-0 font-mono text-xs">{h.reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
