import type { LintMessage } from "./api";

const API_URL = import.meta.env.VITE_LLM_API_URL;
const API_KEY = import.meta.env.VITE_LLM_API_KEY;
const MODEL = import.meta.env.VITE_LLM_MODEL || "deepseek-chat";

export async function fixWithLLM(
  code: string,
  errors: LintMessage[],
): Promise<string> {
  const errorText = errors
    .map((e) => `第${e.line}行 第${e.column}列: ${e.message} (${e.ruleId})`)
    .join("\n");

  const prompt = `你是一个代码修复助手。请根据以下 ESLint 报错修复代码。

原始代码：
\`\`\`javascript
${code}
\`\`\`

ESLint 报错：
${errorText}

要求：
1. 只修复报错，不要改变原有逻辑
2. 不要添加注释解释
3. 直接返回完整的修复后代码，用 \`\`\`javascript 包裹`;

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
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  return extractCode(content);
}

function extractCode(text: string): string {
  const match = text.match(
    /```(?:javascript|js|ts|typescript)?\n([\s\S]*?)```/,
  );
  return match ? match[1].trim() : text.trim();
}
