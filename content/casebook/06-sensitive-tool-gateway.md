---
id: case.sensitive-tool-gateway
title: 权限敏感型工具调用审批网关：最小权限与 HITL
enTitle: Sensitive Tool Approval Gateway Case Study
domain: casebook
difficulty: advanced
patternSummary: 工具分级权限 + 参数预览 + 人类确认中断 + 不可篡改审计日志
recommendedArchitecture: "将工具划分为 ReadOnly / WorkspaceWrite / DestructiveExternal 三级，高危调用强制触发 HITL 审批暂停与参数差异预览。"
rejectedAlternatives:
  - option: 在 Prompt 中叮嘱模型“执行删除前礼貌问一句”而不做运行时拦截
    reason: Prompt 约束可被间接注入或模型遗忘绕过，必须由代码层强制中断执行。
relatedNodeIds:
  - security.least-privilege-approval
  - workflow.hitl-idempotency
  - tools.mcp-architecture
relatedLabIds: [workflow, harness-engineering]
sourceIds: [owasp.llm-top10, mcp.spec, langchain.langgraph]
verifiedAt: "2026-11-26"
---
## 1. 核心设计原则

安全控制绝对不能外包给 LLM 的自觉性。对于修改系统配置、外发网络请求、批量覆盖或恢复备份等操作，宿主网关必须在工具执行器层面拦截，向用户展示**具体目标路径、影响行数与变更摘要**，获得确认令牌后才放行。

## 2. 审批状态流

```mermaid
flowchart LR
  LLM["模型请求 tool_call"] --> Policy{"权限分级检查"}
  Policy -- ReadOnly --> Exec["直接执行并审计"]
  Policy -- Destructive --> Pause["中断状态机并展示参数预览"]
  Pause -- 用户批准 --> Exec
  Pause -- 用户拒绝 --> Abort["返回安全取消状态"]
```
