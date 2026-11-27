---
id: tools.function-calling
slug: tools-function-calling
title: Function Calling 机制与工具接口设计
enTitle: Function Calling & Agent-Computer Interface
aliases: [Function Calling, Tool Calling, 工具调用]
type: concept
domain: tools-protocols
level: beginner
revision: 1
majorUpdate: false
estimatedMinutes: 16
summary: 理解 Function Calling 的声明—推理—执行—回填四步协议，以及面向模型优化的工具接口（ACI）设计原则。
objectives:
  - 掌握 Function Calling 完整消息流转协议
  - 学会编写清晰、防呆、低歧义的工具描述与参数 Schema
requires: [llm.structured-output, agent.loop]
related: [tools.schema-validation, tools.mcp-architecture, patterns.react]
contrasts: []
implements: []
exampleOf: []
supersedes: []
tags: [tools, function-calling, aci, json-schema]
sourceIds: [openai.function-calling, anthropic.effective-agents]
labIds: [function-calling]
verifiedAt: "2026-11-26"
---
## 一句话定义

**Function Calling（工具调用）** 是大模型根据开发者传入的工具名称、功能描述与 JSON Schema 参数定义，在需要外部数据时输出结构化调用请求（`tool_calls`），由宿主代码执行并返回 `tool` 结果的交互机制。

## 产生背景与需要解决的问题

纯文本模型无法访问实时数据库、私有文件或精确数值计算。早期靠正则解析自然语言动作极易失败；Function Calling 将工具发现和调用意图结构化并纳入模型对话协议。

## 第一性原理

Anthropic 提出了 **ACI（Agent-Computer Interface，智能体-计算机接口）** 概念：就像给人设计优秀 API 和 UI 一样，给模型设计工具时要站在模型视角思考——命名是否直观？参数是否容易填错（如相对路径 vs 绝对路径）？错误信息是否可指导修正？

## 核心运行机制

```mermaid
sequenceDiagram
  participant Host as 宿主运行时
  participant LLM as 大语言模型
  participant Tool as 本地工具函数
  Host->>LLM: 请求 + Tools Schema 清单
  LLM-->>Host: tool_call(id="call_1", name="search", args={...})
  Host->>Tool: 校验参数并执行
  Tool-->>Host: 执行结果或结构化错误
  Host->>LLM: 追加 tool_result(tool_call_id="call_1")
  LLM-->>Host: 基于真实观测的最终回答
```

## 最小可行实现

> 说明：以下为通用 Tool 定义结构（兼容 OpenAI Chat Completions `tools` 字段规范）。

```json
{
  "type": "function",
  "function": {
    "name": "search_knowledge",
    "description": "在本地知识库中按中英文关键词检索条目。优先传入核心术语而非整句长问题。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "搜索关键词，例如 'MCP' 或 '循环'" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 }
      },
      "required": ["query"],
      "additionalProperties": false
    }
  }
}
```

## 实际应用场景

- 数据库只读查询、知识检索、文件读写与外部服务状态变更。

## 反例与常见误区

- **反例**：一次性向模型注册 60 个功能高度重叠的工具（如 `get_user`, `fetch_user`, `list_users_v2`），导致模型决策混乱并耗尽前置上下文预算。
- **误区**：以为工具函数会在模型服务端执行；实际上模型**绝不会直接运行你的函数**，全部执行都在你自己的宿主进程里发生。

## 工程权衡

- **细粒度多工具 vs 粗粒度复合工具**：工具太碎会增加往返轮次与延迟；适当合并高频关联查询，并在工具内做好输入防呆（poka-yoke），可大幅提高首次调用成功率。

## 关联知识

- 前置：[[llm.structured-output]]、[[agent.loop]] · 延伸：[[tools.schema-validation]]、[[tools.mcp-architecture]]

## 事实分级与参考来源

- **已验证事实**：模型仅生成结构化函数调用参数，宿主负责执行并按 `tool_call_id` 回传结果（OpenAI Function Calling 文档）。
- **工程经验**：投入精力打磨工具文档与防呆参数边界，往往比微调提示词更能提升 Agent 成功率（Anthropic Effective Agents）。
