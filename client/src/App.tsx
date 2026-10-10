import { useState } from "react";
import Editor from "@monaco-editor/react";

const DEFAULT_CODE = `var x = 1
console.log(x)
function foo() {
  return 1
}
`;

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1>代码审查 Agent</h1>
      <Editor
        height="400px"
        defaultLanguage="javascript"
        value={code}
        onChange={(v) => setCode(v || "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}

export default App;
