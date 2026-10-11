/**
 * 定义 Agent 能用的「工具菜单」，发给大模型（LLM）。
 *
 * 【什么是 Tool Calling（工具调用）？】
 * 普通聊天里，模型只能回文字。
 * 开了 tool calling 后，模型可以回复：「请帮我调用某某工具，参数是……」
 * 然后我们的代码真正去执行这个工具，再把结果塞回对话，模型继续思考。
 *
 * 本文件只负责「描述工具长什么样」，真正执行在 agent.ts 里。
 *
 * 结构说明（OpenAI / DeepSeek 通用格式）：
 * {
 *   type: "function",
 *   function: {
 *     name: 工具名（代码里用这个名字匹配）,
 *     description: 给模型看的说明（模型靠这个决定要不要用）,
 *     parameters: 参数的 JSON Schema（模型按这个填参数）
 *   }
 * }
 */

export const AGENT_TOOLS = [
  // ---------- 工具 1：快速 ESLint 检查 ----------
  {
    type: "function" as const,
    function: {
      name: "run_eslint",
      description:
        "对给定 JavaScript 代码运行 ESLint，返回报错列表。每次修改代码后都应该调用它来验证。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要检查的 JavaScript 代码" },
        },
        required: ["code"], // 调用时必须带上 code
      },
    },
  },

  // ---------- 工具 2：深度检查（更慢、更全） ----------
  {
    type: "function" as const,
    function: {
      name: "deep_check",
      description:
        "深度检查：跑 ESLint + AST 分析 + 复杂度检查。比 run_eslint 慢，但能发现死代码、未使用函数、高复杂度函数。适合代码较长、有多个函数的复杂场景。简单代码用 run_eslint 即可。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要检查的代码" },
        },
        required: ["code"],
      },
    },
  },

  // ---------- 工具 3：确定性自动修复（零 token 成本） ----------
  {
    type: "function" as const,
    function: {
      name: "auto_fix",
      description:
        "用 ESLint 的自动修复功能修复代码。适合机械性问题（缺分号、引号、缩进等）。零成本、确定性，优先于 fix_code 使用。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要修复的代码" },
        },
        required: ["code"],
      },
    },
  },

  // ---------- 工具 4：让 LLM 自己改代码（贵，但能处理复杂逻辑） ----------
  {
    type: "function" as const,
    function: {
      name: "fix_code",
      description:
        "根据 ESLint 报错修复代码，返回修复后的代码。只有在 run_eslint 返回了报错时才调用。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要修复的代码" },
          errors: {
            type: "string",
            description:
              "ESLint 报错的 JSON 字符串，来自上一次 run_eslint 的结果",
          },
        },
        required: ["code", "errors"],
      },
    },
  },

  // ---------- 工具 5：主动结束（有时模型会忘，agent.ts 里还有硬性兜底） ----------
  {
    type: "function" as const,
    function: {
      name: "finish",
      description:
        "审查完成时调用。如果代码已无报错，success 为 true；如果重试后仍有报错，success 为 false。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "最终代码" },
          success: { type: "boolean", description: "是否全部通过" },
        },
        required: ["code", "success"],
      },
    },
  },
];
