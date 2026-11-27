---
id: coding.repo-context-agents-md
slug: coding-repo-context-agents-md
title: 代码仓上下文构建与 AGENTS.md 规范
enTitle: Repository Context & AGENTS.md Conventions
aliases: [AGENTS.md, Repo Context, 代码库上下文]
type: concept
domain: coding-agents
level: intermediate
revision: 1
majorUpdate: false
estimatedMinutes: 14
summary: 如何通过精炼的 AGENTS.md 与结构化代码检索（Outline/Ripgrep/AST），让 Coding Agent 快速对齐项目约定而不陷入噪声。
objectives:
  - 编写高信噪比的项目级 AGENTS.md 指令文件
  - 掌握“先定位检索与大纲，再局部切片读取”的仓库探索原则
requires: [context.engineering-principles]
related: [coding.agent-skills, coding.patch-test-review]
contrasts: []
implements: []
exampleOf: []
supersedes: []
tags: [coding-agent, agents-md, repository-context]
sourceIds: [agentskills.spec, anthropic.context-engineering]
labIds: [harness-engineering]
verifiedAt: "2026-11-26"
---
## 一句话定义

**AGENTS.md** 是放置在代码仓库根目录或子目录中的标准化工程说明文件，用极简篇幅向 Coding Agent 声明技术栈、目录边界、构建/测试命令及关键禁忌，作为进入陌生代码库的第一上下文锚点。

## 产生背景与需要解决的问题

Coding Agent 每次打开仓库都要面临数千个文件：如果盲目 `cat` 整文件或递归遍历全部目录，会迅速消耗上下文预算；如果缺少构建与测试规范，模型往往自己猜错命令或违背项目既有风格。

## 第一性原理

1. **高信噪比全局地图**：`AGENTS.md` 应只放“代码里不能直接看出来或跨文件全局成立的约定”（如包管理器、测试命令、严禁触碰目录），绝不把源码抄进文档。
2. **定位 → 大纲 → 局部切片**：先用 `rg` / 符号索引定位行号，再用带 `startLine/endLine` 的切片读取所需函数，拒绝盲目全文件读取。

## 核心运行机制

```mermaid
flowchart LR
  Read["1. 读取 AGENTS.md + 目录快照"] --> Search["2. rg / 符号定位目标文件与行号"]
  Search --> Slice["3. 局部行区间读取 (<=150 行)"]
  Slice --> Edit["4. 精准修改并运行 AGENTS.md 指定验证命令"]
```

## 最小可行实现

```markdown
# AGENTS.md 示例结构
- Package manager: pnpm 12 (`pnpm build`, `pnpm test`)
- Architecture: `packages/content` compiles Markdown; `apps/server` exposes Fastify + SQLite FTS5.
- Constraints: Server binds strictly to 127.0.0.1; never commit `data/`.
```

## 实际应用场景

- 多人协作工程仓库、Monorepo 多语言项目标准化接入各类 Coding Agent。

## 反例与常见误区

- **反例**：把几千行的产品需求全文或冗长鸡汤规范全写进 `AGENTS.md`，导致每次会话起步就占用大量无关注意力。

## 工程权衡

- **常驻全局规则 vs 子目录作用域规则**：通用命令放根目录 `AGENTS.md`，特定子模块（如前端 UI 或数据库迁移）规则下沉到对应目录或按需 Skill。

## 关联知识

- 前置：[[context.engineering-principles]] · 延伸：[[coding.agent-skills]]、[[coding.patch-test-review]]

## 事实分级与参考来源

- **已验证事实**：`agents.md` 开放规范与主流 Coding Agent 实践均推荐将项目构建/测试命令及特殊约束集中置于短小精悍的 `AGENTS.md` 中。
