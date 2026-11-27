# AgentAtlas Content Guide & Provenance Policy

## 1. Knowledge Node Structure

Every `.md` file under `content/knowledge/` must include YAML frontmatter validated by `@agent-atlas/content`:

```yaml
id: agent.loop
slug: agent-loop
title: Agent 执行循环
enTitle: Agent Loop
aliases: [Agent Loop, 智能体循环, Think-Act-Observe]
type: concept # concept | protocol | pattern | framework | tool | paper | case | lab | term | resource
domain: agent-core
level: beginner # beginner | intermediate | advanced
revision: 1
majorUpdate: false
estimatedMinutes: 15
summary: 一句话技术摘要
objectives:
  - 理解能力目标 1
requires: [llm.structured-output]
related: [agent.stop-conditions, tools.function-calling]
contrasts: [agent.taxonomy]
implements: []
exampleOf: []
supersedes: []
tags: [agent-core, loop]
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
```

## 2. Required Body Sections

1. 一句话定义（Core Definition）
2. 产生背景与要解决的问题（Why It Exists）
3. 第一性原理（First Principles）
4. 核心运行机制（Mechanism）
5. 可视化图解（Mermaid Flowchart / Sequence）
6. 最小可行实现（Minimal Example，标注版本、前提与是否为教学示例）
7. 实际应用场景（When to Use）
8. 反例与常见误区（Anti-Patterns & Misconceptions）
9. 技术边界与局限（Boundaries & Limits）
10. 工程权衡（Engineering Trade-offs）
11. 关联知识（使用 `[[nodeId]]` 双向链接）
12. 事实分级与参考来源（区分「已验证事实」「工程经验」「争议观点」）

## 3. Security & Provenance Rules

- No `<script>`, `<iframe>`, inline event handlers (`on*=`), `javascript:` URIs, or executable MDX imports/exports.
- Every `sourceIds` entry must exist in `content/sources/sources.yaml` with a real URL, license status, and verification date.
- AI Tutor outputs can only be saved to `content_drafts` with `verified: false` and cannot directly overwrite `content/knowledge/`.
