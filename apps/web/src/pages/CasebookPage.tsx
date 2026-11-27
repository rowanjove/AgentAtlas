import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FlaskConical, CheckCircle2, XCircle } from 'lucide-react';
import { CasebookEntry, CasebookFrontmatter } from '@agent-atlas/shared';
import { apiGet } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { Badge, Button, ErrorState, Skeleton } from '../components/ui';

export function CasebookPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const setPageBreadcrumb = useAppStore((s) => s.setPageBreadcrumb);
  const [list, setList] = useState<CasebookFrontmatter[]>([]);
  const [detail, setDetail] = useState<CasebookEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: CasebookFrontmatter[] }>('/api/casebook')
      .then((res) => {
        setList(res.items);
        if (!id && res.items[0]) {
          navigate(`/casebook/${encodeURIComponent(res.items[0].id)}`, { replace: true });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载案例库失败'));
  }, [id, navigate]);

  useEffect(() => {
    if (!id) return;
    apiGet<CasebookEntry>(`/api/casebook/${encodeURIComponent(id)}`)
      .then((d) => {
        setError(null);
        setDetail(d);
        setPageBreadcrumb([{ label: '实战案例', to: '/casebook' }, { label: d.title }]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载案例详情失败'));
  }, [id, setPageBreadcrumb]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left Master List */}
      <aside className="w-[272px] shrink-0 border-r border-[var(--border)] bg-[var(--panel)] overflow-y-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h1 className="text-sm font-semibold">工程架构案例库</h1>
          <p className="text-xs text-[var(--text-sec)] mt-0.5">{list.length} 篇真实场景权衡剖析</p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {list.map((c) => {
            const active = id === c.id;
            return (
              <Link
                key={c.id}
                to={`/casebook/${encodeURIComponent(c.id)}`}
                className={`block px-4 py-3 text-[13px] transition-colors ${
                  active ? 'bg-[var(--selected-bg)] border-l-2 border-l-[var(--primary)]' : 'hover:bg-[var(--panel-hover)]'
                }`}
              >
                <div className={`font-medium text-sm ${active ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>
                  {c.title}
                </div>
                <div className="text-xs text-[var(--text-sec)] mt-1 line-clamp-2 leading-relaxed">
                  {c.patternSummary}
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Right Editorial Case Reader */}
      <div className="flex-1 min-w-0 overflow-y-auto px-6 md:px-10 py-7">
        {error && <ErrorState message={error} />}
        {!detail && !error && (
          <div className="mx-auto space-y-4" style={{ maxWidth: 'var(--reader-width)' }}>
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {detail && (
          <article className="mx-auto space-y-7" style={{ maxWidth: 'var(--reader-width)' }}>
            <header className="space-y-2 pb-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
                <span>{detail.id}</span>
                <span>·</span>
                <Badge tone="neutral">{detail.difficulty}</Badge>
                <span>·</span>
                <span>核实 {detail.verifiedAt}</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">{detail.title}</h2>
              <p className="text-[13px] font-mono text-[var(--text-sec)]">{detail.enTitle}</p>
            </header>

            {/* Architecture Decision Record Comparison */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
              <div className="rounded-[var(--radius-md)] border border-[var(--success)]/35 bg-[var(--success-bg)] p-4 space-y-1.5">
                <div className="font-semibold text-[var(--success)] flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> 采用架构方案
                </div>
                <p className="leading-relaxed text-[var(--text)]">{detail.recommendedArchitecture}</p>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2">
                <div className="font-semibold text-[var(--error)] flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 shrink-0" /> 否决的备选方案与原因
                </div>
                <div className="space-y-2">
                  {detail.rejectedAlternatives.map((alt) => (
                    <div key={alt.option} className="border-t border-[var(--border)] pt-1.5 first:border-t-0 first:pt-0">
                      <div className="font-medium text-[var(--text)]">{alt.option}</div>
                      <div className="text-[var(--text-sec)] mt-0.5">{alt.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <MarkdownRenderer content={detail.body} />

            <section className="border-t border-[var(--border)] pt-5 flex flex-wrap gap-2">
              {detail.relatedNodeIds.map((nid) => (
                <Link key={nid} to={`/library/${encodeURIComponent(nid)}`}>
                  <Button size="xs" variant="outline" className="font-mono">
                    关联原理：{nid}
                  </Button>
                </Link>
              ))}
              {detail.relatedLabIds.map((lid) => (
                <Link key={lid} to={`/lab/${encodeURIComponent(lid)}`}>
                  <Button size="xs" variant="secondary" leftIcon={<FlaskConical className="h-3.5 w-3.5 text-[var(--primary)]" />}>
                    交互实验：{lid}
                  </Button>
                </Link>
              ))}
            </section>
          </article>
        )}
      </div>
    </div>
  );
}
