---
id: case.multi-model-collaboration
title: 多模型协作开发工作流：规划模型与执行模型分工
enTitle: Multi-Model Collaboration Case Study
domain: casebook
difficulty: advanced
patternSummary: 高推理模型负责架构规划与评审，高性价比模型执行明确子任务
recommendedArchitecture: "Planner（强推理模型产出结构化计划与验收标准）→ Executor（快速低成本模型按计划实施）→ 确定性测试门禁 + 失败回退 Planner。"
rejectedAlternatives:
  - option: 全程所有简单文件修改与批量检索都使用最高单价推理模型
    reason: 延迟高且成本成倍增加，80% 的确定性实现步骤并不需要深推理预算。
  - option: 全程只用最弱小模型自由架构设计
    reason: 复杂跨模块依赖容易在规划期引入隐蔽缺陷，导致后续反复返工。
relatedNodeIds:
  - llm.reasoning-cost
  - patterns.evaluator-optimizer
  - multi-agent.cost-boundaries
relatedLabIds: [multi-agent, agent-loop]
sourceIds: [anthropic.effective-agents, openai.agents-sdk]
verifiedAt: "2026-11-26"
---
## 1. 核心权衡

工程实践中“模型分级路由（Model Tiering）”往往比“多角色闲聊式多 Agent”更直接有效：把强推理能力集中用于**接口设计、风险识别、失败重规划**，把常规代码编写与测试运行交给高吞吐执行模型，并设置“同一验证失败两次即自动回退规划层”的硬规则。

## 2. 失败模式

- **规划脱节**：执行中发现计划前提不成立却强行凑合（Improvising past the plan）。**解法**：设定明确 `Re-plan triggers`，触发即交还规划模型重审。
