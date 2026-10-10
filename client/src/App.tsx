import { useState } from "react";
import Editor from "@monaco-editor/react";
import { lintCode, type LintMessage } from "./api";
import { fixWithLLM } from "./llm";

const DEFAULT_CODE = `var x = 1
console.log(x)
function foo() {
  return 1
}
`;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [errors, setErrors] = useState<LintMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Phase 3：调 ESLint
  const handleLint = async () => {
    setLoading(true);
    try {
      const msgs = await lintCode(code);
      setErrors(msgs);
    } catch (e) {
      alert("校验失败：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Phase 4 临时测试：调 LLM 修复
  const handleFixTest = async () => {
    try {
      const msgs = await lintCode(code);
      console.log("ESLint 报错：", msgs);
      const fixed = await fixWithLLM(code, msgs);
      console.log("修复后：", fixed);
      alert("修复结果已打印到控制台，按 F12 查看");
    } catch (e) {
      alert("修复失败：" + (e as Error).message);
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

      <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
        <button onClick={handleLint} disabled={loading}>
          {loading ? "校验中..." : "运行 ESLint"}
        </button>
        <button onClick={handleFixTest} disabled={loading}>
          测试 LLM 修复
        </button>
      </div>

      {errors.length > 0 && (
        <ul style={{ marginTop: 12 }}>
          {errors.map((e, i) => (
            <li key={i}>
              第 {e.line} 行：{e.message}（{e.ruleId}）
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
