import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
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
        {steps.map((step, i) => {
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
              case "check_format":
                return "📐 Prettier 校验";
              default:
                return step.type === "lint" ? "🔍 校验" : "🔧 修复";
            }
          })();

          // 上一步的代码（用于 diff）
          const prevStep = i > 0 ? steps[i - 1] : null;
          const prevCode = prevStep?.code ?? null;

          // 只有修复类工具才可能改代码，校验类不算
          const isFixStep =
            step.tool === "auto_fix" || step.tool === "fix_code";
          const codeChanged =
            isFixStep && prevCode !== null && prevCode !== step.code;

          return (
            <div
              key={step.index}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                background: "#fff",
                overflow: "hidden",
              }}
            >
              {/* 标题行：点击展开/收起 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 10,
                  cursor: "pointer",
                }}
                onClick={() => setExpanded(isOpen ? null : step.index)}
              >
                <strong>
                  第 {step.index + 1} 步：{toolLabel}
                  {step.rolledBack && (
                    <span
                      style={{
                        color: "red",
                        marginLeft: 8,
                        fontWeight: "normal",
                      }}
                    >
                      ↩ 已回滚
                    </span>
                  )}
                  {codeChanged && (
                    <span
                      style={{
                        color: "#999",
                        marginLeft: 8,
                        fontWeight: "normal",
                        fontSize: 12,
                      }}
                    >
                      （代码有变化）
                    </span>
                  )}
                </strong>
                <span style={{ color: errorCount === 0 ? "green" : "orange" }}>
                  {errorCount === 0 ? "✅ 无报错" : `⚠️ ${errorCount} 个报错`}
                  <span style={{ marginLeft: 8, color: "#999", fontSize: 12 }}>
                    {isOpen ? "▲" : "▼"}
                  </span>
                </span>
              </div>

              {/* 展开区域 */}
              {isOpen && (
                <div style={{ padding: "0 10px 10px" }}>
                  {/* 报错列表 */}
                  {errorCount > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <strong style={{ fontSize: 13 }}>报错：</strong>
                      <ul style={{ marginTop: 4, fontSize: 13 }}>
                        {step.errors.map((e, j) => (
                          <li key={j}>
                            第 {e.line} 行：{e.message}（{e.ruleId}）
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 与上一步的 diff */}
                  {codeChanged && prevCode !== null ? (
                    <div>
                      <strong style={{ fontSize: 13 }}>
                        与上一步的代码变化：
                      </strong>
                      <div style={{ marginTop: 4 }}>
                        <ReactDiffViewer
                          oldValue={prevCode}
                          newValue={step.code}
                          splitView={false}
                          useDarkMode={false}
                          hideLineNumbers={false}
                        />
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: "#999" }}>
                      这一步没有改变代码
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
