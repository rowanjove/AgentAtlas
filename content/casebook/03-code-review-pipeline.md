---
id: case.code-review-pipeline
title: 自动化代码审查与补丁流水线：静态检查优先 + Coding Harness
enTitle: Code Review & Patch Pipeline Case Study
domain: casebook
difficulty: intermediate
patternSummary: 确定性 Lint/Typecheck/Test 前置 + 受限沙箱 Coding Agent
recommendedArchitecture: "确定性门禁（TSC/Lint/Unit Test）先行过滤机械问题，Coding Agent 聚焦逻辑缺陷并受沙箱与 diff 验证约束。"
rejectedAlternatives:
  - option: 直接让 LLM 肉眼检查代码格式与类型错误
    reason: 既昂贵又容易漏报，编译器和 Linter 在几百毫秒内即可 100% 确定性发现问题。
  - option: 不跑测试仅凭模型自信输出“已修复”
    reason: 缺乏真实反馈闭环会导致大量看似合理实则编译失败的补丁。
relatedNodeIds:
  - coding.repo-context-agents-md
  - coding.patch-test-review
  - harness.runtime-sandbox
relatedLabIds: [harness-engineering, evals]
sourceIds: [anthropic.effective-harnesses, paper.swe-bench, agentskills.spec]
verifiedAt: "2026-11-26"
---
## 1. 业务目标与约束

在 Pull Request 或本地重构阶段自动定位缺陷、生成最小补丁并通过回归测试，同时严禁修改无关文件或越权访问敏感配置。

## 2. 架构决策

1. **先确定性工具，后模型推理**：由 Harness 先运行 `tsc --noEmit`、`eslint` 与现有单测，把精准报错行号喂给模型。
2. **AGENTS.md + 渐进式上下文**：只暴露目录树与相关文件片段，不把整个 `node_modules` 或无关历史塞入上下文。
3. **验证闭环**：补丁写入后必须重跑受影响测试集才允许进入最终审查结论。

## 3. 流程概览

```mermaid
flowchart LR
  Diff["读取 Git Diff"] --> Static["运行 Typecheck / Lint / Test"]
  Static --> Cond{"存在确定性报错?"}
  Cond -- 是 --> Fix["Coding Agent 生成最小补丁"]
  Fix --> Static
  Cond -- 否 --> Semantic["LLM 审查架构与边界条件"]
```
