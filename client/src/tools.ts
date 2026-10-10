export const AGENT_TOOLS = [
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
        required: ["code"],
      },
    },
  },
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
