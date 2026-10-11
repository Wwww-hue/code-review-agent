/**
 * 后端唯一入口：一个 Express 服务。
 *
 * 为什么要后端？
 * ESLint / Prettier / Babel 在浏览器里打包很麻烦（Node 模块兼容问题），
 * 所以前端把代码 POST 过来，后端跑完把结果 JSON 返回去。
 *
 * 提供的接口：
 * - POST /lint         只检查，不改代码
 * - POST /fix          ESLint 自动修复
 * - POST /format-check Prettier 格式检查
 * - POST /deep-check   ESLint + AST + 复杂度
 * - GET  /health       探活
 */

import express from "express";
import cors from "cors"; // 允许前端跨域访问
import { Linter } from "eslint";
import prettier from "prettier"; // 第二个验证器：管格式
import * as parser from "@babel/parser"; // 把代码解析成 AST（抽象语法树）
import _traverse from "@babel/traverse"; // 遍历 AST 的节点

// CJS / ESM 互操作：有的包 default 导出，有的没有
const traverse = _traverse.default ?? _traverse;
const app = express();
app.use(cors()); // 放开跨域
app.use(express.json()); // 自动把请求体 JSON 解析成 req.body

// ESLint 的编程式用法：不读磁盘配置文件，直接在内存里验一段字符串
const linter = new Linter();

/** 用户没传规则时用的默认规则集 */
const DEFAULT_RULES = {
  "no-unused-vars": "error",
  "no-undef": "error",
  semi: ["error", "always"],
  "no-console": "warn",
};

/**
 * POST /lint
 * body: { code: string, rules?: object }
 * 返回: { messages: LintMessage[] }
 */
app.post("/lint", (req, res) => {
  const { code, rules } = req.body;

  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  // 前端传了规则就用前端的，否则用默认
  const finalRules =
    rules && Object.keys(rules).length > 0 ? rules : DEFAULT_RULES;

  try {
    // linter.verify = 「检查但不修改」
    const messages = linter.verify(code, {
      rules: finalRules,
      languageOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        // 告诉 ESLint：这些全局变量是合法存在的，不要报 no-undef
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

/**
 * POST /fix
 * body: { code, rules? }
 * 返回: { fixed: 修好的代码, changed: 是否真的改过 }
 *
 * 只能修「ESLint 支持自动修」的规则（如缺分号），复杂逻辑修不了。
 */
app.post("/fix", (req, res) => {
  const { code, rules } = req.body;
  if (typeof code !== "string") {
    return res.status(400).json({ error: "code must be a string" });
  }

  const finalRules =
    rules && Object.keys(rules).length > 0 ? rules : DEFAULT_RULES;

  try {
    // verifyAndFix = 检查 + 尽可能自动改
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

/**
 * POST /format-check
 * 用 Prettier 格式化一遍，再和原文比：一样 → 格式 OK；不一样 → 返回格式化后版本。
 */
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

/**
 * POST /deep-check
 * 三件套检查，比单纯 /lint 更「懂结构」：
 * 1) ESLint 规则
 * 2) AST：声明了但从未被引用的变量/函数
 * 3) 简易圈复杂度：if/for/while/... 和 && || 太多就提醒拆分
 */
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

  // ----- 1. ESLint -----
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

  // ----- 2. AST：找「声明了却没用」-----
  // AST = Abstract Syntax Tree，把代码拆成树状结构再分析
  try {
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx"],
    });

    const declared = new Set(); // 声明过的名字
    const used = new Set(); // 被引用过的名字

    traverse(ast, {
      // 遇到变量声明：记进 declared
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          declared.add(path.node.id.name);
        }
      },
      // 遇到函数声明：也记进 declared
      FunctionDeclaration(path) {
        if (path.node.id) declared.add(path.node.id.name);
      },
      // 遇到「引用」某个标识符：记进 used
      Identifier(path) {
        if (path.isReferencedIdentifier()) {
          used.add(path.node.name);
        }
      },
    });

    // 差集：声明了但从未被用 → 可能是死代码
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

  // ----- 3. 简易圈复杂度 -----
  // 正规复杂度有专门算法；这里用关键字计数做粗估，够教学演示
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
    // 忽略复杂度计算失败
  }

  res.json(result);
});

/** 探活：curl http://localhost:3001/health 看服务是否起来 */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(3001, () => console.log("Server on http://localhost:3001"));
