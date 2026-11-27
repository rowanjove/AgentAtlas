import { SimRunResult, SimStepEvent } from '@agent-atlas/shared';
import { buildSimResult, createSeededRng, seededInt } from '../prng.js';

export interface SimInput {
  seed?: number;
  params?: Record<string, unknown>;
  faultInjection?: string | null;
}

export function runAgentLoopLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const maxSteps = Math.min(8, Math.max(2, Number(input.params?.maxSteps ?? 4)));
  const goal = String(input.params?.goal ?? '核查本地仓库 package.json 依赖并生成摘要');
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'init', label: '初始化目标与上下文', kind: 'start' as const },
    { id: 'llm', label: '模型决策 (Plan/Next Action)', kind: 'llm' as const },
    { id: 'tool', label: '执行工具 (Tool Runner)', kind: 'tool' as const },
    { id: 'stop_check', label: '停止条件评估', kind: 'decision' as const },
    { id: 'done', label: '输出最终结论', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'init', target: 'llm' },
    { id: 'e2', source: 'llm', target: 'tool', label: 'tool_call' },
    { id: 'e3', source: 'tool', target: 'stop_check', label: 'observation' },
    { id: 'e4', source: 'stop_check', target: 'llm', label: 'continue', conditional: true },
    { id: 'e5', source: 'stop_check', target: 'done', label: 'stop_reason', conditional: true },
  ];

  const initialState = { goal, step: 0, maxSteps, tool_calls: [], stop_reason: null };
  const steps: SimStepEvent[] = [];
  let state: Record<string, unknown> = structuredClone(initialState);

  steps.push({
    stepIndex: 0,
    nodeId: 'init',
    status: 'ok',
    phase: 'init',
    title: '初始化任务状态',
    detail: `装载目标「${goal}」，设置最大步数预算 maxSteps=${maxSteps}`,
    inputSnapshot: { goal, maxSteps },
    outputSnapshot: { ready: true },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: seededInt(rng, 18, 35),
    simulatedTokens: 120,
    simulated: true,
  });

  let finalStatus: SimRunResult['status'] = 'completed';
  const effectiveIterations = fault === 'no-stop-condition' ? maxSteps : Math.min(2, maxSteps);

  for (let i = 1; i <= effectiveIterations; i++) {
    const toolName = i === 1 ? 'read_workspace_file' : 'summarize_dependencies';
    state = { ...state, step: i, tool_calls: [...(state.tool_calls as string[]), toolName] };

    steps.push({
      stepIndex: steps.length,
      nodeId: 'llm',
      status: 'ok',
      phase: `iteration-${i}`,
      title: `第 ${i} 轮决策：选择工具 ${toolName}`,
      detail: `根据当前观察结果，决定调用 ${toolName} 获取下一阶段证据`,
      inputSnapshot: { step: i, historyCount: (state.tool_calls as string[]).length - 1 },
      outputSnapshot: { action: 'tool_call', tool: toolName },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 220, 420),
      simulatedTokens: seededInt(rng, 180, 290),
      simulated: true,
    });

    if (fault === 'tool-timeout' && i === 1) {
      state = { ...state, lastError: 'TOOL_TIMEOUT_AFTER_5000MS', stop_reason: 'tool_error_abort' };
      steps.push({
        stepIndex: steps.length,
        nodeId: 'tool',
        status: 'error',
        phase: `iteration-${i}`,
        title: `工具 ${toolName} 执行超时`,
        detail: '故障注入触发：工具超过 5000ms 未响应，执行循环中止以防止无限阻塞',
        inputSnapshot: { tool: toolName, timeoutMs: 5000 },
        outputSnapshot: { error: 'ETIMEDOUT' },
        stateSnapshot: structuredClone(state),
        simulatedLatencyMs: 5000,
        simulatedTokens: 0,
        simulated: true,
      });
      finalStatus = 'failed';
      break;
    }

    steps.push({
      stepIndex: steps.length,
      nodeId: 'tool',
      status: 'ok',
      phase: `iteration-${i}`,
      title: `工具 ${toolName} 返回观测结果`,
      detail: i === 1 ? '返回 package.json 依赖清单（模拟数据）' : '完成结构化依赖摘要',
      inputSnapshot: { tool: toolName },
      outputSnapshot: { ok: true, items: i === 1 ? 6 : 1 },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 45, 95),
      simulatedTokens: seededInt(rng, 90, 150),
      simulated: true,
    });

    const isLast = i === effectiveIterations;
    const stopReason = fault === 'no-stop-condition' && isLast
      ? 'max_steps_reached'
      : isLast
        ? 'end_turn_goal_satisfied'
        : null;
    state = { ...state, stop_reason: stopReason };

    steps.push({
      stepIndex: steps.length,
      nodeId: 'stop_check',
      status: fault === 'no-stop-condition' && isLast ? 'warning' : 'ok',
      phase: `iteration-${i}`,
      title: stopReason ? `触发停止条件：${stopReason}` : '信息尚不充分，继续下一轮循环',
      detail:
        fault === 'no-stop-condition' && isLast
          ? `未检测到收敛终止信号，强制命中 maxSteps=${maxSteps} 熔断边界`
          : stopReason
            ? '已获取所需全部信息，准备结束循环'
            : '进入下一轮规划推理',
      inputSnapshot: { step: i, maxSteps },
      outputSnapshot: { stop_reason: stopReason },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 10, 24),
      simulatedTokens: 40,
      simulated: true,
    });
  }

  if (finalStatus === 'completed') {
    steps.push({
      stepIndex: steps.length,
      nodeId: 'done',
      status: fault === 'no-stop-condition' ? 'warning' : 'ok',
      phase: 'finalize',
      title: fault === 'no-stop-condition' ? '预算熔断后返回部分结果' : '循环正常收敛并输出最终答案',
      detail: `共执行 ${state.step} 步，stop_reason=${String(state.stop_reason)}`,
      inputSnapshot: { stop_reason: state.stop_reason },
      outputSnapshot: { delivered: true },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 140, 240),
      simulatedTokens: 160,
      simulated: true,
    });
    if (fault === 'no-stop-condition') finalStatus = 'failed';
  }

  return buildSimResult({
    labId: 'agent-loop',
    seed,
    params: { maxSteps, goal },
    faultInjection: fault,
    status: finalStatus,
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState: state,
  });
}

export function runFunctionCallingLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const queryArg = String(input.params?.query ?? 'MCP architecture');
  const limitArg = Number(input.params?.limit ?? 5);
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'schema', label: '注册 JSON Schema', kind: 'start' as const },
    { id: 'emit_args', label: '模型生成调用参数', kind: 'llm' as const },
    { id: 'validate', label: 'Schema 参数校验', kind: 'decision' as const },
    { id: 'repair', label: '错误回传与参数自修正', kind: 'llm' as const },
    { id: 'exec', label: '沙箱执行工具', kind: 'tool' as const },
    { id: 'done', label: '回填 Tool Result', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'schema', target: 'emit_args' },
    { id: 'e2', source: 'emit_args', target: 'validate' },
    { id: 'e3', source: 'validate', target: 'exec', label: 'valid', conditional: true },
    { id: 'e4', source: 'validate', target: 'repair', label: 'schema_error', conditional: true },
    { id: 'e5', source: 'repair', target: 'validate', label: 'retry' },
    { id: 'e6', source: 'exec', target: 'done' },
  ];

  const schema = {
    name: 'search_knowledge',
    required: ['query', 'limit'],
    properties: { query: { type: 'string', minLength: 2 }, limit: { type: 'integer', minimum: 1, maximum: 20 } },
  };
  const initialArgs =
    fault === 'missing-required'
      ? { limit: limitArg }
      : fault === 'type-mismatch'
        ? { query: queryArg, limit: 'five' }
        : { query: queryArg, limit: limitArg };

  const initialState = { schema, arguments: initialArgs, retries: 0, result: null, error: null };
  let state: Record<string, unknown> = structuredClone(initialState);
  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'schema',
      status: 'ok',
      phase: 'register',
      title: '向模型暴露严格工具 Schema',
      detail: '声明 search_knowledge 的 JSON Schema 约束（query 必填、limit 范围为 1..20）',
      inputSnapshot: { tool: 'search_knowledge' },
      outputSnapshot: schema,
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 12,
      simulatedTokens: 110,
      simulated: true,
    },
    {
      stepIndex: 1,
      nodeId: 'emit_args',
      status: 'ok',
      phase: 'generate',
      title: '生成工具调用参数',
      detail: `产出参数 JSON: ${JSON.stringify(initialArgs)}`,
      inputSnapshot: { prompt: `查找 ${queryArg}` },
      outputSnapshot: { arguments: initialArgs },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 180, 320),
      simulatedTokens: 95,
      simulated: true,
    },
  ];

  const hasError = fault === 'missing-required' || fault === 'type-mismatch' || limitArg < 1 || limitArg > 20 || queryArg.trim().length < 2;
  if (hasError) {
    const errMsg =
      fault === 'missing-required'
        ? "ValidationError: missing required property 'query'"
        : fault === 'type-mismatch'
          ? "ValidationError: 'limit' expected integer, got string 'five'"
          : 'ValidationError: parameter constraints violated';
    state = { ...state, error: errMsg };
    steps.push({
      stepIndex: 2,
      nodeId: 'validate',
      status: 'error',
      phase: 'validate',
      title: 'JSON Schema 校验失败',
      detail: errMsg,
      inputSnapshot: { arguments: initialArgs },
      outputSnapshot: { valid: false, error: errMsg },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 8,
      simulatedTokens: 0,
      simulated: true,
    });

    const repairedArgs = { query: queryArg.trim().length >= 2 ? queryArg : 'agent', limit: Math.min(20, Math.max(1, Number.isFinite(limitArg) ? limitArg : 5)) };
    state = { ...state, arguments: repairedArgs, retries: 1, error: null };
    steps.push({
      stepIndex: 3,
      nodeId: 'repair',
      status: 'warning',
      phase: 'retry',
      title: '回传校验错误并触发自修正重试',
      detail: `将校验错误作为 Tool Error 反馈给模型，修正后参数为 ${JSON.stringify(repairedArgs)}`,
      inputSnapshot: { error: errMsg },
      outputSnapshot: { repairedArgs },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: seededInt(rng, 210, 340),
      simulatedTokens: 130,
      simulated: true,
    });
    steps.push({
      stepIndex: 4,
      nodeId: 'validate',
      status: 'ok',
      phase: 'revalidate',
      title: '二次 Schema 校验通过',
      detail: '所有必填字段与数值边界均满足 Schema 要求',
      inputSnapshot: { arguments: repairedArgs },
      outputSnapshot: { valid: true },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 6,
      simulatedTokens: 0,
      simulated: true,
    });
  } else {
    steps.push({
      stepIndex: 2,
      nodeId: 'validate',
      status: 'ok',
      phase: 'validate',
      title: 'JSON Schema 校验通过',
      detail: '参数类型与必填字段校验一次性通过',
      inputSnapshot: { arguments: initialArgs },
      outputSnapshot: { valid: true },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 6,
      simulatedTokens: 0,
      simulated: true,
    });
  }

  const finalResult = { hits: 3, topMatch: 'tools.mcp-architecture', simulated: true };
  state = { ...state, result: finalResult };
  steps.push({
    stepIndex: steps.length,
    nodeId: 'exec',
    status: 'ok',
    phase: 'execute',
    title: '在受控边界内执行工具函数',
    detail: '返回 3 条匹配的知识条目（模拟检索输出）',
    inputSnapshot: { arguments: state.arguments },
    outputSnapshot: finalResult,
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: seededInt(rng, 25, 60),
    simulatedTokens: 0,
    simulated: true,
  });
  steps.push({
    stepIndex: steps.length,
    nodeId: 'done',
    status: 'ok',
    phase: 'finalize',
    title: '模型综合 Tool Result 输出答复',
    detail: 'Tool Calling 闭环完成',
    inputSnapshot: finalResult,
    outputSnapshot: { completed: true },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: seededInt(rng, 140, 220),
    simulatedTokens: 140,
    simulated: true,
  });

  return buildSimResult({
    labId: 'function-calling',
    seed,
    params: { query: queryArg, limit: limitArg },
    faultInjection: fault,
    status: 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState: state,
  });
}

export function runReactLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const question = String(input.params?.question ?? '为什么长程 Agent 需要显式 Checkpoint？');
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'q', label: '输入推理问题', kind: 'start' as const },
    { id: 'thought', label: 'Thought (显式推理)', kind: 'llm' as const },
    { id: 'action', label: 'Action (调用外部工具)', kind: 'tool' as const },
    { id: 'obs', label: 'Observation (环境反馈)', kind: 'memory' as const },
    { id: 'answer', label: 'Final Answer', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'q', target: 'thought' },
    { id: 'e2', source: 'thought', target: 'action' },
    { id: 'e3', source: 'action', target: 'obs' },
    { id: 'e4', source: 'obs', target: 'thought', label: 'interleave', conditional: true },
    { id: 'e5', source: 'thought', target: 'answer', label: 'sufficient', conditional: true },
  ];

  const initialState = { question, trace: [] as string[], grounded: true };
  let state: Record<string, unknown> = structuredClone(initialState);
  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'q',
      status: 'ok',
      phase: 'input',
      title: '接收问题并启动 ReAct 轨迹',
      detail: question,
      inputSnapshot: { question },
      outputSnapshot: { mode: 'Thought-Action-Observation' },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 15,
      simulatedTokens: 60,
      simulated: true,
    },
    {
      stepIndex: 1,
      nodeId: 'thought',
      status: 'ok',
      phase: 'cycle-1',
      title: 'Thought #1：识别待查证知识域',
      detail: '需要查证工作流检查点与上下文压缩机制，避免仅凭参数记忆回答',
      inputSnapshot: { question },
      outputSnapshot: { thought: 'Search workflow.checkpoint-durability' },
      stateSnapshot: structuredClone({ ...state, trace: ['Thought #1'] }),
      simulatedLatencyMs: seededInt(rng, 180, 260),
      simulatedTokens: 110,
      simulated: true,
    },
  ];

  if (fault === 'hallucinated-tool') {
    state = { question, trace: ['Thought #1', 'Action #1 (invalid_tool)'], grounded: false };
    steps.push({
      stepIndex: 2,
      nodeId: 'action',
      status: 'error',
      phase: 'cycle-1',
      title: 'Action #1：幻觉调用不存在的工具 magic_db_dump',
      detail: '故障注入：模型虚构了未注册工具名，运行时拒绝执行并返回错误观测',
      inputSnapshot: { requestedTool: 'magic_db_dump' },
      outputSnapshot: { error: 'Unknown tool: magic_db_dump' },
      stateSnapshot: structuredClone(state),
      simulatedLatencyMs: 14,
      simulatedTokens: 45,
      simulated: true,
    });
    return buildSimResult({
      labId: 'react',
      seed,
      params: { question },
      faultInjection: fault,
      status: 'failed',
      graphNodes,
      graphEdges,
      steps,
      initialState,
      finalState: state,
    });
  }

  steps.push({
    stepIndex: 2,
    nodeId: 'action',
    status: 'ok',
    phase: 'cycle-1',
    title: 'Action #1：lookup_node("workflow.checkpoint-durability")',
    detail: '向本地知识库发起精确检索',
    inputSnapshot: { tool: 'lookup_node', arg: 'workflow.checkpoint-durability' },
    outputSnapshot: { invoked: true },
    stateSnapshot: structuredClone({ ...state, trace: ['Thought #1', 'Action #1'] }),
    simulatedLatencyMs: 32,
    simulatedTokens: 40,
    simulated: true,
  });

  const polluted = fault === 'observation-pollution';
  state = {
    question,
    trace: ['Thought #1', 'Action #1', 'Observation #1'],
    grounded: !polluted,
  };
  steps.push({
    stepIndex: 3,
    nodeId: 'obs',
    status: polluted ? 'warning' : 'ok',
    phase: 'cycle-1',
    title: polluted ? 'Observation #1：观测中混入间接注入文本' : 'Observation #1：返回 Checkpoint 持久执行要点',
    detail: polluted
      ? '故障注入：外部文档包含干扰指令 "Ignore previous instructions"，上下文污染风险上升'
      : '观测到：Checkpoint 将每步状态快照持久化，支持故障中断后恢复而不重跑已幂等完成的步骤',
    inputSnapshot: { source: 'local-kb' },
    outputSnapshot: { polluted },
    stateSnapshot: structuredClone(state),
    simulatedLatencyMs: 28,
    simulatedTokens: 130,
    simulated: true,
  });

  steps.push({
    stepIndex: 4,
    nodeId: 'answer',
    status: polluted ? 'warning' : 'ok',
    phase: 'finalize',
    title: polluted ? '带污染观测生成结论（已标警告）' : 'Thought #2 → Final Answer：形成可追溯答案',
    detail: polluted ? '未过滤不可信观测，结论可靠性下降' : '基于检索证据完成结构化作答',
    inputSnapshot: { traceLen: 3 },
    outputSnapshot: { grounded: !polluted },
    stateSnapshot: structuredClone({ ...state, trace: [...(state.trace as string[]), 'Final Answer'] }),
    simulatedLatencyMs: seededInt(rng, 190, 290),
    simulatedTokens: 175,
    simulated: true,
  });

  return buildSimResult({
    labId: 'react',
    seed,
    params: { question },
    faultInjection: fault,
    status: 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState: state,
  });
}

export function runRagLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const query = String(input.params?.query ?? '为什么中文搜索不能只依赖 FTS5 trigram？');
  const chunkSize = Number(input.params?.chunkSize ?? 400);
  const strategy = String(input.params?.strategy ?? 'hybrid-rerank');
  const topK = Math.min(5, Math.max(1, Number(input.params?.topK ?? 3)));
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'chunk', label: `文档切分 (Chunk=${chunkSize})`, kind: 'start' as const },
    { id: 'retrieve', label: `检索召回 (${strategy})`, kind: 'tool' as const },
    { id: 'rerank', label: '重排与引用过滤', kind: 'decision' as const },
    { id: 'gen', label: '带引用生成回答', kind: 'llm' as const },
    { id: 'done', label: '输出带溯源结果', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'chunk', target: 'retrieve' },
    { id: 'e2', source: 'retrieve', target: 'rerank' },
    { id: 'e3', source: 'rerank', target: 'gen' },
    { id: 'e4', source: 'gen', target: 'done' },
  ];

  const corpusChunks = [
    { id: 'c1', doc: 'rag.fundamentals-chunking', scoreBm25: 0.78, scoreVec: 0.84, text: 'Chunk 过大稀释语义，过小切断上下文边界' },
    { id: 'c2', doc: 'rag.hybrid-rerank', scoreBm25: 0.91, scoreVec: 0.87, text: 'FTS5 trigram 要求至少 3 字符，两字中文词需要 2-gram 或混合检索' },
    { id: 'c3', doc: 'rag.agentic-rag', scoreBm25: 0.42, scoreVec: 0.79, text: 'Agentic RAG 允许根据召回充分性自动改写查询再检索' },
    { id: 'c4', doc: 'context.budget-compaction', scoreBm25: 0.35, scoreVec: 0.61, text: '控制注入上下文的 Top-K 数量以防预算溢出' },
  ];

  const initialState = { query, chunkSize, strategy, topK, candidates: [], selected: [], citations: [] };
  const steps: SimStepEvent[] = [];

  steps.push({
    stepIndex: 0,
    nodeId: 'chunk',
    status: 'ok',
    phase: 'index',
    title: `按 chunkSize=${chunkSize} 切分示例文档`,
    detail: `生成 ${chunkSize <= 200 ? 8 : chunkSize <= 400 ? 4 : 2} 个候选片段（演示语料，非全库实测）`,
    inputSnapshot: { chunkSize },
    outputSnapshot: { chunkCount: corpusChunks.length },
    stateSnapshot: structuredClone(initialState),
    simulatedLatencyMs: 22,
    simulatedTokens: 0,
    simulated: true,
  });

  const ranked =
    fault === 'retrieval-miss'
      ? [corpusChunks[3]]
      : [...corpusChunks].sort((a, b) => {
          const sa = strategy === 'bm25' ? a.scoreBm25 : strategy === 'vector' ? a.scoreVec : (a.scoreBm25 + a.scoreVec) / 2;
          const sb = strategy === 'bm25' ? b.scoreBm25 : strategy === 'vector' ? b.scoreVec : (b.scoreBm25 + b.scoreVec) / 2;
          return sb - sa;
        });

  const candidates = ranked.slice(0, topK);
  steps.push({
    stepIndex: 1,
    nodeId: 'retrieve',
    status: fault === 'retrieval-miss' ? 'warning' : 'ok',
    phase: 'retrieve',
    title: `策略 [${strategy}] 召回 Top-${topK} 候选`,
    detail: fault === 'retrieval-miss' ? '故障注入：未命中核心术语片段，仅返回边缘段落' : `命中 ${candidates.map((c) => c.id).join(', ')}`,
    inputSnapshot: { query, strategy, topK },
    outputSnapshot: { candidates },
    stateSnapshot: { ...initialState, candidates },
    simulatedLatencyMs: seededInt(rng, 30, 75),
    simulatedTokens: 0,
    simulated: true,
  });

  const selected = strategy === 'hybrid-rerank' && fault !== 'retrieval-miss' ? candidates.filter((c) => c.scoreBm25 > 0.5) : candidates;
  steps.push({
    stepIndex: 2,
    nodeId: 'rerank',
    status: fault === 'retrieval-miss' ? 'error' : 'ok',
    phase: 'rerank',
    title: strategy === 'hybrid-rerank' ? '交叉重排保留高置信片段' : '未启用 Rerank，直接透传召回结果',
    detail: fault === 'retrieval-miss' ? '相关度低于阈值，无法支撑准确引用' : `保留 ${selected.length} 条高相关片段进入 Prompt`,
    inputSnapshot: { candidatesCount: candidates.length },
    outputSnapshot: { selectedCount: selected.length },
    stateSnapshot: { ...initialState, candidates, selected },
    simulatedLatencyMs: strategy === 'hybrid-rerank' ? seededInt(rng, 60, 110) : 5,
    simulatedTokens: 0,
    simulated: true,
  });

  const citations = selected.map((s) => s.doc);
  const finalState = { query, chunkSize, strategy, topK, candidates, selected, citations };
  steps.push({
    stepIndex: 3,
    nodeId: 'gen',
    status: fault === 'retrieval-miss' ? 'warning' : 'ok',
    phase: 'generate',
    title: fault === 'retrieval-miss' ? '拒答或提示证据不足（防幻觉）' : '基于选中片段生成带引用回答',
    detail: fault === 'retrieval-miss' ? '因无可靠证据，触发“资料不足”降级响应' : `引用来源: ${citations.join(', ')}`,
    inputSnapshot: { contextDocs: citations },
    outputSnapshot: { citations, grounded: fault !== 'retrieval-miss' },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: seededInt(rng, 180, 320),
    simulatedTokens: 210,
    simulated: true,
  });

  steps.push({
    stepIndex: 4,
    nodeId: 'done',
    status: fault === 'retrieval-miss' ? 'warning' : 'ok',
    phase: 'done',
    title: 'RAG 流水线完成',
    detail: `引用 ${citations.length} 篇文档，策略=${strategy}`,
    inputSnapshot: { citations },
    outputSnapshot: { completed: true },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 10,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'rag',
    seed,
    params: { query, chunkSize, strategy, topK },
    faultInjection: fault,
    status: fault === 'retrieval-miss' ? 'failed' : 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState,
  });
}

export function runContextEngineeringLab(input: SimInput): SimRunResult {
  const seed = input.seed ?? 42;
  const rng = createSeededRng(seed);
  const budgetTokens = Math.max(1000, Number(input.params?.budgetTokens ?? 4000));
  const systemTokens = Number(input.params?.systemTokens ?? 650);
  const historyTokens = Number(input.params?.historyTokens ?? 1800);
  const toolOutputTokens = Number(input.params?.toolOutputTokens ?? 2200);
  const compressionMode = String(input.params?.compressionMode ?? 'compact');
  const fault = input.faultInjection ?? null;

  const graphNodes = [
    { id: 'assemble', label: '拼装上下文块', kind: 'start' as const },
    { id: 'budget', label: `预算校验 (${budgetTokens} tok)`, kind: 'decision' as const },
    { id: 'compact', label: `策略处理 (${compressionMode})`, kind: 'tool' as const },
    { id: 'infer', label: '模型推理', kind: 'llm' as const },
    { id: 'done', label: '输出与 KV 命中估算', kind: 'end' as const },
  ];
  const graphEdges = [
    { id: 'e1', source: 'assemble', target: 'budget' },
    { id: 'e2', source: 'budget', target: 'compact', label: 'overflow', conditional: true },
    { id: 'e3', source: 'budget', target: 'infer', label: 'within_budget', conditional: true },
    { id: 'e4', source: 'compact', target: 'infer' },
    { id: 'e5', source: 'infer', target: 'done' },
  ];

  const rawTool = fault === 'massive-tool-output' ? toolOutputTokens + 3200 : toolOutputTokens;
  const rawTotal = systemTokens + historyTokens + rawTool;
  const initialState = { budgetTokens, systemTokens, historyTokens, toolOutputTokens: rawTool, rawTotal, finalTotal: rawTotal, lostInstruction: false };
  const steps: SimStepEvent[] = [
    {
      stepIndex: 0,
      nodeId: 'assemble',
      status: 'ok',
      phase: 'assemble',
      title: '收集 System / History / Tool Output 三类上下文块',
      detail: `估算总计 ${rawTotal} tokens（采用字符/词元启发式估算，非特定模型精确 tokenizer）`,
      inputSnapshot: { systemTokens, historyTokens, toolOutputTokens: rawTool },
      outputSnapshot: { rawTotal },
      stateSnapshot: structuredClone(initialState),
      simulatedLatencyMs: 14,
      simulatedTokens: 0,
      simulated: true,
    },
  ];

  const overflow = rawTotal > budgetTokens;
  steps.push({
    stepIndex: 1,
    nodeId: 'budget',
    status: overflow ? 'warning' : 'ok',
    phase: 'check',
    title: overflow ? `超出上下文预算 (${rawTotal} > ${budgetTokens})` : '处于预算范围内',
    detail: overflow ? '必须执行上下文裁剪、过滤或压缩' : '无需压缩，直接进入推理',
    inputSnapshot: { rawTotal, budgetTokens },
    outputSnapshot: { overflow },
    stateSnapshot: structuredClone(initialState),
    simulatedLatencyMs: 8,
    simulatedTokens: 0,
    simulated: true,
  });

  let finalTotal = rawTotal;
  let lostInstruction = false;
  if (overflow) {
    if (compressionMode === 'truncate-head') {
      lostInstruction = true;
      finalTotal = budgetTokens;
    } else if (compressionMode === 'filter-tool') {
      finalTotal = Math.min(budgetTokens, systemTokens + historyTokens + Math.round(rawTool * 0.25));
    } else {
      finalTotal = Math.min(budgetTokens, systemTokens + Math.round(historyTokens * 0.4) + Math.round(rawTool * 0.35));
    }
    steps.push({
      stepIndex: 2,
      nodeId: 'compact',
      status: lostInstruction ? 'error' : 'ok',
      phase: 'compress',
      title: lostInstruction ? '直接头部截断导致系统指令丢失' : `执行 [${compressionMode}] 压降至 ${finalTotal} tokens`,
      detail: lostInstruction
        ? '反模式警告：无差别头部截断丢弃了 System Prompt 中的安全约束'
        : '保留 System 指令不变，对长工具输出做结构化摘要与只读字段裁剪',
      inputSnapshot: { compressionMode, rawTotal },
      outputSnapshot: { finalTotal, lostInstruction },
      stateSnapshot: { ...initialState, finalTotal, lostInstruction },
      simulatedLatencyMs: seededInt(rng, 45, 110),
      simulatedTokens: compressionMode === 'compact' ? 140 : 0,
      simulated: true,
    });
  }

  const finalState = { ...initialState, finalTotal, lostInstruction };
  steps.push({
    stepIndex: steps.length,
    nodeId: 'infer',
    status: lostInstruction ? 'warning' : 'ok',
    phase: 'infer',
    title: '执行模型前向推理',
    detail: `实际注入 ${finalTotal} tokens`,
    inputSnapshot: { finalTotal },
    outputSnapshot: { ok: !lostInstruction },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: seededInt(rng, 210, 380),
    simulatedTokens: finalTotal,
    simulated: true,
  });

  steps.push({
    stepIndex: steps.length,
    nodeId: 'done',
    status: lostInstruction ? 'warning' : 'ok',
    phase: 'finalize',
    title: '完成上下文预算周期',
    detail: `压缩率 ${Math.round((1 - finalTotal / Math.max(1, rawTotal)) * 100)}%`,
    inputSnapshot: { finalTotal },
    outputSnapshot: { lostInstruction },
    stateSnapshot: structuredClone(finalState),
    simulatedLatencyMs: 10,
    simulatedTokens: 0,
    simulated: true,
  });

  return buildSimResult({
    labId: 'context-engineering',
    seed,
    params: { budgetTokens, systemTokens, historyTokens, toolOutputTokens, compressionMode },
    faultInjection: fault,
    status: lostInstruction ? 'failed' : 'completed',
    graphNodes,
    graphEdges,
    steps,
    initialState,
    finalState,
  });
}
