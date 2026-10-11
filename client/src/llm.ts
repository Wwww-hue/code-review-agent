/**
 * 跟大模型（LLM，这里是 DeepSeek）对话的两个入口：
 *
 * 1. fixWithLLM      —— 「请直接帮我改这段代码」（普通聊天，要求返回 JSON）
 * 2. callLLMWithTools —— 「你是 Agent，可以调用工具」（Tool Calling 模式）
 *
 * API Key 等配置来自 client/.env.local：
 *   VITE_LLM_API_URL / VITE_LLM_API_KEY / VITE_LLM_MODEL
 */

import type { LintMessage } from "./api";

// Vite 会把 import.meta.env.VITE_* 替换成 .env.local 里的值
const API_URL = import.meta.env.VITE_LLM_API_URL;
const API_KEY = import.meta.env.VITE_LLM_API_KEY;
const MODEL = import.meta.env.VITE_LLM_MODEL || "deepseek-chat";

/**
 * LLM 修复后的结果：
 * - code: 修好后的完整代码
 * - strategies: 它对每条规则用了什么方案（写进长期记忆用）
 */
export interface FixResult {
  code: string;
  strategies: { ruleId: string; strategy: string }[];
}

/**
 * 让 LLM「手工」修代码。
 * 和 auto_fix 不同：这里会消耗 token，适合复杂逻辑问题。
 */
export async function fixWithLLM(
  code: string,
  errors: LintMessage[],
): Promise<FixResult> {
  // 把报错列表整理，塞进 prompt
  const errorText = errors
    .map((e) => `第${e.line}行: ${e.message} (${e.ruleId})`)
    .join("\n");

  // 去重后的规则名，方便模型在 strategies 里填写
  const ruleIds = [...new Set(errors.map((e) => e.ruleId).filter(Boolean))];

  // prompt = 发给模型的说明书 + 任务
  const prompt = `你是一个代码修复助手。请根据以下 ESLint 报错修复代码。

原始代码：
\`\`\`javascript
${code}
\`\`\`

ESLint 报错：
${errorText}

要求：
1. 只修复报错，不要改变原有逻辑
2. 禁止使用 eslint-disable 注释绕过报错，必须真正修复
3. 返回 JSON 格式，不要有其他内容：
{
  "code": "修复后的完整代码",
  "strategies": [
    { "ruleId": "规则名", "strategy": "你用了什么方案修复，简短描述" }
  ]
}

可选的规则名（从报错里取）：${ruleIds.join(", ")}

方案描述要求：
- 简短、统一的中文描述，避免同义不同词
- 例如 no-unused-vars 统一用："删除未使用变量"、"加 void 操作符"、"导出变量"
- 例如 semi 统一用："补全分号"
- 例如 eqeqeq 统一用："改用 ==="
- 例如 no-console 统一用："删除 console"、"改用 logger"`;

  // 调用兼容 OpenAI 格式的 Chat Completions 接口
  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Bearer Token：证明「我有权限用这个 API」
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2, // 越低越准确稳定，修复任务一般用低温度（创造性的任务用高温度）
      response_format: { type: "json_object" }, // 要求模型返回 JSON
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text}`);
  }

  const data = await res.json();
  // 模型真正说的话，在这个字段里
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(content); // 把json格式的数据转换为对象
    return {
      code: parsed.code || code,
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
    };
  } catch {
    // 万一模型没按 JSON 返回，尝试从 markdown 代码块里抠代码
    return { code: extractCode(content), strategies: [] };
  }
}

/**
 * Agent 主循环用的接口：带上 tools，让模型自己决定调哪个工具。
 *
 * @param messages 多轮对话历史（system / user / assistant / tool）
 * @param tools    工具菜单，见 tools.ts 的 AGENT_TOOLS
 * @returns        模型完整响应；若要调工具，会出现 message.tool_calls
 */
export async function callLLMWithTools(
  messages: any[],
  tools: any[],
): Promise<any> {
  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools, // ← 关键：把工具列表交给模型
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text}`);
  }

  return res.json();
}

/** 从模型回复里提取 ```javascript ... ``` 代码块；没有就当整段都是代码 */
function extractCode(text: string): string {
  const match = text.match(
    /```(?:javascript|js|ts|typescript)?\n([\s\S]*?)```/,
  );
  return match ? match[1].trim() : text.trim();
}
