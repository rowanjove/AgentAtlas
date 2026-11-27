---
id: case.long-running-recovery
title: 长程任务检查点与崩溃恢复：Durable Workflow 实践
enTitle: Long-Running Task Recovery Case Study
domain: casebook
difficulty: advanced
patternSummary: 显式状态机 + 每阶段 Checkpoint + 幂等键 + 进度工件交接
recommendedArchitecture: "将长任务拆解为可序列化 StateGraph 阶段，每步落盘 SQLite Checkpoint，副作用操作绑定 Idempotency Key。"
rejectedAlternatives:
  - option: 把 2 小时任务的全部中间状态仅存放在单次对话内存数组中
    reason: 进程崩溃、上下文窗口溢出或网络超时都会导致全部进度清零。
relatedNodeIds:
  - workflow.dag-state-machine
  - workflow.checkpoint-durability
  - harness.budget-recovery
relatedLabIds: [workflow, harness-engineering]
sourceIds: [langchain.langgraph, anthropic.effective-harnesses]
verifiedAt: "2026-11-26"
---
## 1. 工程背景

批量迁移几十个模块或执行多阶段数据清洗时，单次任务可能跨越多个上下文生命周期与多次进程重启。

## 2. 关键机制

- **状态外部化**：当前阶段、已完成 ID 列表、重试计数全部持久化到 SQLite，重启时直接从最后成功 Checkpoint 续跑。
- **幂等写入**：对外写接口携带 `taskId + stageId` 幂等键，防止崩溃恢复重放时重复写入。

```mermaid
stateDiagram-v2
  [*] --> Stage1
  Stage1 --> Checkpoint1: 持久化 State
  Checkpoint1 --> Stage2
  Stage2 --> Crashed: 进程中断
  Crashed --> Checkpoint1: 重启加载快照
  Checkpoint1 --> Stage2: 跳过 Stage1 继续
  Stage2 --> [*]
```
