---
id: case.web-research-workflow
title: 网页信息深度研究工作流：Orchestrator-Workers 与信源核验
enTitle: Web Research Workflow Case Study
domain: casebook
difficulty: intermediate
patternSummary: Orchestrator-Workers 动态拆分子主题 + 只读证据汇总 + 信源隔离
recommendedArchitecture: "单 Planner 拆分子问题 + 并行只读抓取 Worker（独立上下文窗）+ 中心引用核查器。"
rejectedAlternatives:
  - option: 单一长对话窗口顺序抓取 20 个网页
    reason: 原始 HTML/正文迅速塞满窗口导致 Context Rot，早期研究目标被遗忘。
  - option: 让抓取 Worker 直接修改本地正式知识库
    reason: 外部网页存在过时信息与间接提示注入风险，必须落入待审核草稿箱。
relatedNodeIds:
  - patterns.orchestrator-workers
  - context.budget-compaction
  - security.prompt-injection
relatedLabIds: [multi-agent, context-engineering]
sourceIds: [anthropic.effective-agents, anthropic.context-engineering, owasp.llm-top10]
verifiedAt: "2026-11-26"
---
## 1. 业务目标与约束

针对一个开放研究主题，自动检索多篇官方文档与论文，对比技术差异并生成带真实 URL 与核实日期的研究简报；单次任务需控制总预算且防止恶意网页劫持 Agent。

## 2. 为什么选择 Orchestrator-Workers

网页研究面临**事先不知道要查几层链接、每个页面正文都很长**的双重特点。每个 Worker 拥有独立干净的上下文窗口：只负责抓一个主题、提取带有原始 URL 锚点的结构化要点并丢弃原始页面噪声，从而保护主 Orchestrator 的推理注意力。

## 3. 数据流与失败模式

```mermaid
flowchart TD
  Orch["Orchestrator 拆解 3 个子问题"] --> W1["Worker 1 (独立上下文)"]
  Orch --> W2["Worker 2 (独立上下文)"]
  W1 --> San["剥离脚本/不可信指令，提取事实+URL"]
  W2 --> San
  San --> Draft["写入待审核草稿 (verified: false)"]
```

- **失败模式**：Worker 总结时丢失版本前提（如把某 beta API 当成稳定特性）。**缓解**：提取 Schema 强制包含 `upstreamVersion` 与 `verifiedAt` 字段。
