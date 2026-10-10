// Phase 9.1：规则列表
export const AVAILABLE_RULES = [
  { id: "no-unused-vars", label: "禁止未使用变量", default: true },
  { id: "no-undef", label: "禁止使用未定义变量", default: true },
  { id: "semi", label: "强制分号", default: true },
  { id: "no-console", label: "禁止 console", default: false },
  { id: "eqeqeq", label: "强制 ===", default: false },
  { id: "no-var", label: "禁止 var", default: false },
];

// Phase 9.2：规则偏好的存取和转换
const RULES_KEY = "code-review-rules";

export function loadRulePrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return Object.fromEntries(AVAILABLE_RULES.map((r) => [r.id, r.default]));
}

export function saveRulePrefs(prefs: Record<string, boolean>) {
  localStorage.setItem(RULES_KEY, JSON.stringify(prefs));
}

export function buildRules(
  prefs: Record<string, boolean>,
): Record<string, any> {
  const rules: Record<string, any> = {};
  for (const [id, enabled] of Object.entries(prefs)) {
    if (enabled) {
      // 特殊规则用数组形式
      rules[id] = id === "semi" ? ["error", "always"] : "error";
    }
  }
  return rules;
}
