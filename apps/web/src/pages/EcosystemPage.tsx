import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Columns3, Search, Table2, List } from 'lucide-react';
import { EcosystemItem } from '@agent-atlas/shared';
import { apiGet } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Table,
  Tabs,
} from '../components/ui';

const CATEGORY_LABELS: Record<string, string> = {
  all: '全部类别',
  'sdk-framework': 'SDK / 框架',
  orchestration: '状态图编排',
  protocol: '开放协议',
  'retrieval-memory': '检索与记忆',
  observability: '可观测性',
  evaluation: '评估测试',
  'local-runtime': '本地推理引擎',
  'agent-ide': '可视化构建',
};

export function EcosystemPage() {
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);

  const [items, setItems] = useState<EcosystemItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'list'>('table');
  const [compareIds, setCompareIds] = useState<string[]>(['langgraph', 'openai-agents-sdk', 'pydantic-ai']);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: EcosystemItem[] }>('/api/ecosystem')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : '加载技术生态失败'));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.positioning.toLowerCase().includes(q) ||
        item.controlFlow.toLowerCase().includes(q)
      );
    });
  }, [items, category, query]);

  const compared = items.filter((i) => compareIds.includes(i.id));
  const detailItem = items.find((i) => i.id === selectedId) ?? null;

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? [...prev.slice(1), id] : [...prev, id],
    );
  };

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
        <div className="max-w-[1220px] mx-auto space-y-7">
          {/* Header & Filters */}
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[var(--border)]">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">AI Agent 技术生态与选型比较</h1>
              <p className="text-[13px] text-[var(--text-sec)] mt-1">
                按开源协议、控制流、持久化边界与不适用场景客观记录，不做主观评分排名。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="w-48">
                <Input
                  type="search"
                  controlSize="sm"
                  leftIcon={<Search className="h-3.5 w-3.5" />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="筛选框架或协议..."
                />
              </div>
              <Select aria-label="类别筛选" value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <Tabs
                ariaLabel="列表视图切换"
                variant="segmented"
                value={viewMode}
                onChange={setViewMode}
                items={[
                  { id: 'table', label: '表格', icon: <Table2 className="h-3.5 w-3.5" /> },
                  { id: 'list', label: '列表', icon: <List className="h-3.5 w-3.5" /> },
                ]}
              />
            </div>
          </header>

          {error && <ErrorState message={error} />}

          {/* Main Catalog: Table or Clean List (No identical card grid) */}
          {filtered.length === 0 ? (
            <EmptyState title="没有匹配的技术项" description="调整搜索词或切换类别筛选。" />
          ) : viewMode === 'table' ? (
            <Table>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-sec)] text-[13px] text-[var(--text-sec)]">
                  <th className="px-4 py-2.5 text-left font-medium">名称与定位</th>
                  <th className="px-4 py-2.5 text-left font-medium w-32">类别</th>
                  <th className="px-4 py-2.5 text-left font-medium w-44">控制流</th>
                  <th className="px-4 py-2.5 text-left font-medium w-36">协议 / 复杂度</th>
                  <th className="px-4 py-2.5 text-right font-medium w-28">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((item) => {
                  const isCompared = compareIds.includes(item.id);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`hover:bg-[var(--panel-hover)] transition-colors cursor-pointer ${
                        selectedId === item.id ? 'bg-[var(--selected-bg)]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--text)]">{item.name}</div>
                        <div className="text-[13px] text-[var(--text-sec)] line-clamp-1 mt-0.5">{item.positioning}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[var(--text-sec)]">{item.controlFlow}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--text-sec)]">
                        {item.license} · {item.complexity}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="xs"
                          variant={isCompared ? 'primary' : 'outline'}
                          onClick={() => toggleCompare(item.id)}
                        >
                          {isCompared ? '已选对比' : '+ 对比'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)]">
              {filtered.map((item) => {
                const isCompared = compareIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--panel-hover)] transition-colors"
                  >
                    <div className="min-w-0 space-y-1 flex-1 cursor-pointer" onClick={() => setSelectedId(item.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--text)]">{item.name}</span>
                        <Badge tone="neutral">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                        <span className="text-[11px] font-mono text-[var(--text-muted)]">
                          {item.license} · {item.maintenanceStatus}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-sec)]">{item.positioning}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="xs" variant="ghost" onClick={() => setSelectedId(item.id)}>
                        详情
                      </Button>
                      <Button
                        size="xs"
                        variant={isCompared ? 'primary' : 'outline'}
                        onClick={() => toggleCompare(item.id)}
                      >
                        {isCompared ? '已选对比' : '+ 对比'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Side-by-Side Comparison Matrix */}
          {compared.length > 0 && (
            <section className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Columns3 className="h-4 w-4 text-[var(--primary)]" />
                  <span>并列技术对比矩阵（{compared.length}/4）</span>
                </h2>
                <Button size="xs" variant="ghost" onClick={() => setCompareIds([])}>
                  清空对比
                </Button>
              </div>
              <Table>
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-sec)]">
                    <th className="p-3 text-left w-36 text-[13px] text-[var(--text-sec)] font-medium">评估维度</th>
                    {compared.map((c) => (
                      <th key={c.id} className="p-3 text-left min-w-[210px] text-[13px] font-semibold">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[13px]">
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">核心定位</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top leading-relaxed">
                        {c.positioning}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">控制流与架构</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top">
                        {c.controlFlow} · {c.architecture}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">状态持久化</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top">
                        {c.statePersistence}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">适用场景</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top">
                        <ul className="list-disc pl-4 space-y-0.5">
                          {c.suitableFor.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">不适用场景</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top text-[var(--warning)]">
                        <ul className="list-disc pl-4 space-y-0.5">
                          {c.notSuitableFor.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">复杂度与成本</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top">
                        {c.complexity} · {c.costTradeoffs}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-[var(--text-sec)]">许可 / 状态</td>
                    {compared.map((c) => (
                      <td key={c.id} className="p-3 align-top font-mono">
                        {c.license} · {c.maintenanceStatus}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </Table>
            </section>
          )}
        </div>
      </div>

      {/* Item Detail Drawer */}
      <Drawer
        open={Boolean(detailItem)}
        onClose={() => setSelectedId(null)}
        title={detailItem?.name ?? ''}
        subtitle={detailItem ? `${CATEGORY_LABELS[detailItem.category] ?? detailItem.category} · ${detailItem.license}` : undefined}
        width={rightPanelWidth}
        resizable
        onWidthChange={setRightPanelWidth}
      >
        {detailItem && (
          <div className="p-4 space-y-4 text-[13px]">
            <p className="leading-relaxed text-[var(--text)]">{detailItem.positioning}</p>
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <div>
                <span className="text-[var(--text-sec)]">控制流：</span>
                {detailItem.controlFlow}
              </div>
              <div>
                <span className="text-[var(--text-sec)]">架构模型：</span>
                {detailItem.architecture}
              </div>
              <div>
                <span className="text-[var(--text-sec)]">状态持久化：</span>
                {detailItem.statePersistence}
              </div>
              <div>
                <span className="text-[var(--text-sec)]">成本权衡：</span>
                {detailItem.costTradeoffs}
              </div>
              <div>
                <span className="text-[var(--text-sec)]">维护状态：</span>
                <span className="font-mono">{detailItem.maintenanceStatus}</span>
              </div>
            </div>

            {detailItem.relatedNodeIds.length > 0 && (
              <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
                <div className="font-medium text-[var(--text-sec)]">关联知识词条</div>
                <div className="flex flex-wrap gap-1.5">
                  {detailItem.relatedNodeIds.map((nid) => (
                    <Link key={nid} to={`/library/${encodeURIComponent(nid)}`}>
                      <Badge tone="primary" className="font-mono hover:underline">
                        {nid}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant={compareIds.includes(detailItem.id) ? 'secondary' : 'primary'}
                onClick={() => toggleCompare(detailItem.id)}
              >
                {compareIds.includes(detailItem.id) ? '移出对比' : '加入对比'}
              </Button>
              <a
                href={detailItem.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
              >
                <span>官方来源</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
