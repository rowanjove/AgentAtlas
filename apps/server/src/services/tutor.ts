import { ContentBundle, TutorConfig } from '@agent-atlas/shared';
import { AtlasDatabase } from '../db/database.js';

export type TutorMode =
  | 'concept-explain'
  | 'deep-research'
  | 'socratic'
  | 'architecture-deduction'
  | 'design-review'
  | 'quiz-draft';

export type LearningDepth = 'concept' | 'mechanism' | 'architecture' | 'practice';

export interface TutorChatRequest {
  question: string;
  mode: TutorMode;
  depth: LearningDepth;
  currentNodeId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface TutorCitation {
  nodeId: string;
  title: string;
  revision: number;
  verified: boolean;
}

export interface TutorChatResponse {
  mode: 'live-model' | 'offline-retrieval';
  answer: string;
  citations: TutorCitation[];
  disclosedContextNodeIds: string[];
  modelUsed: string | null;
  warning?: string;
}

export function validateCitations(text: string, bundle: ContentBundle): TutorCitation[] {
  const nodeMap = new Map(bundle.nodes.map((n) => [n.id, n]));
  const found = new Map<string, TutorCitation>();
  const matches = text.matchAll(/\[([a-z0-9-]+\.[a-z0-9-]+)\]/gi);
  for (const m of matches) {
    const id = m[1];
    const node = nodeMap.get(id);
    if (node) {
      found.set(id, { nodeId: node.id, title: node.title, revision: node.revision, verified: true });
    }
  }
  return [...found.values()];
}

export function redactSecrets(text: string, apiKey: string | null = null): string {
  let masked = text;
  if (apiKey && apiKey.length >= 4) {
    masked = masked.split(apiKey).join('[REDACTED]');
  }
  return masked
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]');
}

export function assertSafeProviderUrl(baseUrl: string): void {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported provider protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host === '[fd00:ec2::254]' ||
    host === 'fd00:ec2::254'
  ) {
    throw new Error('Blocked cloud metadata host for model provider');
  }
}

export class OpenAICompatibleAdapter {
  async complete(params: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<string> {
    assertSafeProviderUrl(params.baseUrl);
    const url = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          max_tokens: params.maxTokens,
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Provider HTTP ${res.status}: ${redactSecrets(txt.slice(0, 240), params.apiKey)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() || '模型返回空内容。';
    } catch (err) {
      throw new Error(redactSecrets(err instanceof Error ? err.message : 'Provider request failed', params.apiKey));
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(baseUrl: string, apiKey: string | null): Promise<{ ok: boolean; detail: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      assertSafeProviderUrl(baseUrl);
      const url = `${baseUrl.replace(/\/+$/, '')}/models`;
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(url, { headers, redirect: 'error', signal: controller.signal });
      return { ok: res.ok, detail: res.ok ? '连接成功 (/models 响应正常)' : `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        detail: redactSecrets(err instanceof Error ? err.message : '连接失败', apiKey),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class TutorService {
  private readonly adapter = new OpenAICompatibleAdapter();

  async chat(
    req: TutorChatRequest,
    config: TutorConfig,
    apiKey: string | null,
    db: AtlasDatabase,
    bundle: ContentBundle,
  ): Promise<TutorChatResponse> {
    // 1. Always retrieve relevant local knowledge nodes first
    const hits = db.searchNodes({ q: req.question, limit: 4 });
    const nodeMap = new Map(bundle.nodes.map((n) => [n.id, n]));
    const selectedIds = new Set<string>();
    if (req.currentNodeId && nodeMap.has(req.currentNodeId)) {
      selectedIds.add(req.currentNodeId);
    }
    for (const h of hits) selectedIds.add(h.id);

    const contextNodes = [...selectedIds]
      .map((id) => nodeMap.get(id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, 4);

    const contextSummary = contextNodes
      .map(
        (n) =>
          `[${n.id}] ${n.title} (${n.enTitle}, rev ${n.revision}):\n摘要: ${n.summary}\n要点:\n${n.body.slice(0, 900)}`,
      )
      .join('\n\n---\n\n');

    const localCitations: TutorCitation[] = contextNodes.map((n) => ({
      nodeId: n.id,
      title: n.title,
      revision: n.revision,
      verified: true,
    }));

    // 2. If Tutor API is disabled or not configured, return rich offline retrieval guidance
    const isLocalhostModel = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(config.baseUrl);
    if (!config.enabled || !config.baseUrl || (!apiKey && !isLocalhostModel)) {
      return {
        mode: 'offline-retrieval',
        answer: this.buildOfflineResponse(req, contextNodes),
        citations: localCitations,
        disclosedContextNodeIds: contextNodes.map((n) => n.id),
        modelUsed: null,
        warning: config.enabled
          ? '当前未检测到可用模型配置或密钥，已自动切换为离线本地知识检索引导模式。'
          : 'AI 导师当前处于关闭/离线模式，以下结果完全由本地 SQLite FTS5 知识库生成。',
      };
    }

    // 3. Call OpenAI-compatible provider with strict citation instructions
    const systemPrompt = [
      '你是 AgentAtlas 的 AI Agent 工程认知导师。',
      `当前辅导模式：${req.mode}；目标学习深度：${req.depth}。`,
      '硬性规则：',
      '1. 优先依据下面提供的本地知识库原文回答，并用 [node.id] 格式引用真实节点 ID。',
      '2. 明确区分【已验证本地库事实】【工程经验】与【外部推测/未知】，绝不编造不存在的论文、版本或节点 ID。',
      '3. 若是苏格拉底式提问模式，先给出关键判断维度，再向学习者提出 2 个针对性工程反问。',
      '',
      '=== 本次检索的本地知识片段 ===',
      contextSummary || '(未检索到直接匹配节点)',
    ].join('\n');

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...(req.history ?? []).slice(-6),
      { role: 'user', content: req.question },
    ];

    try {
      const answer = await this.adapter.complete({
        baseUrl: config.baseUrl,
        apiKey,
        model: config.model,
        messages,
        maxTokens: config.maxTokens,
        timeoutMs: config.timeoutMs,
      });
      const verifiedCitations = validateCitations(answer, bundle);
      return {
        mode: 'live-model',
        answer,
        citations: verifiedCitations.length > 0 ? verifiedCitations : localCitations,
        disclosedContextNodeIds: contextNodes.map((n) => n.id),
        modelUsed: config.model,
      };
    } catch (err) {
      const safeErr = redactSecrets(err instanceof Error ? err.message : '未知错误', apiKey);
      return {
        mode: 'offline-retrieval',
        answer: this.buildOfflineResponse(req, contextNodes),
        citations: localCitations,
        disclosedContextNodeIds: contextNodes.map((n) => n.id),
        modelUsed: null,
        warning: `模型请求失败（${safeErr}），已安全降级为本地知识检索结果。`,
      };
    }
  }

  async testConnection(config: TutorConfig, apiKey: string | null) {
    if (!config.baseUrl) return { ok: false, detail: '请先填写 Base URL（例如 http://127.0.0.1:1234/v1）' };
    return this.adapter.testConnection(config.baseUrl, apiKey);
  }

  private buildOfflineResponse(
    req: TutorChatRequest,
    nodes: ContentBundle['nodes'],
  ): string {
    if (nodes.length === 0) {
      return [
        `### 离线检索引导（模式：${req.mode} / 深度：${req.depth}）`,
        '',
        `本地知识库未直接检索到与「${req.question}」高度匹配的条目。`,
        '',
        '建议动作：',
        '- 尝试使用核心英文术语或两字中文词（如 `Agent Loop`、`MCP`、`上下文`、`检查点`）重新查询。',
        '- 若需开启外部模型或本地 LM Studio 深度推演，可在 **Settings** 页面配置 OpenAI-compatible 端点。',
      ].join('\n');
    }

    const refs = nodes
      .map(
        (n) =>
          `- **[${n.id}] ${n.title} (${n.enTitle})** · ${n.level}\n  ${n.summary}\n  核心学习目标：${n.objectives.slice(0, 2).join('；')}`,
      )
      .join('\n');

    const promptQuestions =
      req.mode === 'socratic'
        ? [
            '### 苏格拉底工程反问',
            '1. 在你当前的任务里，控制流是否可以由确定性代码预先决定？如果可以，引入自治循环带来了什么额外成本与失败面？',
            '2. 如果其中一步工具调用失败或返回脏数据，系统如何通过最小权限与检查点避免不可逆副作用？',
          ]
        : [
            '### 建议下一步验证',
            `1. 深入阅读 [${nodes[0].id}] 正文中的「工程权衡」与「常见误区」章节。`,
            nodes[0].labIds.length > 0
              ? `2. 前往 Playground 运行 \`${nodes[0].labIds[0]}\` 实验并注入故障观察状态迁移。`
              : '2. 完成该节点关联的认知测试题，检验架构判断力而非仅记住概念定义。',
          ];

    return [
      `### 本地知识库检索综述（模式：${req.mode} / 深度：${req.depth}）`,
      '',
      '以下结论完全基于本地已核查知识节点（未向任何外部模型发送数据）：',
      '',
      refs,
      '',
      ...promptQuestions,
    ].join('\n');
  }
}
