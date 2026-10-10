import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { runAgent, type AgentResult, type AgentStep } from "./agent";
import { StepTimeline } from "./StepTimeline";
import { ConvergenceChart } from "./ConvergenceChart";
import { CostDashboard } from "./CostDashboard";
import {
  loadHistory,
  saveHistory,
  computeStats,
  type HistoryItem,
} from "./history";
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

const HISTORY_PAGE_SIZE = 10;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rulePrefs, setRulePrefs] = useState<Record<string, boolean>>({});
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    setHistory(loadHistory());
    setRulePrefs(loadRulePrefs());
  }, []);

  const stats = computeStats(history);
  const totalPages = Math.ceil(history.length / HISTORY_PAGE_SIZE);
  const pagedHistory = history.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE,
  );

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
      setHistoryPage(1);
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
      rollbackCount: item.rollbackCount ?? 0,
      durationMs: item.durationMs ?? 0,
    });
    setSteps([]);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
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

        <div style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
          <div>共 {stats.total} 次审查</div>
          <div>一次成功：{stats.firstTrySuccess}</div>
          <div>重试成功：{stats.retrySuccess}</div>
          <div>失败：{stats.failed}</div>
        </div>

        {history.length === 0 && (
          <p style={{ color: "#999", fontSize: 13 }}>暂无记录</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {pagedHistory.map((item) => (
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

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              fontSize: 12,
            }}
          >
            <button
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              disabled={historyPage === 1}
              style={{ fontSize: 12, padding: "2px 8px" }}
            >
              上一页
            </button>
            <span style={{ color: "#999" }}>
              {historyPage} / {totalPages}
            </span>
            <button
              onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
              disabled={historyPage === totalPages}
              style={{ fontSize: 12, padding: "2px 8px" }}
            >
              下一页
            </button>
          </div>
        )}
      </aside>

      <main style={{ flex: 1, padding: 20, fontFamily: "system-ui" }}>
        <h1>代码审查 Agent</h1>

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

        <ConvergenceChart steps={steps} hasResult={!!result} />
        <CostDashboard result={result} hasSteps={steps.length > 0} />
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

            <button
              onClick={() => {
                navigator.clipboard.writeText(result.fixedCode);
                alert("已复制修复后代码");
              }}
              style={{ marginTop: 8 }}
            >
              📋 复制
            </button>

            <div style={{ marginTop: 12 }}>
              <ReactDiffViewer
                oldValue={result.originalCode}
                newValue={result.fixedCode}
                splitView={true}
                useDarkMode={false}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
