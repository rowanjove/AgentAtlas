import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Upload,
  RotateCcw,
  Download,
  ExternalLink,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { ValidationReport, SourceEntry } from '@agent-atlas/shared';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Table,
  Tabs,
  Textarea,
  toast,
} from '../components/ui';

interface ContentStatusResponse {
  validation: ValidationReport;
  snapshots: Array<{ id: string; reason: string; summary: string; createdAt: string }>;
  drafts: Array<{
    id: string;
    nodeId: string;
    title: string;
    domain: string;
    markdown: string;
    sourceNote: string;
    verified: boolean;
    updatedAt: string;
  }>;
  sources: Array<SourceEntry & { lastCheckedAt: string | null; lastCheckStatus: string | null }>;
}

export function ContentPage() {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion);

  const [tab, setTab] = useState<'health' | 'import' | 'drafts' | 'snapshots' | 'sources'>('health');
  const [status, setStatus] = useState<ContentStatusResponse | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [discardDraftId, setDiscardDraftId] = useState<string | null>(null);

  // Import state
  const [filename, setFilename] = useState('custom-note.md');
  const [mdContent, setMdContent] = useState('');
  const [preview, setPreview] = useState<{
    valid: boolean;
    items: Array<{ filename: string; nodeId: string | null; action: string; majorUpdate: boolean; errors: string[] }>;
  } | null>(null);

  const load = () => {
    apiGet<ContentStatusResponse>('/api/content/status')
      .then(setStatus)
      .catch((e) => toast.error('加载内容状态失败', e instanceof Error ? e.message : '未知错误'));
  };

  useEffect(() => {
    load();
  }, [dataVersion]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setMdContent(await file.text());
    setPreview(null);
  };

  const runPreview = async () => {
    try {
      const res = await apiMutate<typeof preview>('POST', '/api/content/import/preview', {
        files: [{ filename, content: mdContent }],
      });
      setPreview(res);
    } catch (e) {
      toast.error('预览失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const commitImport = async () => {
    try {
      await apiMutate('POST', '/api/content/import/commit', {
        files: [{ filename, content: mdContent }],
      });
      toast.success('导入成功', '已生成前序快照、原子更新正文并重建 FTS5 索引。');
      setPreview(null);
      bumpDataVersion();
    } catch (e) {
      toast.error('提交失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const exportObsidianBundle = async () => {
    try {
      const res = await fetch('/api/content/export/obsidian.zip', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-atlas-obsidian-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('已导出 Obsidian Vault (.zip)');
    } catch (e) {
      toast.error('导出失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  return (
    <div className="max-w-[1160px] mx-auto px-6 py-7 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">内容管理、校验与版本治理</h1>
          <p className="text-[13px] text-[var(--text-sec)] mt-1">
            严格遵循「校验 → 安全预览 → 快照备份 → 原子发布 → 索引重建 → 可回滚」流程。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={async () => {
              try {
                await apiMutate('POST', '/api/content/reindex');
                toast.success('已完成 FTS5 与图谱索引重建');
                bumpDataVersion();
              } catch (e) {
                toast.error('重建索引失败', e instanceof Error ? e.message : '未知错误');
              }
            }}
          >
            重建索引
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={exportObsidianBundle}
          >
            导出 Obsidian (.zip)
          </Button>
        </div>
      </header>

      <Tabs
        ariaLabel="内容治理功能切换"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'health', label: '内容校验与健康' },
          { id: 'import', label: '导入与安全预览' },
          { id: 'drafts', label: '草稿与事实审核', count: status?.drafts.length ?? 0 },
          { id: 'snapshots', label: '快照回滚', count: status?.snapshots.length ?? 0 },
          { id: 'sources', label: '来源管理', count: status?.sources.length ?? 0 },
        ]}
      />

      {tab === 'health' && status && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4 text-[13px]">
          <div className="flex items-center gap-2 font-semibold text-sm">
            {status.validation.valid ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-[var(--error)]" />
            )}
            <span>
              {status.validation.valid
                ? '内容库全部校验通过（DAG 无环 / 链接有效 / 无危险 HTML）'
                : '存在校验告警'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
            {Object.entries(status.validation.stats).map(([k, v]) => (
              <div key={k} className="border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2.5 bg-[var(--bg)]">
                <div className="text-[11px] text-[var(--text-muted)]">{k}</div>
                <div className="text-base font-semibold mt-0.5">{v}</div>
              </div>
            ))}
          </div>

          {status.validation.issues.length > 0 && (
            <ul className="space-y-1 text-[var(--error)] font-mono">
              {status.validation.issues.map((i, idx) => (
                <li key={idx}>
                  [{i.code}] {i.file ?? i.field}: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-strong)] cursor-pointer text-[13px] font-medium">
              <Upload className="h-3.5 w-3.5" /> 选择本地 .md 文件
              <input type="file" accept=".md" onChange={handleFileUpload} className="hidden" />
            </label>
            <div className="w-60">
              <Input
                type="text"
                className="font-mono"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="文件名 (如 my-node.md)"
              />
            </div>
          </div>

          <Textarea
            rows={10}
            className="font-mono"
            value={mdContent}
            onChange={(e) => setMdContent(e.target.value)}
            placeholder="粘贴带 YAML frontmatter 的 Markdown 内容（支持 [[wikilinks]]；系统将拦截重复 ID、XSS 脚本与路径穿越）"
          />

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!mdContent.trim()} onClick={runPreview}>
              运行安全与差异预览
            </Button>
            {preview?.valid && (
              <Button variant="primary" size="sm" onClick={commitImport}>
                确认原子发布并重建索引
              </Button>
            )}
          </div>

          {preview && (
            <div className="border border-[var(--border)] rounded-[var(--radius-sm)] p-3.5 bg-[var(--bg)] space-y-2">
              {preview.items.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="font-mono">
                    {item.filename} → action: <strong>{item.action}</strong> {item.nodeId ? `(${item.nodeId})` : ''}
                  </div>
                  {item.errors.map((e) => (
                    <div key={e} className="text-[var(--error)]">
                      · 拦截：{e}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'drafts' && status && (
        <div className="space-y-3 text-[13px]">
          {status.drafts.length === 0 ? (
            <EmptyState
              title="草稿箱为空"
              description="由 AI 导师生成的笔记会先落在此处等待人工事实审核，绝不会直接覆写正式知识库。"
            />
          ) : (
            status.drafts.map((d) => (
              <div
                key={d.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm">{d.title}</div>
                  <Badge tone="warning">未核实草稿</Badge>
                </div>
                <div className="text-[var(--text-sec)]">{d.sourceNote}</div>
                <pre className="p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] max-h-44 overflow-y-auto font-mono">
                  {d.markdown}
                </pre>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    leftIcon={<ShieldCheck className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      try {
                        await apiMutate('POST', `/api/content/drafts/${encodeURIComponent(d.id)}/publish`, { verified: true });
                        toast.success('草稿已人工核实并原子发布');
                        bumpDataVersion();
                      } catch (e) {
                        toast.error('发布草稿失败', e instanceof Error ? e.message : '未知错误');
                      }
                    }}
                  >
                    核实并发布
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Trash2 className="h-3.5 w-3.5 text-[var(--error)]" />}
                    onClick={() => setDiscardDraftId(d.id)}
                  >
                    丢弃草稿
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'snapshots' && status && (
        status.snapshots.length === 0 ? (
          <EmptyState
            title="尚无版本快照"
            description="每次内容导入或发布前都会自动创建可回滚快照。"
          />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-sec)] text-xs text-[var(--text-sec)]">
                <th className="px-4 py-2.5 text-left font-medium">快照 ID</th>
                <th className="px-4 py-2.5 text-left font-medium">原因与摘要</th>
                <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-xs">
              {status.snapshots.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--panel-hover)] transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold">{s.id}</td>
                  <td className="px-4 py-3 text-[var(--text-sec)]">
                    {s.reason} · {s.summary}
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--text-muted)]">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="xs"
                      variant="outline"
                      leftIcon={<RotateCcw className="h-3 w-3" />}
                      onClick={() => setRollbackId(s.id)}
                    >
                      回滚到此快照
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}

      {tab === 'sources' && status && (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-sec)]">
              所有正式知识节点均须追溯至以下已核实来源；离线时保留最近核实记录。
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await apiMutate<{ checked: number }>('POST', '/api/content/check-links');
                  toast.info(`已检测 ${res.checked} 条上游来源链接`);
                  load();
                } catch (e) {
                  toast.error('外链检测失败', e instanceof Error ? e.message : '未知错误');
                }
              }}
            >
              检测外链状态
            </Button>
          </div>
          <Table>
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-sec)] text-xs text-[var(--text-sec)]">
                <th className="px-4 py-2.5 text-left font-medium">来源标题</th>
                <th className="px-4 py-2.5 text-left font-medium">ID 与类型</th>
                <th className="px-4 py-2.5 text-left font-medium">核实日期</th>
                <th className="px-4 py-2.5 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {status.sources.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--panel-hover)] transition-colors">
                  <td className="px-4 py-2.5">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                    >
                      <span>{s.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--text-sec)]">
                    {s.id} · {s.kind}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--text-muted)]">{s.verifiedAt}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone="neutral" className="font-mono">
                      {s.lastCheckStatus ?? s.licenseStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(rollbackId)}
        onClose={() => setRollbackId(null)}
        onConfirm={async () => {
          if (!rollbackId) return;
          try {
            await apiMutate('POST', `/api/content/rollback/${encodeURIComponent(rollbackId)}`);
            toast.success(`已回滚至快照 ${rollbackId} 并重建索引`);
            setRollbackId(null);
            bumpDataVersion();
          } catch (e) {
            toast.error('回滚失败', e instanceof Error ? e.message : '未知错误');
          }
        }}
        title="确认回滚内容快照"
        message={`将内容目录恢复至快照 ${rollbackId} 并重建全文与图谱索引。确定继续？`}
        confirmLabel="确认回滚"
        destructive
      />

      <ConfirmDialog
        open={Boolean(discardDraftId)}
        onClose={() => setDiscardDraftId(null)}
        onConfirm={async () => {
          if (!discardDraftId) return;
          try {
            await apiMutate('DELETE', `/api/content/drafts/${encodeURIComponent(discardDraftId)}`);
            toast.info('已丢弃草稿');
            setDiscardDraftId(null);
            bumpDataVersion();
          } catch (e) {
            toast.error('丢弃草稿失败', e instanceof Error ? e.message : '未知错误');
          }
        }}
        title="丢弃未核实草稿"
        message="丢弃后该草稿无法恢复，确定删除？"
        confirmLabel="丢弃"
        destructive
      />
    </div>
  );
}
