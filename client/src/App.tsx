import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { runAgent, type AgentResult, type AgentStep } from "./agent";
import { StepTimeline } from "./StepTimeline";
import { loadHistory, saveHistory, type HistoryItem } from "./history";
import {
  AVAILABLE_RULES,
  loadRulePrefs,
  saveRulePrefs,
  buildRules,
} from "./rules";

const DEFAULT_CODE = `var x = 1
console.log(x)
function foo() {
  return 1
}
`;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rulePrefs, setRulePrefs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setHistory(loadHistory());
    setRulePrefs(loadRulePrefs());
  }, []);

  const handleReview = async () => {
    setLoading(true);
    setSteps([]);
    setResult(null);
    try {
      const r = await runAgent(code, buildRules(rulePrefs), (step) => {
        setSteps((prev) => [...prev, step]);
      });
      setResult(r);
      setHistory(saveHistory(r));
    } catch (e) {
      alert("审查失败：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleHistoryClick = (item: HistoryItem) => {
    setCode(item.originalCode);
    setResult({
      originalCode: item.originalCode,
      fixedCode: item.fixedCode,
      steps: [],
      attempts: item.attempts,
      finalErrors: [],
      success: item.success,
    });
    setSteps([]);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* 侧边栏 */}
      <aside
        style={{
          width: 240,
          borderRight: "1px solid #ddd",
          padding: 12,
          background: "#fafafa",
          overflowY: "auto",
        }}
      >
        <h3 style={{ marginTop: 0 }}>历史记录</h3>
        {history.length === 0 && (
          <p style={{ color: "#999", fontSize: 13 }}>暂无记录</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {history.map((item) => (
            <div
              key={item.id}
              onClick={() => handleHistoryClick(item)}
              style={{
                padding: 8,
                border: "1px solid #eee",
                borderRadius: 4,
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <div>{new Date(item.timestamp).toLocaleString()}</div>
              <div style={{ color: item.success ? "green" : "orange" }}>
                {item.success ? "✅ 通过" : "⚠️ 未通过"} · 尝试 {item.attempts}{" "}
                次
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 主区域 */}
      <main style={{ flex: 1, padding: 20, fontFamily: "system-ui" }}>
        <h1>代码审查 Agent</h1>

        {/* 规则面板 */}
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#fff",
          }}
        >
          <strong style={{ display: "block", marginBottom: 8 }}>
            ESLint 规则
          </strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {AVAILABLE_RULES.map((r) => (
              <label key={r.id} style={{ fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={rulePrefs[r.id] ?? false}
                  onChange={(e) => {
                    const next = { ...rulePrefs, [r.id]: e.target.checked };
                    setRulePrefs(next);
                    saveRulePrefs(next);
                  }}
                />{" "}
                {r.label}
              </label>
            ))}
          </div>
        </div>

        <Editor
          height="400px"
          defaultLanguage="javascript"
          value={code}
          onChange={(v) => setCode(v || "")}
          options={{ minimap: { enabled: false }, fontSize: 14 }}
        />

        <div style={{ marginTop: 12 }}>
          <button onClick={handleReview} disabled={loading}>
            {loading ? "审查中..." : "开始审查"}
          </button>
        </div>

        <StepTimeline steps={steps} />

        {result && (
          <div style={{ marginTop: 20 }}>
            <h3>
              修复结果：
              {result.success
                ? "✅ 全部通过"
                : `⚠️ 仍有 ${result.finalErrors.length} 个问题`}
              （尝试 {result.attempts} 次）
            </h3>
            <ReactDiffViewer
              oldValue={result.originalCode}
              newValue={result.fixedCode}
              splitView={true}
              useDarkMode={false}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
