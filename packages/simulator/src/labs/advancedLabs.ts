import { SimRunResult, SimStepEvent } from '@agent-atlas/shared';
import { buildSimResult, createSeededRng, seededInt } from '../prng.js';
import { SimInput } from './coreLabs.js';

export function runMemoryLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const policy = String(input.params?.writePolicy ?? 'upsert-versioned');
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'working', label: 'Working Memory (会话缓冲)', kind: 'start' as const },
    { id: 'extract', label: '提取事实/偏好', kind: 'llm' as const },
    { id: 'conflict', label: '冲突与时效校验', kind: 'decision' as const },
    { id: 'semantic', label: 'Semantic Store (长期记忆)', kind: 'memory' as const },
    { id: 'done', label: '记忆更新完成', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'working', target: 'extract' },
    { id: 'e2', source: 'extract', target: 'conflict' },
    { id: 'e3', source: 'conflict', target: 'semantic' },
    { id: 'e4', source: 'semantic', target: 'done' },
  ];

  const existingMemory = [
    { key: 'user.preferred_framework', value: 'LangGraph', revision: 1, updatedAt: '2026-10-01' },
    { key: 'project.runtime', value: 'Node.js 24 + SQLite', revision: 1, updatedAt: '2026-11-20' },
  ];
  const incomingFact = { key: 'user.preferred_framework', value: 'PydanticAI (纯强类型 Python 项目)', revision: 2 };
  const initialState = { policy, semanticStore: existingMemory, workingBuffer: ['用户表示新项目改用 PydanticAI'], conflictDetected: false };

  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'working',
      status: 'ok',
      phase: 'observe',
      title: '读取当前对话 Working Memory',
      detail: '捕获用户新偏好声明，准备判断是否写入长期记忆',
      inputSnapshot: { buffer: initialState.workingBuffer },
      outputSnapshot: { candidateCount: 1 },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: 12,
      simulatedTokens: 45,
      simulated: true,
    },
    {
      stepIndex: 1,
      nodeId: 'extract',
      status: 'ok',
      phase: 'extract',
      title: '抽取出结构化记忆三元组',
      detail: `${incomingFact.key} -> ${incomingFact.value}`,
      inputSnapshot: { rawText: initialState.workingBuffer[0] },
      outputSnapshot: incomingFact,
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: seededInt(rng, 140, 220),
      simulatedTokens: 90,
      simulated: true,
    },
  ];

  const isAppendOnlyFault = fault === 'stale-conflict' || policy === 'append-only';
  const updatedStore = isAppendOnlyFault
    ? [...existingMemory, { ...incomingFact, updatedAt: '2026-11-26' }]
    : [
        { ...incomingFact, updatedAt: '2026-11-26' },
        existingMemory[1],
      ];

  steps.push({
    stepIndex: 2,
    nodeId: 'conflict',
    status: isAppendOnlyFault ? 'warning' : 'ok',
    phase: 'reconcile',
    title: isAppendOnlyFault ? '检测到同名键冲突但未覆盖旧记忆' : '检测到旧版本事实并执行版本覆盖',
    detail: isAppendOnlyFault
      ? '故障/策略风险：append-only 模式同时保留两条矛盾偏好，后续检索将产生歧义'
      : '保留审计历史并将 revision=2 置为当前有效记忆',
    inputSnapshot: { old: existingMemory[0], incoming: incomingFact },
    outputSnapshot: { strategy: isAppendOnlyFault ? 'duplicate-kept' : 'superseded-old' },
    stateSnapshot: { policy, semanticStore: existingMemory, workingBuffer: initialState.workingBuffer, conflictDetected: true },
    simulatedLatencyMs: 18,
    simulatedTokens: 0,
    simulated: true,
  });

  const finalState = { policy, semanticStore: updatedStore, workingBuffer: [], conflictDetected: true };
  steps.push({
    stepIndex: 3,
    nodeId: 'semantic',
    status: isAppendOnlyFault ? 'warning' : 'ok',
    phase: 'persist',
    title: '持久化至 Semantic Memory',
    detail: `当前长期记忆条数: ${updatedStore.length}`,
    inputSnapshot: { count: updatedStore.length },
    outputSnapshot: { semanticStore: updatedStore },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 20,
    simulatedTokens: 0,
    simulated: true,
  });
  steps.push({
    stepIndex: 4,
    nodeId: 'done',
    status: isAppendOnlyFault ? 'warning' : 'ok',
    phase: 'done',
    title: '记忆生命周期步骤完成',
    detail: isAppendOnlyFault ? '警告：存在未解决的记忆冲突' : '记忆一致性维护正常',
    inputSnapshot: {},
    outputSnapshot: { consistent: !isAppendOnlyFault },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 8,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'memory',
    seed,
    params: { writePolicy: policy },
    faultInjection: fault,
    status: isAppendOnlyFault ? 'failed' : 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState,
  });
}

export function runWorkflowLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const autoApprove = Boolean(input.params?.autoApprove ?? true);
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'fetch', label: '1. 采集与清洗', kind: 'tool' as const },
    { id: 'cp1', label: 'Checkpoint #1', kind: 'checkpoint' as const },
    { id: 'analyze', label: '2. 影响分析', kind: 'llm' as const },
    { id: 'approval', label: '3. Human Approval', kind: 'human' as const },
    { id: 'apply', label: '4. 幂等发布写入', kind: 'tool' as const },
    { id: 'done', label: 'Workflow Completed', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'fetch', target: 'cp1' },
    { id: 'e2', source: 'cp1', target: 'analyze' },
    { id: 'e3', source: 'analyze', target: 'approval' },
    { id: 'e4', source: 'approval', target: 'apply', label: 'approved', conditional: true },
    { id: 'e5', source: 'apply', target: 'done' },
  ];

  const initialState = { checkpointId: null, retries: 0, approved: null, idempotencyKey: `wf-${seed}-001`, published: false };
  let state: Record<string, unknown> = structuredClone(initialState);
  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'fetch',
      status: 'ok',
      phase: 'stage-1',
      title: '执行确定性节点：采集变更',
      detail: '成功读取变更集（无需 LLM 参与）',
      inputSnapshot: { source: 'release-bundle' },
      outputSnapshot: { filesChanged: 3 },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 35,
      simulatedTokens: 0,
      simulated: true,
    },
  ];

  state = { ...state, checkpointId: 'cp-1' };
  steps.push({
    stepIndex: 1,
    nodeId: 'cp1',
    status: 'ok',
    phase: 'checkpoint',
    title: '保存 Checkpoint #1 到持久存储',
    detail: '持久化当前状态，崩溃恢复时将跳过 stage-1',
    inputSnapshot: { checkpointId: 'cp-1' },
    outputSnapshot: { saved: true },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: 12,
    simulatedTokens: 0,
    simulated: true,
  });

  if (fault === 'transient-crash') {
    state = { ...state, retries: 1 };
    steps.push({
      stepIndex: 2,
      nodeId: 'analyze',
      status: 'error',
      phase: 'stage-2',
      title: '节点 analyze 遭遇瞬时故障，中断后从 cp-1 恢复',
      detail: '故障注入：进程重启，直接加载 Checkpoint #1 状态，避免重跑 fetch 节点',
      inputSnapshot: { checkpointId: 'cp-1' },
      outputSnapshot: { recoveredFrom: 'cp-1', retries: 1 },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 120,
      simulatedTokens: 0,
      simulated: true,
    });
  }

  steps.push({
    stepIndex: steps.length,
    nodeId: 'analyze',
    status: 'ok',
    phase: 'stage-2',
    title: '分析影响范围与风险摘要',
    detail: '生成供人工审批的风险摘要',
    inputSnapshot: { fromCheckpoint: state.checkpointId },
    outputSnapshot: { riskLevel: 'medium' },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: seededInt(rng, 160, 280),
    simulatedTokens: 145,
    simulated: true,
  });

  const rejected = fault === 'reject-approval' || !autoApprove;
  state = { ...state, approved: !rejected };
  steps.push({
    stepIndex: steps.length,
    nodeId: 'approval',
    status: rejected ? 'interrupted' : 'ok',
    phase: 'hitl',
    title: rejected ? '人工审批拒绝发布 (Human Interrupt)' : '人工审批通过，允许继续写操作',
    detail: rejected ? '工作流安全暂停，未触发任何破坏性变更' : '审批人确认 idempotencyKey 后放行',
    inputSnapshot: { riskLevel: 'medium' },
    outputSnapshot: { approved: !rejected },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: 40,
    simulatedTokens: 0,
    simulated: true,
  });

  if (rejected) {
    return buildSimResult({
      labId: 'workflow',
      seed,
      params: { autoApprove },
      faultInjection: fault,
      status: 'cancelled',
      graphNodes,
      graphEdges,
      steps,
      initialState,
      finalState: state,
    });
  }

  state = { ...state, published: true };
  steps.push({
    stepIndex: steps.length,
    nodeId: 'apply',
    status: 'ok',
    phase: 'stage-4',
    title: '携带幂等键执行最终写入',
    detail: `idempotencyKey=${String(state.idempotencyKey)}，保证重试不重复写入`,
    inputSnapshot: { idempotencyKey: state.idempotencyKey },
    outputSnapshot: { published: true },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: 42,
    simulatedTokens: 0,
    simulated: true,
  });
  steps.push({
    stepIndex: steps.length,
    nodeId: 'done',
    status: 'ok',
    phase: 'done',
    title: 'Durable Workflow 执行完成',
    detail: '可追溯检查点、重试与审批链路已归档',
    inputSnapshot: {},
    outputSnapshot: { completed: true },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: 8,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'workflow',
    seed,
    params: { autoApprove },
    faultInjection: fault,
    status: 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState: state,
  });
}

export function runMultiAgentLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const topology = String(input.params?.topology ?? 'supervisor');
  const fault = input.faultInjection ?? null;

  const graphNodes =
    topology === 'single-agent'
      ? [
          { id: 'single', label: 'Single Agent (全流程顺序工具)', kind: 'llm' as const },
          { id: 'done', label: '交付报告', kind: 'end' as const },
        ]
      : [
          { id: 'sup', label: 'Supervisor (任务拆解/路由)', kind: 'llm' as const },
          { id: 'w1', label: 'Worker A (检索)', kind: 'worker' as const },
          { id: 'w2', label: 'Worker B (代码分析)', kind: 'worker' as const },
          { id: 'merge', label: '综合与冲突消解', kind: 'decision' as const },
          { id: 'done', label: '交付报告', kind: 'end' as const },
        ];
  const graphEdges =
    topology === 'single-agent'
      ? [{ id: 'e1', source: 'single', target: 'done' }]
      : [
          { id: 'e1', source: 'sup', target: 'w1', label: 'handoff' },
          { id: 'e2', source: 'sup', target: 'w2', label: 'handoff' },
          { id: 'e3', source: 'w1', target: 'merge' },
          { id: 'e4', source: 'w2', target: 'merge' },
          { id: 'e5', source: 'merge', target: 'done' },
        ];

  const initialState = { topology, handoffs: 0, parallel: topology === 'parallel', contextLossDetected: false };
  const steps: SimStepEvent[] = [];

  if (topology === 'single-agent') {
    const finalState = { topology, handoffs: 0, parallel: false, contextLossDetected: false };
    steps.push({
      stepIndex: 0,
      nodeId: 'single',
      status: 'ok',
      phase: 'single',
      title: 'Single Agent 单上下文完成检索与分析',
      detail: '0 次交接开销、无跨 Agent 状态同步损耗，适用于中等复杂度单一任务',
      inputSnapshot: { topology },
      outputSnapshot: { handoffs: 0, tokenEfficiency: 'high' },
      stateSnapshot: structuredClone(finalState),
      simulatedLatencyMs: seededInt(rng, 240, 360),
      simulatedTokens: 310,
      simulated: true,
    });
    steps.push({
      stepIndex: 1,
      nodeId: 'done',
      status: 'ok',
      phase: 'done',
      title: '单 Agent 输出交付完成',
      detail: '总计 1 次模型循环，无序列化交接成本',
      inputSnapshot: {},
      outputSnapshot: { completed: true },
      stateSnapshot: structuredClone(finalState),
      simulatedLatencyMs: 10,
      simulatedTokens: 0,
      simulated: true,
    });
    return buildSimResult({
      labId: 'multi-agent',
      seed,
      params: { topology },
      faultInjection: fault,
      status: 'completed',
      graphNodes,
      graphEdges,
      steps,
      initialState,
      finalState,
    });
  }

  const isParallel = topology === 'parallel';
  let state: Record<string, unknown> = { ...initialState, handoffs: 2 };
  const supLatency = seededInt(rng, 160, 260);
  steps.push({
    stepIndex: 0,
    nodeId: 'sup',
    status: 'ok',
    phase: 'dispatch',
    title: isParallel ? 'Supervisor 并行扇出派发子任务' : 'Supervisor 拆解任务并按顺序派发 Handoff',
    detail: isParallel
      ? '通过 Promise.all 同时向 Worker A / Worker B 派发独立子任务（2 次 Handoff，墙钟耗时取较慢分支）'
      : '向 Worker A / Worker B 分发各自隔离的上下文子任务（2 次串行 Handoff）',
    inputSnapshot: { topology },
    outputSnapshot: { subtasks: 2, parallel: isParallel },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: supLatency,
    simulatedTokens: 210,
    simulated: true,
  });

  const w1Latency = seededInt(rng, 180, 280);
  steps.push({
    stepIndex: 1,
    nodeId: 'w1',
    status: 'ok',
    phase: 'worker-a',
    title: 'Worker A 完成资料检索',
    detail: isParallel ? '与 Worker B 并发执行，独立上下文窗口检索资料' : '在独立上下文窗口执行，避免污染主规划上下文',
    inputSnapshot: { worker: 'w1', parallel: isParallel },
    outputSnapshot: { citations: 4 },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: w1Latency,
    simulatedTokens: 260,
    simulated: true,
  });

  const lost = fault === 'handoff-context-loss';
  state = { ...state, contextLossDetected: lost };
  const w2Latency = seededInt(rng, 190, 290);
  steps.push({
    stepIndex: 2,
    nodeId: 'w2',
    status: lost ? 'error' : 'ok',
    phase: 'worker-b',
    title: lost ? 'Worker B 因交接约束丢失做出矛盾结论' : 'Worker B 完成代码影响分析',
    detail: lost ? '故障注入：Handoff 简报遗漏核心约束，Worker B 输出与系统要求冲突' : '返回结构化改动清单',
    inputSnapshot: { worker: 'w2', parallel: isParallel },
    outputSnapshot: { consistent: !lost },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: w2Latency,
    simulatedTokens: 280,
    simulated: true,
  });

  const mergeLatency = 120;
  steps.push({
    stepIndex: 3,
    nodeId: 'merge',
    status: lost ? 'warning' : 'ok',
    phase: 'merge',
    title: lost ? '汇总阶段发现上下文冲突' : '综合多 Worker 输出',
    detail: lost ? '需重新向 Worker 下发完整约束或退回单 Agent 处理' : '多视角结果一致，合并为最终交付',
    inputSnapshot: { w1: 'ok', w2: lost ? 'conflict' : 'ok' },
    outputSnapshot: { conflict: lost },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: mergeLatency,
    simulatedTokens: 190,
    simulated: true,
  });

  const doneLatency = 10;
  const wallLatency = isParallel
    ? supLatency + Math.max(w1Latency, w2Latency) + mergeLatency + doneLatency
    : supLatency + w1Latency + w2Latency + mergeLatency + doneLatency;

  steps.push({
    stepIndex: 4,
    nodeId: 'done',
    status: lost ? 'warning' : 'ok',
    phase: 'done',
    title: 'Multi-Agent 协同周期结束',
    detail: isParallel
      ? `并发扇出降低墙钟总延迟至 ${wallLatency}ms，但总 Token 消耗仍高于 Single Agent`
      : `总 Token 开销显著高于 Single Agent（模拟成本对比演示）`,
    inputSnapshot: {},
    outputSnapshot: { handoffs: 2, wallLatencyMs: wallLatency },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: doneLatency,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'multi-agent',
    seed,
    params: { topology },
    faultInjection: fault,
    status: lost ? 'failed' : 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState: state,
    simulatedTotalLatencyMs: wallLatency,
  });
}

export function runHarnessLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const sandbox = String(input.params?.sandboxMode ?? 'workspace-write');
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'ctx', label: '读取 AGENTS.md 与目录上下文', kind: 'start' as const },
    { id: 'plan', label: '生成最小补丁计划', kind: 'llm' as const },
    { id: 'perm', label: `权限与沙箱门禁 (${sandbox})`, kind: 'decision' as const },
    { id: 'test', label: '运行单测与类型检查', kind: 'tool' as const },
    { id: 'done', label: '验证通过并记录交接进度', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'ctx', target: 'plan' },
    { id: 'e2', source: 'plan', target: 'perm' },
    { id: 'e3', source: 'perm', target: 'test', label: 'allowed', conditional: true },
    { id: 'e4', source: 'test', target: 'plan', label: 'test_failed', conditional: true },
    { id: 'e5', source: 'test', target: 'done', label: 'green', conditional: true },
  ];

  const initialState = { sandbox, targetPath: 'src/validator.ts', testsPassed: false, blocked: false };
  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'ctx',
      status: 'ok',
      phase: 'bootstrap',
      title: '加载仓库约束与运行预算',
      detail: '读取 AGENTS.md 规范与工作区只读/可写边界',
      inputSnapshot: { sandbox },
      outputSnapshot: { rulesLoaded: true },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: 18,
      simulatedTokens: 120,
      simulated: true,
    },
    {
      stepIndex: 1,
      nodeId: 'plan',
      status: 'ok',
      phase: 'patch',
      title: '生成最小修复补丁',
      detail: fault === 'escape-sandbox' ? '尝试写入工作区外路径 C:\\Windows\\System32\\drivers\\etc\\hosts' : '修改 src/validator.ts 边界检查',
      inputSnapshot: { target: fault === 'escape-sandbox' ? 'C:\\Windows\\System32\\hosts' : 'src/validator.ts' },
      outputSnapshot: { diffLines: 6 },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: seededInt(rng, 180, 290),
      simulatedTokens: 165,
      simulated: true,
    },
  ];

  if (sandbox === 'read-only') {
    const readOnlyState = { ...initialState, blocked: true, reason: 'READ_ONLY_SANDBOX' };
    steps.push({
      stepIndex: 2,
      nodeId: 'perm',
      status: 'interrupted',
      phase: 'guard',
      title: '只读沙箱阻断写补丁操作',
      detail: '当前处于 read-only 模式，任何文件写入均需人工确认或升级到 workspace-write 沙箱',
      inputSnapshot: { sandbox, targetPath: fault === 'escape-sandbox' ? 'C:\\Windows\\System32\\hosts' : 'src/validator.ts' },
      outputSnapshot: { allowed: false, reason: 'READ_ONLY_SANDBOX' },
      stateSnapshot: structuredClone(readOnlyState),
      simulatedLatencyMs: 5,
      simulatedTokens: 0,
      simulated: true,
    });
    return buildSimResult({
      labId: 'harness-engineering',
      seed,
      params: { sandboxMode: sandbox },
      faultInjection: fault,
      status: 'cancelled',
      graphNodes,
      graphEdges,
      steps,
      initialState,
      finalState: readOnlyState,
    });
  }

  if (fault === 'escape-sandbox') {
    if (sandbox === 'unrestricted-danger') {
      const unsafeState = { ...initialState, targetPath: 'C:\\Windows\\System32\\hosts', blocked: false, unsafeWriteOccurred: true };
      steps.push({
        stepIndex: 2,
        nodeId: 'perm',
        status: 'error',
        phase: 'guard',
        title: '高危无沙箱模式放行了越权路径写入！',
        detail: '警告：unrestricted-danger 关闭了路径边界检查，导致工作区外系统文件暴露在修改风险中',
        inputSnapshot: { targetPath: unsafeState.targetPath, sandbox },
        outputSnapshot: { allowed: true, unsafeWriteOccurred: true },
        stateSnapshot: structuredClone(unsafeState),
        simulatedLatencyMs: 5,
        simulatedTokens: 0,
        simulated: true,
      });
      return buildSimResult({
        labId: 'harness-engineering',
        seed,
        params: { sandboxMode: sandbox },
        faultInjection: fault,
        status: 'failed',
        graphNodes,
        graphEdges,
        steps,
        initialState,
        finalState: unsafeState,
      });
    }

    const blockedState = { ...initialState, targetPath: 'C:\\Windows\\System32\\hosts', blocked: true };
    steps.push({
      stepIndex: 2,
      nodeId: 'perm',
      status: 'error',
      phase: 'guard',
      title: '沙箱门禁拦截越权路径写入',
      detail: '检测到工作区外绝对路径，Harness 立即拒绝写入并记录安全事件',
      inputSnapshot: { targetPath: blockedState.targetPath },
      outputSnapshot: { allowed: false, reason: 'OUTSIDE_WORKSPACE' },
      stateSnapshot: structuredClone(blockedState),
      simulatedLatencyMs: 5,
      simulatedTokens: 0,
      simulated: true,
    });
    return buildSimResult({
      labId: 'harness-engineering',
      seed,
      params: { sandboxMode: sandbox },
      faultInjection: fault,
      status: 'failed',
      graphNodes,
      graphEdges,
      steps,
      initialState,
      finalState: blockedState,
    });
  }

  const isUnrestricted = sandbox === 'unrestricted-danger';
  steps.push({
    stepIndex: 2,
    nodeId: 'perm',
    status: isUnrestricted ? 'warning' : 'ok',
    phase: 'guard',
    title: isUnrestricted ? '无沙箱隔离放行（存在越权风险告警）' : '沙箱路径与命令权限校验通过',
    detail: isUnrestricted
      ? '当前模式缺少路径白名单保护，生产环境应切回 workspace-write'
      : '路径位于允许工作区内，放行补丁应用',
    inputSnapshot: { targetPath: 'src/validator.ts', sandbox },
    outputSnapshot: { allowed: true },
    stateSnapshot: structuredClone(initialState),
    simulatedLatencyMs: 7,
    simulatedTokens: 0,
    simulated: true,
  });

  if (fault === 'test-fail-loop') {
    steps.push({
      stepIndex: 3,
      nodeId: 'test',
      status: 'warning',
      phase: 'verify-1',
      title: '第 1 次测试反馈：边界用例失败',
      detail: '把失败栈回传给 Harness，触发模型定向修复',
      inputSnapshot: { command: 'vitest run' },
      outputSnapshot: { passed: 4, failed: 1 },
      stateSnapshot: { ...initialState, testsPassed: false },
      simulatedLatencyMs: 240,
      simulatedTokens: 0,
      simulated: true,
    });
    steps.push({
      stepIndex: 4,
      nodeId: 'plan',
      status: 'ok',
      phase: 'repair',
      title: '根据失败测试定位并修补空值守卫',
      detail: '更新补丁后重跑回归测试',
      inputSnapshot: { failedTest: 'handles empty array' },
      outputSnapshot: { diffLines: 3 },
      stateSnapshot: { ...initialState, testsPassed: false },
      simulatedLatencyMs: seededInt(rng, 160, 240),
      simulatedTokens: 135,
      simulated: true,
    });
  }

  const finalState = { ...initialState, testsPassed: true };
  steps.push({
    stepIndex: steps.length,
    nodeId: 'test',
    status: 'ok',
    phase: 'verify',
    title: '测试与类型检查全部通过',
    detail: 'vitest run -> 5/5 passed (模拟验证结果)',
    inputSnapshot: { command: 'vitest run' },
    outputSnapshot: { passed: 5, failed: 0 },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 220,
    simulatedTokens: 0,
    simulated: true,
  });
  steps.push({
    stepIndex: steps.length,
    nodeId: 'done',
    status: isUnrestricted ? 'warning' : 'ok',
    phase: 'done',
    title: 'Harness 工程闭环交付完成',
    detail: '写入任务检查点供跨会话交接',
    inputSnapshot: {},
    outputSnapshot: { completed: true },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 12,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'harness-engineering',
    seed,
    params: { sandboxMode: sandbox },
    faultInjection: fault,
    status: 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState,
  });
}

export function runEvalsLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const grader = String(input.params?.grader ?? 'deterministic-plus-judge');
  const threshold = Number(input.params?.passThreshold ?? 0.8);
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'dataset', label: '加载 Golden Dataset (5 Cases)', kind: 'start' as const },
    { id: 'run', label: '批量回放 Trace', kind: 'tool' as const },
    { id: 'grade', label: `评分器 (${grader})`, kind: 'decision' as const },
    { id: 'gate', label: `回归门禁 (阈值 >= ${threshold})`, kind: 'checkpoint' as const },
    { id: 'done', label: '生成 Eval 报告', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'dataset', target: 'run' },
    { id: 'e2', source: 'run', target: 'grade' },
    { id: 'e3', source: 'grade', target: 'gate' },
    { id: 'e4', source: 'gate', target: 'done' },
  ];

  const isDeterministicOnly = grader === 'deterministic-only';
  const isLlmJudgeOnly = grader === 'llm-judge-only';
  const baseScores = isDeterministicOnly ? [1, 1, 1, 0.85, 0.85] : [1, 1, 1, 0.85, 0.9];
  const driftTriggered = fault === 'judge-drift' && !isDeterministicOnly;
  const scores = driftTriggered
    ? isLlmJudgeOnly
      ? [0.8, 0.5, 0.4, 0.5, 0.6]
      : [1, 0.6, 0.5, 0.7, 0.8]
    : baseScores;
  const passRate = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));
  const passedGate = passRate >= threshold;

  const initialState = { grader, threshold, caseCount: 5, passRate: null, passedGate: null };
  const finalState = { grader, threshold, caseCount: 5, passRate, passedGate };

  const gradeTokens = isDeterministicOnly ? 0 : isLlmJudgeOnly ? 280 : 180;
  const gradeLatency = isDeterministicOnly ? 18 : seededInt(rng, 140, 210);

  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'dataset',
      status: 'ok',
      phase: 'load',
      title: '加载 5 条代表性回归用例',
      detail: '覆盖工具调用校验、边界拒答、格式规范与引用真实性',
      inputSnapshot: { caseCount: 5 },
      outputSnapshot: { loaded: true },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: 15,
      simulatedTokens: 0,
      simulated: true,
    },
    {
      stepIndex: 1,
      nodeId: 'run',
      status: 'ok',
      phase: 'execute',
      title: '回放目标 Agent 并采集 Trace',
      detail: '记录每条用例的工具调用序列、延迟与错误码',
      inputSnapshot: { seed },
      outputSnapshot: { traces: 5 },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: seededInt(rng, 220, 360),
      simulatedTokens: 320,
      simulated: true,
    },
    {
      stepIndex: 2,
      nodeId: 'grade',
      status: driftTriggered ? 'warning' : 'ok',
      phase: 'score',
      title: driftTriggered
        ? 'LLM-as-Judge 出现评分漂移与偏见'
        : isDeterministicOnly
          ? '执行纯确定性规则断言（零 Judge 漂移）'
          : isLlmJudgeOnly
            ? '执行纯 LLM-as-Judge 评分'
            : '完成混合评分（规则断言 + Judge）',
      detail: driftTriggered
        ? '故障注入：未固定温度/Rubric 的 Judge 对较短正确答案给出低分，平均分跌至 ' + passRate
        : isDeterministicOnly
          ? `纯 Schema/引用确定性断言不受 Judge 漂移影响，通过率 ${passRate}`
          : `加权通过率 ${passRate}`,
      inputSnapshot: { grader, scores },
      outputSnapshot: { passRate },
      stateSnapshot: { ...initialState, passRate },
      simulatedLatencyMs: gradeLatency,
      simulatedTokens: gradeTokens,
      simulated: true,
    },
    {
      stepIndex: 3,
      nodeId: 'gate',
      status: passedGate ? 'ok' : 'error',
      phase: 'gate',
      title: passedGate ? `门禁放行 (${passRate} >= ${threshold})` : `门禁阻断回归 (${passRate} < ${threshold})`,
      detail: passedGate ? '满足发布基线' : '拦截此次 Prompt/模型变更合入主干',
      inputSnapshot: { passRate, threshold },
      outputSnapshot: { passedGate },
      stateSnapshot: structuredClone(finalState),
      simulatedLatencyMs: 10,
      simulatedTokens: 0,
      simulated: true,
    },
    {
      stepIndex: 4,
      nodeId: 'done',
      status: passedGate ? 'ok' : 'warning',
      phase: 'done',
      title: 'Eval 评估流水线完成',
      detail: `passRate=${passRate}, passedGate=${String(passedGate)}`,
      inputSnapshot: {},
      outputSnapshot: finalState,
      stateSnapshot: structuredClone(finalState),
      simulatedLatencyMs: 8,
      simulatedTokens: 0,
      simulated: true,
    },
  ];

  return buildSimResult({
    labId: 'evals',
    seed,
    params: { grader, passThreshold: threshold },
    faultInjection: fault,
    status: passedGate ? 'completed' : 'failed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState,
  });
}
