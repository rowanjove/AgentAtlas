import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Play,
  Pause,
  RotateCcw,
  StepBack,
  StepForward,
  SlidersHorizontal,
  Copy,
  Check,
} from 'lucide-react';
import { LabMeta, LabPlayStatus, SimRunResult } from '@agent-atlas/shared';
import { runSimulation } from '@agent-atlas/simulator';
import { apiGet } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { ElkFlowCanvas } from '../components/ElkFlowCanvas';
import { Badge, Button, Checkbox, Input, Select, Tabs, toast } from '../components/ui';

const STATUS_LABELS: Record<LabPlayStatus, string> = {
  idle: '就绪',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '故障中止',
  cancelled: '已取消',
};

export function PlaygroundPage() {
  const { labId } = useParams<{ labId?: string }>();
  const navigate = useNavigate();
  const setPageBreadcrumb = useAppStore((s) => s.setPageBreadcrumb);

  const [labs, setLabs] = useState<LabMeta[]>([]);
  const activeLabId = labId || labs[0]?.id || 'agent-loop';
  const activeLab = labs.find((l) => l.id === activeLabId) ?? null;

  const [seed, setSeed] = useState(42);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [faultInjection, setFaultInjection] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimRunResult | null>(null);

  const [playStatus, setPlayStatus] = useState<LabPlayStatus>('idle');
  const [cursor, setCursor] = useState(0);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'explain' | 'state' | 'json'>('explain');
  const [copiedJson, setCopiedJson] = useState(false);

  useEffect(() => {
    apiGet<{ items: LabMeta[] }>('/api/labs')
      .then((res) => {
        setLabs(res.items);
        if (!labId && res.items[0]) {
          navigate(`/lab/${encodeURIComponent(res.items[0].id)}`, { replace: true });
        }
      })
      .catch((e) => toast.error('加载实验列表失败', e instanceof Error ? e.message : '未知错误'));
  }, [labId, navigate]);

  useEffect(() => {
    if (!activeLab) return;
    setPageBreadcrumb([{ label: '互动实验', to: '/lab' }, { label: activeLab.title }]);
    setSeed(activeLab.defaultSeed);
    setParams({ ...activeLab.defaultParams });
    setFaultInjection(null);
    const res = runSimulation(activeLab.id, {
      seed: activeLab.defaultSeed,
      params: activeLab.defaultParams,
      faultInjection: null,
    });
    setSimResult(res);
    setCursor(0);
    setPlayStatus('idle');
  }, [activeLab?.id, activeLab?.title, setPageBreadcrumb]);

  const recomputeSim = (nextSeed = seed, nextParams = params, nextFault = faultInjection) => {
    if (!activeLab) return;
    const res = runSimulation(activeLab.id, {
      seed: nextSeed,
      params: nextParams,
      faultInjection: nextFault,
    });
    setSimResult(res);
    setCursor(0);
    setPlayStatus('idle');
  };

  useEffect(() => {
    if (playStatus !== 'running' || !simResult) return;
    const timer = setInterval(() => {
      setCursor((c) => {
        if (c >= simResult.steps.length - 1) {
          setPlayStatus(simResult.status);
          return c;
        }
        return c + 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [playStatus, simResult]);

  const currentStep = simResult?.steps[cursor] ?? null;

  const graphData = useMemo(() => {
    if (!simResult) return { nodes: [], edges: [] };
    const visitedNodes = new Set(simResult.steps.slice(0, cursor + 1).map((s) => s.nodeId));
    return {
      nodes: simResult.graphNodes.map((n) => {
        const isCurrent = currentStep?.nodeId === n.id;
        const isError = isCurrent && currentStep?.status === 'error';
        return {
          id: n.id,
          label: n.label,
          subtitle: isCurrent ? `Step #${cursor + 1}` : n.kind,
          badge: isCurrent ? `#${cursor + 1}` : undefined,
          selected: isCurrent,
          accentColor: isError
            ? 'var(--error)'
            : isCurrent
              ? 'var(--primary)'
              : visitedNodes.has(n.id)
                ? 'var(--success)'
                : 'var(--border-strong)',
        };
      }),
      edges: simResult.graphEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        kind: e.conditional ? ('recommended' as const) : ('flow' as const),
        active: currentStep ? e.target === currentStep.nodeId && visitedNodes.has(e.source) : false,
      })),
    };
  }, [simResult, cursor, currentStep]);

  const stateDiffs = useMemo(() => {
    if (!simResult || !currentStep) return [];
    const prevState = cursor > 0 ? simResult.steps[cursor - 1].stateSnapshot : simResult.initialState;
    const curState = currentStep.stateSnapshot;
    const keys = [...new Set([...Object.keys(prevState), ...Object.keys(curState)])];
    return keys
      .filter((k) => JSON.stringify(prevState[k]) !== JSON.stringify(curState[k]))
      .map((k) => ({ key: k, prev: prevState[k], next: curState[k] }));
  }, [simResult, currentStep, cursor]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Unified Debugger Control Bar */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--panel)] space-y-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Select
              aria-label="选择实验"
              value={activeLabId}
              onChange={(e) => navigate(`/lab/${encodeURIComponent(e.target.value)}`)}
            >
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title} ({l.category})
                </option>
              ))}
            </Select>
            <Badge tone="warning" title="指标与延时均为确定性教学模拟结果">
              确定性教学模拟 · simulated: true
            </Badge>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="primary"
              leftIcon={playStatus === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              onClick={() => {
                if (playStatus === 'running') {
                  setPlayStatus('paused');
                } else {
                  if (simResult && cursor >= simResult.steps.length - 1) setCursor(0);
                  setPlayStatus('running');
                }
              }}
            >
              {playStatus === 'running' ? '暂停' : '运行'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={cursor <= 0}
              leftIcon={<StepBack className="h-3.5 w-3.5" />}
              onClick={() => {
                setPlayStatus('paused');
                setCursor((c) => Math.max(0, c - 1));
              }}
            >
              上一步
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!simResult || cursor >= simResult.steps.length - 1}
              leftIcon={<StepForward className="h-3.5 w-3.5" />}
              onClick={() => {
                if (!simResult) return;
                const next = Math.min(simResult.steps.length - 1, cursor + 1);
                setCursor(next);
                setPlayStatus(next >= simResult.steps.length - 1 ? simResult.status : 'paused');
              }}
            >
              单步
            </Button>
            <Button size="sm" variant="outline" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => recomputeSim()}>
              重置
            </Button>
            <Button
              size="sm"
              variant="outline"
              active={showAdvancedParams}
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              onClick={() => setShowAdvancedParams((v) => !v)}
            >
              参数
            </Button>
          </div>
        </div>

        {/* Fault Scenario Strip + Status Readout */}
        {activeLab && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[var(--text-sec)] mr-0.5">故障注入:</span>
              <Button
                size="xs"
                variant="outline"
                active={faultInjection === null}
                onClick={() => {
                  setFaultInjection(null);
                  recomputeSim(seed, params, null);
                }}
              >
                正常路径
              </Button>
              {activeLab.faultOptions.map((f) => (
                <Button
                  key={f.id}
                  size="xs"
                  variant="outline"
                  active={faultInjection === f.id}
                  title={f.description}
                  onClick={() => {
                    setFaultInjection(f.id);
                    recomputeSim(seed, params, f.id);
                  }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[var(--text-sec)] font-mono text-xs">
              <span>
                Step {cursor + 1}/{simResult?.steps.length ?? 0} · {STATUS_LABELS[playStatus]}
              </span>
              {activeLab.relatedNodeIds[0] && (
                <Link to={`/library/${encodeURIComponent(activeLab.relatedNodeIds[0])}`} className="font-sans text-[13px] text-[var(--primary)] hover:underline">
                  对应原理 →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Parameter Bar */}
        {showAdvancedParams && activeLab && (
          <div className="pt-2.5 border-t border-[var(--border)] flex flex-wrap items-end gap-3 text-xs">
            <label className="block space-y-1">
              <span className="text-[var(--text-sec)] font-mono">seed</span>
              <Input
                type="number"
                controlSize="xs"
                className="w-20 font-mono"
                value={seed}
                onChange={(e) => {
                  const val = Number(e.target.value) || 42;
                  setSeed(val);
                  recomputeSim(val, params, faultInjection);
                }}
              />
            </label>
            {Object.entries(params).map(([key, val]) => (
              <label key={key} className="block space-y-1">
                <span className="text-[var(--text-sec)] font-mono">{key}</span>
                {typeof val === 'boolean' ? (
                  <div className="h-7 flex items-center">
                    <Checkbox
                      checked={val}
                      label={val ? '开启' : '关闭'}
                      onChange={(e) => {
                        const next = { ...params, [key]: e.target.checked };
                        setParams(next);
                        recomputeSim(seed, next, faultInjection);
                      }}
                    />
                  </div>
                ) : key === 'strategy' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="hybrid-rerank">hybrid-rerank</option>
                    <option value="bm25">bm25</option>
                    <option value="vector">vector</option>
                  </Select>
                ) : key === 'compressionMode' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="compact">compact</option>
                    <option value="filter-tool">filter-tool</option>
                    <option value="truncate-head">truncate-head</option>
                  </Select>
                ) : key === 'topology' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="supervisor">supervisor</option>
                    <option value="parallel">parallel</option>
                    <option value="single-agent">single-agent</option>
                  </Select>
                ) : key === 'writePolicy' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="upsert-versioned">upsert-versioned</option>
                    <option value="append-only">append-only</option>
                  </Select>
                ) : key === 'sandboxMode' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="workspace-write">workspace-write</option>
                    <option value="read-only">read-only</option>
                    <option value="unrestricted-danger">unrestricted-danger</option>
                  </Select>
                ) : key === 'grader' ? (
                  <Select
                    controlSize="xs"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  >
                    <option value="deterministic-plus-judge">deterministic-plus-judge</option>
                    <option value="deterministic-only">deterministic-only</option>
                    <option value="llm-judge-only">llm-judge-only</option>
                  </Select>
                ) : typeof val === 'number' ? (
                  <Input
                    type="number"
                    controlSize="xs"
                    className="w-24 font-mono"
                    step={val < 1 ? 0.05 : 1}
                    value={val}
                    onChange={(e) => {
                      const next = { ...params, [key]: Number(e.target.value) };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  />
                ) : (
                  <Input
                    type="text"
                    controlSize="xs"
                    className="w-52"
                    value={String(val)}
                    onChange={(e) => {
                      const next = { ...params, [key]: e.target.value };
                      setParams(next);
                      recomputeSim(seed, next, faultInjection);
                    }}
                  />
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Top Execution Flow Canvas */}
      <div className="flex-1 min-h-[200px] overflow-hidden relative">
        <ElkFlowCanvas
          nodes={graphData.nodes}
          edges={graphData.edges}
          direction="RIGHT"
          showMiniMap={false}
          onNodeClick={(nid) => {
            const matchIdx = simResult?.steps.findIndex((s) => s.nodeId === nid);
            if (matchIdx !== undefined && matchIdx >= 0) {
              setCursor(matchIdx);
              setPlayStatus('paused');
            }
          }}
        />
      </div>

      {/* Bottom Debugger Inspector */}
      <div className="h-[260px] shrink-0 border-t border-[var(--border)] bg-[var(--panel)] grid grid-cols-1 md:grid-cols-12 overflow-hidden">
        {/* Step Timeline */}
        <div className="md:col-span-6 border-b md:border-b-0 md:border-r border-[var(--border)] flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--panel-sec)] flex items-center justify-between text-[13px] shrink-0">
            <span className="font-semibold">执行步骤过程</span>
            {simResult && (
              <span className="font-mono text-xs text-[var(--text-sec)]">
                simulated {simResult.metrics.simulatedTotalLatencyMs}ms · {simResult.metrics.simulatedTotalTokens} tok
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {simResult?.steps.map((step) => {
              const active = cursor === step.stepIndex;
              return (
                <button
                  key={step.stepIndex}
                  type="button"
                  onClick={() => {
                    setCursor(step.stepIndex);
                    setPlayStatus('paused');
                  }}
                  className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    active ? 'bg-[var(--selected-bg)]' : 'hover:bg-[var(--panel-hover)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-xs text-[var(--text-muted)] w-6 shrink-0">
                      #{step.stepIndex + 1}
                    </span>
                    <span
                      className={`font-mono text-xs shrink-0 ${
                        step.status === 'error'
                          ? 'text-[var(--error)] font-semibold'
                          : step.status === 'warning' || step.status === 'interrupted'
                            ? 'text-[var(--warning)] font-semibold'
                            : 'text-[var(--success)]'
                      }`}
                    >
                      {step.status === 'error'
                        ? '异常'
                        : step.status === 'warning'
                          ? '警告'
                          : step.status === 'interrupted'
                            ? '中断'
                            : '正常'}
                    </span>
                    <span className={`truncate ${active ? 'font-semibold text-[var(--primary)]' : 'font-medium text-[var(--text)]'}`}>
                      {step.title}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-[var(--text-muted)] shrink-0">
                    {step.simulatedLatencyMs}ms
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Diff & State Inspector */}
        <div className="md:col-span-6 flex flex-col overflow-hidden">
          <div className="px-4 border-b border-[var(--border)] bg-[var(--panel-sec)] flex items-center justify-between gap-2 shrink-0">
            <Tabs
              ariaLabel="状态检查器标签"
              variant="underline"
              value={inspectorTab}
              onChange={setInspectorTab}
              className="border-b-0"
              items={[
                { id: 'explain', label: '步骤与 Diff' },
                { id: 'state', label: '完整 State' },
                { id: 'json', label: '原始事件' },
              ]}
            />
            {simResult && (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={copiedJson ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
                onClick={() => {
                  navigator.clipboard
                    .writeText(JSON.stringify(simResult, null, 2))
                    .then(() => {
                      setCopiedJson(true);
                      toast.success('已复制完整模拟 JSON');
                      setTimeout(() => setCopiedJson(false), 1500);
                    })
                    .catch(() => toast.error('复制失败'));
                }}
              >
                导出 JSON
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 text-[13px] space-y-3">
            {currentStep ? (
              inspectorTab === 'explain' ? (
                <>
                  <div className="space-y-1">
                    <div className="font-semibold text-sm">{currentStep.title}</div>
                    <p className="text-[var(--text-sec)] leading-relaxed">{currentStep.detail}</p>
                  </div>
                  <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
                    <div className="font-medium text-[var(--text-sec)]">本步 State 变更 (Diff)</div>
                    {stateDiffs.length === 0 ? (
                      <div className="text-[var(--text-muted)]">本步未修改共享状态变量。</div>
                    ) : (
                      <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] space-y-1 font-mono text-xs">
                        {stateDiffs.map((d) => (
                          <div key={d.key} className="break-all">
                            <span className="font-semibold text-[var(--primary)]">{d.key}</span>:{' '}
                            <span className="text-[var(--text-muted)] line-through">{JSON.stringify(d.prev)}</span> →{' '}
                            <span className="text-[var(--success)]">{JSON.stringify(d.next)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : inspectorTab === 'state' ? (
                <pre className="p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] font-mono text-xs overflow-x-auto">
                  {JSON.stringify(currentStep.stateSnapshot, null, 2)}
                </pre>
              ) : (
                <pre className="p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] font-mono text-xs overflow-x-auto">
                  {JSON.stringify(currentStep, null, 2)}
                </pre>
              )
            ) : (
              <div className="text-[var(--text-muted)]">暂无步骤。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
