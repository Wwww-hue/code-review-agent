import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { runAgent, type AgentResult, type AgentStep } from "./agent";
import { StepTimeline } from "./StepTimeline";
import { loadHistory, saveHistory, type HistoryItem } from "./history";

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

  // 初始化时从 localStorage 读历史
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const handleReview = async () => {
    setLoading(true);
    setSteps([]);
    setResult(null);
    try {
      const r = await runAgent(code, (step) => {
        setSteps((prev) => [...prev, step]);
      });
      setResult(r);
      // 审查成功后写历史
      setHistory(saveHistory(r));
    } catch (e) {
      alert("审查失败：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 点击历史项，回填代码和结果
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
      {/* 侧边栏：历史记录 */}
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
