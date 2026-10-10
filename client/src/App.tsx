import { useState } from "react";
import Editor from "@monaco-editor/react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { runAgent, type AgentResult, type AgentStep } from "./agent";
import { StepTimeline } from "./StepTimeline";

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

  const handleReview = async () => {
    setLoading(true);
    setSteps([]);
    setResult(null);
    try {
      const r = await runAgent(code, (step) => {
        setSteps((prev) => [...prev, step]);
      });
      setResult(r);
    } catch (e) {
      alert("审查失败：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
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

      {/* Phase 7：时间线 */}
      <StepTimeline steps={steps} />

      {/* Phase 6：diff 展示 */}
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
    </div>
  );
}

export default App;
