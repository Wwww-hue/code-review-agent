import { useState } from "react";
import Editor from "@monaco-editor/react";
import { lintCode, type LintMessage } from "./api";

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

  return (
    <div style={{ padding: 20 }}>
      <h1>代码审查 Agent</h1>

      <Editor
        height="400px"
        defaultLanguage="javascript"
        value={code}
        onChange={(v) => setCode(v || "")}
        options={{ minimap: { enabled: false }, fontSize: 14 }}
      />

      <button onClick={handleLint} disabled={loading} style={{ marginTop: 12 }}>
        {loading ? "校验中..." : "运行 ESLint"}
      </button>

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
