import { lintCode, autoFix, type LintMessage } from "./api";
import { fixWithLLM, callLLMWithTools } from "./llm";
import { AGENT_TOOLS } from "./tools";

export interface AgentStep {
  index: number;
  type: "lint" | "fix";
  tool?: string;
  errors: LintMessage[];
  code: string;
}

export interface AgentResult {
  originalCode: string;
  fixedCode: string;
  steps: AgentStep[];
  attempts: number;
  finalErrors: LintMessage[];
  success: boolean;
}

const MAX_LOOPS = 8;
const MAX_FIXES = 2;

const SYSTEM_PROMPT = `你是一个代码审查 Agent。你的任务是检查代码的 ESLint 问题并修复。

你有以下工具：
- run_eslint：检查代码，返回报错
- auto_fix：ESLint 自动修复（机械问题优先用它，零成本）
- fix_code：LLM 手工修复（复杂逻辑问题用它，成本高）
- finish：审查完成时调用

修复策略：
- 机械问题（缺分号、引号、缩进）优先调 auto_fix
- auto_fix 没解决或问题涉及逻辑，再调 fix_code
- 每次修复后必须用 run_eslint 验证

严格按以下流程：
1. 调 run_eslint 检查代码
2. 看结果：
   - 报错数为 0 → 立即调 finish，success=true
   - 报错数 > 0 且是第一次修复 → 必须调 auto_fix
   - auto_fix 后仍有报错 → 调 fix_code
   - 修复次数 >= 2 → 立即调 finish，success=false
3. 修复后回到第 1 步
4. 禁止使用 eslint-disable 注释来绕过报错

关键规则：
- 只要 run_eslint 返回 0 个报错，你必须立即调 finish
- 修复次数达到 2 次后，无论结果如何都必须调 finish
- 你必须在 6 步内结束`;

export async function runAgent(
  originalCode: string,
  rules: Record<string, any>,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `请审查以下代码：\n\`\`\`javascript\n${originalCode}\n\`\`\``,
    },
  ];

  const steps: AgentStep[] = [];
  let finalCode = originalCode;
  let finalSuccess = false;
  let finalErrors: LintMessage[] = [];
  let fixCount = 0;
  let loopCount = 0;

  const finish = (success: boolean, code: string, errors: LintMessage[]) => ({
    originalCode,
    fixedCode: code,
    steps,
    attempts: fixCount,
    finalErrors: success ? [] : errors,
    success,
  });

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const response = await callLLMWithTools(messages, AGENT_TOOLS);
    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      break;
    }

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = {};
      }

      let toolResult: any;

      if (name === "run_eslint") {
        const errors = await lintCode(args.code, rules);
        toolResult = errors;
        const step: AgentStep = {
          index: steps.length,
          type: "lint",
          tool: "run_eslint",
          errors,
          code: args.code,
        };
        steps.push(step);
        onStep?.(step);
        finalCode = args.code;
        finalErrors = errors;

        if (errors.length === 0) {
          return finish(true, args.code, []);
        }

        if (fixCount >= MAX_FIXES) {
          return finish(false, args.code, errors);
        }
      } else if (name === "auto_fix") {
        const { fixed } = await autoFix(args.code, rules);
        toolResult = fixed;
        const step: AgentStep = {
          index: steps.length,
          type: "fix",
          tool: "auto_fix",
          errors: [],
          code: fixed,
        };
        steps.push(step);
        onStep?.(step);
        finalCode = fixed;
      } else if (name === "fix_code") {
        if (fixCount >= MAX_FIXES) {
          toolResult = { error: "已达到最大修复次数，请调用 finish 结束" };
        } else {
          fixCount++;
          let parsedErrors: LintMessage[] = [];
          try {
            parsedErrors = JSON.parse(args.errors);
          } catch {
            parsedErrors = finalErrors;
          }
          const fixed = await fixWithLLM(args.code, parsedErrors);
          toolResult = fixed;
          const step: AgentStep = {
            index: steps.length,
            type: "fix",
            tool: "fix_code",
            errors: [],
            code: fixed,
          };
          steps.push(step);
          onStep?.(step);
          finalCode = fixed;
        }
      } else if (name === "finish") {
        finalCode = args.code || finalCode;
        finalSuccess = !!args.success;
        return finish(finalSuccess, finalCode, finalErrors);
      } else {
        toolResult = { error: `未知工具: ${name}` };
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return finish(finalErrors.length === 0, finalCode, finalErrors);
}
