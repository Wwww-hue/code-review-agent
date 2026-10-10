import type { LintMessage } from "./api";

const API_URL = import.meta.env.VITE_LLM_API_URL;
const API_KEY = import.meta.env.VITE_LLM_API_KEY;
const MODEL = import.meta.env.VITE_LLM_MODEL || "deepseek-chat";

export interface FixResult {
  code: string;
  strategies: { ruleId: string; strategy: string }[];
}

export async function fixWithLLM(
  code: string,
  errors: LintMessage[],
): Promise<FixResult> {
  const errorText = errors
    .map((e) => `第${e.line}行: ${e.message} (${e.ruleId})`)
    .join("\n");

  const ruleIds = [...new Set(errors.map((e) => e.ruleId).filter(Boolean))];

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

  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(content);
    return {
      code: parsed.code || code,
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
    };
  } catch {
    // 兜底：JSON 解析失败，当纯代码处理
    return { code: extractCode(content), strategies: [] };
  }
}

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
      tools,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text}`);
  }

  return res.json();
}

function extractCode(text: string): string {
  const match = text.match(
    /```(?:javascript|js|ts|typescript)?\n([\s\S]*?)```/,
  );
  return match ? match[1].trim() : text.trim();
}
