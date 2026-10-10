import express from "express";
import cors from "cors";
import { Linter } from "eslint";

const app = express();
app.use(cors());
app.use(express.json());

const linter = new Linter();

// 默认规则集
const DEFAULT_RULES = {
  "no-unused-vars": "error",
  "no-undef": "error",
  semi: ["error", "always"],
  "no-console": "warn",
};

app.post("/lint", (req, res) => {
  const { code, rules } = req.body;

  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  // 合并规则：用户传的覆盖默认
  // server/index.js
  const finalRules =
    rules && Object.keys(rules).length > 0 ? rules : DEFAULT_RULES;

  try {
    const messages = linter.verify(code, {
      rules: finalRules,
      languageOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        globals: {
          console: "readonly",
          window: "readonly",
          document: "readonly",
        },
      },
    });

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/fix", (req, res) => {
  const { code, rules } = req.body;
  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  const finalRules =
    rules && Object.keys(rules).length > 0 ? rules : DEFAULT_RULES;

  try {
    const result = linter.verifyAndFix(code, {
      rules: finalRules,
      languageOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        globals: {
          console: "readonly",
          window: "readonly",
          document: "readonly",
        },
      },
    });
    res.json({ fixed: result.output, changed: result.fixed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(3001, () => console.log("Server on http://localhost:3001"));
