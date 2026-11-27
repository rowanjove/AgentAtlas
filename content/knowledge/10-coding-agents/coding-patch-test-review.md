---
id: coding.patch-test-review
slug: coding-patch-test-review
title: 补丁生成、测试验证与自动代码审查闭环
enTitle: Patch Generation, Testing & Review Loop
aliases: [Patch Test Loop, Coding Agent Loop]
type: pattern
domain: coding-agents
level: intermediate
revision: 1
majorUpdate: false
estimatedMinutes: 15
summary: 建立“精准定位 → 最小局部补丁 → 确定性测试/类型检查 → Diff 自我审查”的高可靠软件工程 Agent 闭环。
objectives:
  - 掌握局部编辑（Hunk/Search-Replace）优于整文件重写的原因
  - 将编译器、Linter 与单测报错转化为驱动修复的高质量反馈信号
requires: [coding.repo-context-agents-md, harness.runtime-sandbox]
related: [patterns.evaluator-optimizer, evals.datasets-metrics]
contrasts: []
implements: []
exampleOf: []
supersedes: []
tags: [coding-agent, patch, testing, code-review]
sourceIds: [paper.swe-bench, anthropic.effective-harnesses]
labIds: [harness-engineering]
verifiedAt: "2026-11-26"
---
## 一句话定义

**补丁-测试-审查闭环** 是 Coding Agent 修改代码时的标准工作流：只做最小局部目标替换（Patch），随后立即运行确定性编译/类型检查/单元测试验证，并基于真实 `git diff` 审查副作用。

## 产生背景与需要解决的问题

如果让模型直接“重写整个 600 行文件”，经常出现无意删掉无关注释、改坏未触及函数或消耗大量输出 Token 的问题；同时若不强制运行真实测试，模型常常产生“看似合理但无法通过编译”的幻觉补丁。

## 第一性原理

1. **最小局部变更原则（Minimal Diff）**：精准指定目标块替换比整文件输出更省 Token、错误率更低、可审查性更强。
2. **先窄后宽验证**：先跑与改动直接相关的单测与 `tsc --noEmit`（几秒内反馈），全部通过后再跑端到端构建与 E2E 测试。

## 核心运行机制

```mermaid
flowchart LR
  Locate["1. 定位精确符号与上下文"] --> Patch["2. 应用最小局部 Diff"]
  Patch --> Check["3. 运行 Typecheck + 关联单测"]
  Check -- 失败 --> Locate
  Check -- 通过 --> Review["4. git diff 自检无关改动"]
```

## 最小可行实现

```ts
export function applyExactPatch(source: string, target: string, replacement: string): string {
  const idx = source.indexOf(target);
  if (idx === -1) throw new Error('Patch target not found: aborting without partial corruption');
  if (source.indexOf(target, idx + 1) !== -1) throw new Error('Ambiguous patch target: multiple occurrences');
  return source.slice(0, idx) + replacement + source.slice(idx + target.length);
}
```

## 实际应用场景

- 自动修复 Bug、新增端到端回归测试、跨文件重构接口签名（参见 [[case.code-review-pipeline]]）。

## 反例与常见误区

- **反例**：遇到测试失败时，模型为了“让测试变绿”去把断言删掉、把测试跳过（`.skip`）或放宽校验条件。Harness 与审查规程必须明确禁止此类行为。

## 工程权衡

- **自动提交 vs 人类 Diff 审查**：在生产仓库中，Coding Agent 产出应当是经过全套验证的干净工作区或 PR，而不是跳过审查直接强推主分支。

## 关联知识

- 前置：[[coding.repo-context-agents-md]]、[[harness.runtime-sandbox]] · 延伸：[[patterns.evaluator-optimizer]]

## 事实分级与参考来源

- **已验证事实**：SWE-bench（Jimenez et al., ICLR 2024）以真实 GitHub Issue 的测试补丁（FAIL_TO_PASS & PASS_TO_PASS）作为客观验证标准；强制局部 Diff 与真实测试执行大幅提升补丁可靠度。
