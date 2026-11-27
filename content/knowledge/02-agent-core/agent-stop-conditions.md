---
id: agent.stop-conditions
slug: agent-stop-conditions
title: 停止条件与预算熔断机制
enTitle: Stop Conditions & Budget Circuit Breakers
aliases: [Stop Conditions, 停止条件, Circuit Breaker]
type: concept
domain: agent-core
level: beginner
revision: 1
majorUpdate: false
estimatedMinutes: 12
summary: 设计多维度硬性停止条件（完成信号、步数、Token/时间预算、连续重复错误检测），防止自治循环失控。
objectives:
  - 列出生产级 Agent Loop 必备的五类停止条件
  - 区分正常收敛停止与异常熔断停止（stop_reason）
requires: [agent.loop]
related: [harness.budget-recovery, llm.reasoning-cost]
contrasts: []
implements: []
exampleOf: []
supersedes: []
tags: [agent-core, safety, budget, stop-condition]
sourceIds: [anthropic.effective-agents, anthropic.effective-harnesses]
labIds: [agent-loop]
verifiedAt: "2026-11-26"
---
## 一句话定义

**停止条件（Stop Conditions）** 是宿主运行时强制终止 Agent Loop 的显式规则集合，确保系统在任务完成、预算耗尽、出现死循环或用户取消时可靠退出。

## 产生背景与需要解决的问题

概率模型在工具连续失败或遇到矛盾条件时，往往倾向于“再试一次”，如果没有确定性的外部停止器，Agent 会在几分钟内消耗巨额费用或锁死工作线程。

## 第一性原理

停止判断必须由**宿主确定性逻辑**与**模型语义信号**共同组成：模型有权表达“我认为任务结束了（`end_turn`）”，但只有宿主有权强制执行“步数/预算/错误次数已超限”。

## 核心运行机制

```mermaid
flowchart TD
  Check{"检查停止条件"} --> Done["1. 模型输出最终答复 (end_turn)"]
  Check --> MaxStep["2. step >= maxSteps"]
  Check --> Budget["3. tokens / latency 超出预算"]
  Check --> LoopDet["4. 连续 N 次相同工具+参数失败"]
  Check --> Cancel["5. 用户 AbortSignal / HITL 拒绝"]
```

## 最小可行实现

```ts
export type StopReason =
  | 'completed'
  | 'max_steps'
  | 'token_budget_exceeded'
  | 'repeated_tool_failure'
  | 'user_cancelled';

export function checkStopCondition(ctx: {
  step: number;
  maxSteps: number;
  tokensUsed: number;
  tokenBudget: number;
  consecutiveSameFailures: number;
  aborted: boolean;
}): StopReason | null {
  if (ctx.aborted) return 'user_cancelled';
  if (ctx.step >= ctx.maxSteps) return 'max_steps';
  if (ctx.tokensUsed >= ctx.tokenBudget) return 'token_budget_exceeded';
  if (ctx.consecutiveSameFailures >= 3) return 'repeated_tool_failure';
  return null;
}
```

## 实际应用场景

- 为每类 Agent 区分可观测的 `stop_reason`，在评估和告警中统计“因预算截断”的比例。

## 反例与常见误区

- **反例**：仅依赖系统提示词里写“最多调用 5 次工具”，而不写程序计数器。模型经常记错自己调了几次。

## 工程权衡

- **提前熔断 vs 允许恢复**：命中 `max_steps` 时不要直接丢弃已收集证据，应汇总当前已知状态与未决阻塞交还人类或规划层。

## 关联知识

- 前置：[[agent.loop]] · 延伸：[[harness.budget-recovery]]、[[llm.reasoning-cost]]

## 事实分级与参考来源

- **已验证事实**：设置最大迭代次数与明确停止条件是构建可控 Agent 的基本原则（Anthropic Effective Agents）。
