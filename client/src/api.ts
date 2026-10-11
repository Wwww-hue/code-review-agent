/**
 * 通过这里的函数，用 HTTP 请求让后端帮忙检查/修复。
 */

// 后端地址（Express 服务默认跑在 3001 端口）
const API_BASE = "http://localhost:3001";

/**
 * 一条 ESLint 报错长什么样。
 * severity: 1 = 警告(warn)，2 = 错误(error)
 * ruleId: 比如 "no-unused-vars"（哪个规则触发的）
 */
export interface LintMessage {
  line: number;
  column: number;
  severity: 1 | 2;
  message: string;
  ruleId: string | null;
}

/**
 * 调用后端 POST /lint：只检查，不修改代码。
 * @param code  要检查的 JS 代码
 * @param rules 用户勾选的 ESLint 规则（可选）
 * @returns     报错列表；没有报错时是空数组 []
 */
export async function lintCode(
  code: string,
  rules?: Record<string, any>,
): Promise<LintMessage[]> {
  const res = await fetch(`${API_BASE}/lint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 把代码和规则打包成 JSON 发给后端
    body: JSON.stringify({ code, rules }),
  });

  if (!res.ok) {
    throw new Error(`Lint failed: ${res.status}`);
  }

  const data = await res.json();
  return data.messages;
}

/**
 * 调用后端 POST /fix：让 ESLint 自动修能修的问题。
 * 适合机械性问题（缺分号、引号风格等），不花 LLM token。
 * @returns fixed = 修复后的代码；changed = 有没有真的改过
 */
export async function autoFix(code: string, rules?: Record<string, any>) {
  const res = await fetch(`${API_BASE}/fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, rules }),
  });
  if (!res.ok) throw new Error(`Auto fix failed: ${res.status}`);
  const data = await res.json();
  return data as { fixed: string; changed: boolean };
}

/**
 * 调用后端 POST /format-check：用 Prettier 检查格式。
 * ESLint 管「对不对」，Prettier 管「好不好看」。
 * 两个都过，才算真正审查成功。
 */
export async function checkFormat(
  code: string,
): Promise<{ formatted: string; isFormatted: boolean }> {
  const res = await fetch(`${API_BASE}/format-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    throw new Error(`Format check failed: ${res.status}`);
  }

  return res.json();
}

/**
 * 深度检查的返回结构：
 * - eslint: 普通 ESLint 报错
 * - ast: 从代码结构（抽象语法树）发现的问题，比如声明了却没用
 * - complexity: 复杂度过高的提示
 */
export interface DeepCheckResult {
  eslint: LintMessage[];
  ast: { type: string; name?: string; message: string }[];
  complexity: { level: number; message: string }[];
}

/**
 * 调用后端 POST /deep-check：比普通 lint 更全面。
 * 适合较长、多函数的代码；简单代码用 lintCode 就够了。
 */
export async function deepCheck(
  code: string,
  rules?: Record<string, any>,
): Promise<DeepCheckResult> {
  const res = await fetch(`${API_BASE}/deep-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, rules }),
  });

  if (!res.ok) {
    throw new Error(`Deep check failed: ${res.status}`);
  }

  return res.json();
}
