import type { AgentResult } from "./agent";

interface Props {
  result: AgentResult | null;
  hasSteps: boolean;
}

export function CostDashboard({ result, hasSteps }: Props) {
  // 历史回填：有 result 但没 steps → 不渲染
  if (result && !hasSteps) return null;

  // 用 result 或"空数据"
  const steps = result?.steps ?? [];
  const totalSteps = steps.length;
  const lintCount = steps.filter((s) => s.tool === "run_eslint").length;
  const autoFixCount = steps.filter((s) => s.tool === "auto_fix").length;
  const llmFixCount = steps.filter((s) => s.tool === "fix_code").length;
  const rollbackCount = result?.rollbackCount ?? 0;
  const durationSec = ((result?.durationMs ?? 0) / 1000).toFixed(1);

  const items = [
    { label: "总步骤", value: totalSteps },
    { label: "ESLint 校验", value: lintCount },
    { label: "自动修复", value: autoFixCount },
    { label: "LLM 修复", value: llmFixCount, highlight: llmFixCount > 0 },
    { label: "回滚次数", value: rollbackCount, highlight: rollbackCount > 0 },
    { label: "总耗时", value: `${durationSec}s` },
  ];

  return (
    <div style={{ marginTop: 20 }}>
      <h3>运行成本</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 8,
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 6,
              padding: 10,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: "bold",
                color: item.highlight ? "#ff6b6b" : "#333",
              }}
            >
              {item.value}
            </div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "#999", margin: "8px 0 0" }}>
        LLM 修复是成本最高的操作，自动修复零 token 成本
      </p>
    </div>
  );
}
