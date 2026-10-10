# 代码审查 Agent

一个带验证闭环、策略选择、长期记忆的 LLM 代码审查 Agent。用户粘贴 JavaScript 代码，Agent 自动检查 ESLint 问题和代码格式，并通过工具调用自主决策修复策略。

## 项目定位

这个项目是一个有自主决策能力的 Agent：

- LLM 通过 tool calling 自主决定调用哪个工具、按什么顺序、何时结束
- 用 ESLint 和 Prettier 做客观验证，不依赖 LLM 自称"修好了"
- 记录每一步的工具调用和代码变化，把黑盒 Agent 变成可解释流程
- 跨会话积累"规则 → 修复方案"的成功率，形成长期记忆

## 核心特性

### 1. LLM 自主决策（Agent Loop）

流程不是写死的，而是把 `run_eslint` / `auto_fix` / `fix_code` / `finish` 包装成工具，由 LLM 通过 tool calling 自主决定调用顺序和终止时机。

### 2. 策略选择：确定性修复 vs LLM 修复

Agent 有两种修复路径：

- `auto_fix`：ESLint 自动修复，零 token 成本，适合机械问题（分号、引号、缩进）
- `fix_code`：LLM 手工修复，成本高，适合复杂逻辑问题（未使用变量、`eqeqeq`）

LLM 自己判断用哪个。实测它会先试 `auto_fix`，搞不定再切 `fix_code`。

### 3. 验证闭环 + 重试

每次修复后自动重新校验。如果还有报错，带着新报错重试。最多修复 2 次，避免死循环。

### 4. 双验证器：ESLint + Prettier

- ESLint：检查逻辑规范
- Prettier：检查代码格式

ESLint 通过后，系统自动触发 Prettier 检查，两个都通过才算成功。

### 5. 单调递减约束 + 快照回滚

每次修复前记录快照。如果修复后报错数没下降（原地踏步或变多），立即回滚到上一版，并把回滚信息反馈给 LLM 引导换方案。

### 6. 长期记忆（规则 → 方案级）

记录"规则 → 修复方案 → 成功率"的映射，存 localStorage 跨会话保留：

```json
{
  "no-unused-vars": {
    "加 void 操作符": { "success": 3, "fail": 1 },
    "删除未使用变量": { "success": 1, "fail": 4 }
  }
}
```

下次遇到同类规则，把历史经验注入给 LLM，引导它优先用高成功率的方案。注意这里记的是"方案"而不是"工具"——工具是手段，方案才是策略。

### 7. 过程可视化

- 时间线：每一步的工具调用、报错变化、是否回滚
- 每步 diff：点击展开，看这一步和上一步的代码变化
- 收敛曲线：报错数随步骤的变化，直观看到 Agent 在收敛
- 成本仪表盘：总步骤、ESLint 校验次数、自动修复次数、LLM 修复次数、回滚次数、总耗时

### 8. 其他

- 规则可配置（用户勾选 ESLint 规则，偏好本地持久化）
- 历史记录（localStorage 保存，可回看）
- 修复率统计

## 技术栈

- 前端：React + TypeScript + Vite + Monaco Editor + react-diff-viewer-continued + recharts
- 后端：Node.js + Express + ESLint + Prettier
- AI：DeepSeek（tool calling）

## 架构

```
┌─────────────────────────────────────────────┐
│  前端 (React + Vite + TS)                   │
│  - Monaco Editor（代码编辑）                 │
│  - 时间线组件（Agent 过程 + 每步 diff）      │
│  - 收敛曲线（recharts）                      │
│  - 成本仪表盘                                │
│  - localStorage（历史 + 规则偏好 + 长期记忆）│
└──────────────────┬──────────────────────────┘
                   │ HTTP
┌──────────────────▼──────────────────────────┐
│  后端 (Node + Express)                      │
│  - POST /lint：ESLint 校验                   │
│  - POST /fix：ESLint 自动修复                │
│  - POST /format-check：Prettier 检查         │
└──────────────────┬──────────────────────────┘
                   │ Tool Calling
┌──────────────────▼──────────────────────────┐
│  LLM (DeepSeek)                             │
│  - 自主决定调用哪个工具、何时结束            │
└─────────────────────────────────────────────┘
```

## Agent 工作流程

```
1. LLM 调 run_eslint 检查代码
2. 有报错：
   - 第一次修复先调 auto_fix（确定性、零成本）
   - auto_fix 后仍有报错，调 fix_code（LLM 修复）
   - 修复后回到第 1 步
3. ESLint 通过后，自动跑 Prettier 格式检查
4. 两个验证器都通过 → finish
```

代码层加硬性终止条件做兜底：

- 无报错立即成功结束（不等 LLM 调 finish）
- LLM 修复超过 2 次强制结束
- 循环超过 10 轮强制结束
- 报错数不降则回滚

## 核心设计决策

### 为什么用工具做验证，而不是让 LLM 自己判断

LLM 会"自称修好了"，但实际可能没修好，甚至引入新错误。ESLint 和 Prettier 提供客观验证，这是 Agent 和普通 AI 补全的本质区别。

### 为什么代码层要有硬性终止

实测发现快模型会忘记调 `finish`，陷入循环。所以不完全信任模型的自我约束，在代码层加终止条件兜底。LLM 负责决策调哪个工具，代码负责兜底终止条件。

### 为什么长期记忆记"方案"而不是"工具"

工具只有 `auto_fix` 和 `fix_code` 两个，记录"工具成功率"指导空间有限。而同一规则有多种修复方案（比如 `no-unused-vars` 可以"删除变量"、"加 void"、"导出变量"），记录方案成功率才能真正指导策略选择。

### 为什么 ESLint 放后端

浏览器端打包 ESLint 有已知的 Node 模块兼容问题（`window is not defined`、`node:path` 无法解析等），所以用极简 Express 接口跑 ESLint 和 Prettier。

## 快速开始

### 1. 启动后端

```bash
cd server
npm install
npm run dev
```

### 2. 启动前端

```bash
cd client
npm install
npm run dev
```

### 3. 配置 `client/.env.local`

```
VITE_LLM_API_URL=https://api.deepseek.com/v1
VITE_LLM_API_KEY=你的key
VITE_LLM_MODEL=deepseek-chat
```

### 4. 打开 http://localhost:5173

## 待改进

- 支持 TypeScript / Vue 多语言
- 支持审查项目文件而非单段代码
- Plan-then-Act：对复杂任务先规划再执行（当前任务简单，暂不需要）
- 规则文档 RAG 检索（当前 LLM 已知 ESLint 规则，暂不需要）
