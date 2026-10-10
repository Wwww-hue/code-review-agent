import express from "express";
import cors from "cors";
import { Linter } from "eslint";
import prettier from "prettier"; //第二个验证器
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;
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

//prettier验证
app.post("/format-check", async (req, res) => {
  const { code } = req.body;

  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  try {
    const formatted = await prettier.format(code, { parser: "babel" });
    res.json({
      formatted,
      isFormatted: formatted.trim() === code.trim(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/deep-check", (req, res) => {
  const { code, rules } = req.body;

  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  const finalRules =
    rules && Object.keys(rules).length > 0 ? rules : DEFAULT_RULES;

  const result = {
    eslint: [],
    ast: [],
    complexity: [],
  };

  // 1. ESLint
  try {
    result.eslint = linter.verify(
      code,
      {
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
      },
      { filename: "code.js" },
    );
  } catch (e) {
    result.eslint = [
      {
        message: e.message,
        fatal: true,
        line: 0,
        column: 0,
        severity: 2,
        ruleId: null,
      },
    ];
  }

  // 2. AST 分析：找未使用的声明
  try {
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx"],
    });

    const declared = new Set();
    const used = new Set();

    traverse(ast, {
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          declared.add(path.node.id.name);
        }
      },
      FunctionDeclaration(path) {
        if (path.node.id) declared.add(path.node.id.name);
      },
      Identifier(path) {
        if (path.isReferencedIdentifier()) {
          used.add(path.node.name);
        }
      },
    });

    for (const name of declared) {
      if (!used.has(name)) {
        result.ast.push({
          type: "unused",
          name,
          message: `"${name}" 被声明但从未使用`,
        });
      }
    }
  } catch (e) {
    result.ast = [{ type: "parse-error", message: e.message }];
  }

  // 3. 复杂度：数控制流关键字
  try {
    const controlFlow = code.match(/\b(if|for|while|case|catch)\b/g) || [];
    const logical = code.match(/&&|\|\|/g) || [];
    const complexity = 1 + controlFlow.length + logical.length;

    if (complexity > 10) {
      result.complexity.push({
        level: complexity,
        message: `圈复杂度约 ${complexity}，超过阈值 10，建议拆分`,
      });
    }
  } catch (e) {
    // 忽略
  }

  res.json(result);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(3001, () => console.log("Server on http://localhost:3001"));
