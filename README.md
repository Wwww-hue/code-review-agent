# 代码审查 Agent

一个带验证闭环的 LLM Agent，自动检查并修复代码的 ESLint 问题。

## 核心特性

- **Agent 自主决策**：LLM 通过 tool calling 自主决定调用 ESLint 校验、修复代码、何时结束
- **验证闭环**：修复后自动重新校验，不通过则带着新报错重试
- **代码兜底**：不依赖 LLM 自我约束，无报错立即成功，超 2 次修复强制结束
- **过程可视化**：每一步的工具调用、报错变化都以时间线展示
- **可配置规则**：用户勾选 ESLint 规则，偏好本地持久化
- **历史记录**：审查记录本地保存，可回看

## 技术栈

- 前端：React + TypeScript + Vite + Monaco Editor + react-diff-viewer-continued
- 后端：Node.js + Express + ESLint
- AI：DeepSeek（tool calling）

## 架构

（画个图）

## 核心设计

### 为什么用 ESLint 做验证器

LLM 会"自称修好了"，但实际可能没修好甚至引入新错。
ESLint 提供客观验证，这是 Agent 和普通 AI 补全的区别。

### Agent loop

不是写死的流程，而是把 lint / fix / finish 包装成工具，
由 LLM 通过 tool_calls 自主决定调用顺序和终止时机。
代码层加硬性终止条件做兜底，防止模型死循环。

## 快速开始

1. 启动后端：`cd server && npm install && npm run dev`
2. 启动前端：`cd client && npm install && npm run dev`
3. 配置 `client/.env.local`（API URL、KEY、MODEL）

## 待改进

- 支持 TypeScript
