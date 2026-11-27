export const DOMAIN_IDS = [
  'llm',
  'agent-core',
  'tools-protocols',
  'patterns',
  'context',
  'rag-memory',
  'workflow',
  'multi-agent',
  'harness',
  'coding-agents',
  'evals',
  'security',
  'frameworks',
  'deployment',
  'casebook',
] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];

export interface DomainMeta {
  id: DomainId;
  order: number;
  folderName: string;
  title: string;
  enTitle: string;
  description: string;
}

export const DOMAINS: DomainMeta[] = [
  { id: 'llm', order: 1, folderName: '01-llm', title: '01 LLM 基础', enTitle: 'LLM Foundations', description: 'Token、上下文窗口、采样解码、结构化输出与推理成本' },
  { id: 'agent-core', order: 2, folderName: '02-agent-core', title: '02 Agent 核心', enTitle: 'Agent Core', description: 'Chatbot/Workflow/Agent 分类、执行循环、状态与停止条件' },
  { id: 'tools-protocols', order: 3, folderName: '03-tools-protocols', title: '03 工具与协议', enTitle: 'Tools & Protocols', description: 'Function Calling、Schema 校验、MCP 架构与原语' },
  { id: 'patterns', order: 4, folderName: '04-patterns', title: '04 设计模式', enTitle: 'Agent Design Patterns', description: '路由、提示链、Orchestrator-Workers、Evaluator-Optimizer、ReAct、Plan-and-Execute' },
  { id: 'context', order: 5, folderName: '05-context', title: '05 上下文工程', enTitle: 'Context Engineering', description: '指令分层、上下文预算、摘要压缩与 State/Context 边界' },
  { id: 'rag-memory', order: 6, folderName: '06-rag-memory', title: '06 RAG 与记忆', enTitle: 'RAG & Memory', description: 'Chunking、混合检索、Rerank、Agentic RAG 与长短期记忆' },
  { id: 'workflow', order: 7, folderName: '07-workflow', title: '07 工作流与编排', enTitle: 'Workflow & Orchestration', description: 'DAG、状态机、检查点持久化、幂等重试与人工审批' },
  { id: 'multi-agent', order: 8, folderName: '08-multi-agent', title: '08 多智能体', enTitle: 'Multi-Agent Systems', description: '角色分工、Handoff、A2A 协议与多 Agent 成本边界' },
  { id: 'harness', order: 9, folderName: '09-harness', title: '09 Harness 工程', enTitle: 'Harness Engineering', description: '运行时沙箱、权限审批、预算控制、会话恢复与测试闭环' },
  { id: 'coding-agents', order: 10, folderName: '10-coding-agents', title: '10 Coding Agents', enTitle: 'Coding Agents', description: '代码仓上下文、AGENTS.md、Agent Skills 与补丁测试审查' },
  { id: 'evals', order: 11, folderName: '11-evals', title: '11 评估与可观测性', enTitle: 'Evals & Observability', description: '评估数据集、Trace 追踪、Pass@k 与 LLM-as-Judge 局限' },
  { id: 'security', order: 12, folderName: '12-security', title: '12 安全与可靠性', enTitle: 'Security & Reliability', description: '提示注入防御、最小权限原则与人工审批网关' },
  { id: 'frameworks', order: 13, folderName: '13-frameworks', title: '13 框架与生态', enTitle: 'Frameworks & Ecosystem', description: '主流框架架构选型对比与协议生态' },
  { id: 'deployment', order: 14, folderName: '14-deployment', title: '14 部署与工程化', enTitle: 'Deployment & Ops', description: '本地离线模型、服务化、缓存与持久化运维' },
  { id: 'casebook', order: 15, folderName: '15-casebook', title: '15 工程案例设计', enTitle: 'Engineering Casebooks', description: '端到端真实场景需求分解、架构权衡与失败复盘' },
];

export const DOMAIN_MAP = new Map<string, DomainMeta>(DOMAINS.map((d) => [d.id, d]));

export function getKnowledgeFolderForDomain(domain: string): string {
  return DOMAIN_MAP.get(domain)?.folderName ?? domain;
}

const NODE_PREFIX_TO_DOMAIN: Record<string, DomainId> = {
  agent: 'agent-core',
  tools: 'tools-protocols',
  rag: 'rag-memory',
  memory: 'rag-memory',
  coding: 'coding-agents',
};

export function resolveDomainFromNodeId(nodeId: string): DomainId {
  const prefix = nodeId.split('.')[0]?.toLowerCase() ?? '';
  if (prefix in NODE_PREFIX_TO_DOMAIN) {
    return NODE_PREFIX_TO_DOMAIN[prefix];
  }
  if (DOMAIN_MAP.has(prefix)) {
    return prefix as DomainId;
  }
  return 'agent-core';
}
