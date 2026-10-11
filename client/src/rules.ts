/**
 * 管理「用户勾选了哪些 ESLint 规则」。
 *
 * 流程：
 * 1. AVAILABLE_RULES：页面上能勾选的规则清单
 * 2. loadRulePrefs / saveRulePrefs：把勾选状态存 localStorage
 * 3. buildRules：把「勾选状态」转成 ESLint 真正认识的 rules 配置对象
 *    （发给后端 /lint、/fix 用）
 */

/** 页面上展示的可选规则。default = 首次打开时是否默认勾选 */
export const AVAILABLE_RULES = [
  { id: "no-unused-vars", label: "禁止未使用变量", default: true },
  { id: "no-undef", label: "禁止使用未定义变量", default: true },
  { id: "semi", label: "强制分号", default: true },
  { id: "no-console", label: "禁止 console", default: false },
  { id: "eqeqeq", label: "强制 ===", default: false },
  { id: "no-var", label: "禁止 var", default: false },
];

const RULES_KEY = "code-review-rules";

/**
 * 读用户的勾选偏好。
 * 没有存过 → 用 AVAILABLE_RULES 里的 default 拼一份默认值。
 */
export function loadRulePrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return Object.fromEntries(AVAILABLE_RULES.map((r) => [r.id, r.default]));
}

/** 勾选变化时立刻持久化 */
export function saveRulePrefs(prefs: Record<string, boolean>) {
  localStorage.setItem(RULES_KEY, JSON.stringify(prefs));
}

/**
 * 把 { "semi": true, "no-console": false } 转成 ESLint 配置：
 * { "semi": ["error", "always"], "no-unused-vars": "error", ... }
 *
 * 未勾选的规则不会出现在对象里（等于关闭）。
 */
export function buildRules(
  prefs: Record<string, boolean>,
): Record<string, any> {
  const rules: Record<string, any> = {};
  for (const [id, enabled] of Object.entries(prefs)) {
    if (enabled) {
      // semi 比较特殊：除了开错误，还要指定「必须有分号」
      rules[id] = id === "semi" ? ["error", "always"] : "error";
    }
  }
  return rules;
}
