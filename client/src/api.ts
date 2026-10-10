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
