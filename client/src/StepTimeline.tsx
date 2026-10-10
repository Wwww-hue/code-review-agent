import { useState } from "react";
import type { AgentStep } from "./agent";

interface Props {
  steps: AgentStep[];
}

export function StepTimeline({ steps }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (steps.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <h3>Agent 执行过程</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((step) => {
          const isLint = step.type === "lint";
          const errorCount = step.errors.length;
          const isOpen = expanded === step.index;
          const toolLabel = (() => {
            switch (step.tool) {
              case "run_eslint":
                return "🔍 ESLint 校验";
              case "auto_fix":
                return "⚡ 自动修复（确定性）";
              case "fix_code":
                return "🤖 LLM 修复";
              default:
                return step.type === "lint" ? "🔍 ESLint 校验" : "🔧 修复";
            }
          })();

          return (
            <div
              key={step.index}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: 10,
                background: "#fff",
                cursor: "pointer",
              }}
              onClick={() => setExpanded(isOpen ? null : step.index)}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  第 {step.index + 1} 步：{toolLabel}
                </strong>
                <span style={{ color: errorCount === 0 ? "green" : "orange" }}>
                  {errorCount === 0 ? "✅ 无报错" : `⚠️ ${errorCount} 个报错`}
                </span>
              </div>

              {isOpen && errorCount > 0 && (
                <ul style={{ marginTop: 8, fontSize: 13 }}>
                  {step.errors.map((e, i) => (
                    <li key={i}>
                      第 {e.line} 行：{e.message}（{e.ruleId}）
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
