const API_BASE = "http://localhost:3001";

export interface LintMessage {
  line: number;
  column: number;
  severity: 1 | 2;
  message: string;
  ruleId: string | null;
}

export async function lintCode(
  code: string,
  rules?: Record<string, any>,
): Promise<LintMessage[]> {
  const res = await fetch(`${API_BASE}/lint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, rules }),
  });

  if (!res.ok) {
    throw new Error(`Lint failed: ${res.status}`);
  }

  const data = await res.json();
  return data.messages;
}

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

//prettier验证
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

export interface DeepCheckResult {
  eslint: LintMessage[];
  ast: { type: string; name?: string; message: string }[];
  complexity: { level: number; message: string }[];
}

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
