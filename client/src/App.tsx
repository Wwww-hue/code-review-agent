import { useState } from "react";
import Editor from "@monaco-editor/react";
import { runAgent, type AgentResult, type AgentStep } from "./agent";

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

      {/* 临时展示 steps 和 result，Phase 6、7 会替换成正式 UI */}
      {steps.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>执行过程</h3>
          <ul>
            {steps.map((s) => (
              <li key={s.index}>
                第 {s.index} 步 [{s.type}]：{s.errors.length} 个报错
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20 }}>
          <h3>结果</h3>
          <p>成功：{result.success ? "✅" : "❌"}</p>
          <p>尝试次数：{result.attempts}</p>
          <p>剩余报错：{result.finalErrors.length}</p>
        </div>
      )}
    </div>
  );
}

export default App;
