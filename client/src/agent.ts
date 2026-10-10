import { lintCode, type LintMessage } from "./api";
import { fixWithLLM, callLLMWithTools } from "./llm";
import { AGENT_TOOLS } from "./tools";

export interface AgentStep {
  index: number;
  type: "lint" | "fix";
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
const MAX_FIXES = 2; // 硬性修复上限

const SYSTEM_PROMPT = `你是一个代码审查 Agent。你的任务是检查代码的 ESLint 问题并修复。

你有以下工具：
- run_eslint：检查代码，返回报错
- fix_code：根据报错修复代码
- finish：审查完成时调用

严格按以下流程：
1. 调 run_eslint 检查代码
2. 看结果：
   - 如果报错数为 0 → 立即调 finish，success=true
   - 如果报错数 > 0 且修复次数 < 2 → 调 fix_code
   - 如果报错数 > 0 且修复次数 >= 2 → 立即调 finish，success=false
3. 修复后回到第 1 步
4. 禁止使用 eslint-disable 注释来绕过报错

关键规则：
- 只要 run_eslint 返回 0 个报错，你必须立即调 finish
- 修复次数达到 2 次后，无论结果如何都必须调 finish
- 你必须在 5 步内结束`;

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

  // 统一的结束返回
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

    // LLM 没调工具，兜底退出
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
          errors,
          code: args.code,
        };
        steps.push(step);
        onStep?.(step);
        finalCode = args.code;
        finalErrors = errors;

        // ===== 代码兜底 1：无报错，直接结束，不等 LLM 调 finish =====
        if (errors.length === 0) {
          return finish(true, args.code, []);
        }

        // ===== 代码兜底 2：已达修复上限仍有错，强制结束 =====
        if (fixCount >= MAX_FIXES) {
          return finish(false, args.code, errors);
        }
      } else if (name === "fix_code") {
        // ===== 代码兜底 3：已达修复上限，拒绝再修 =====
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

  // 循环上限兜底
  return finish(finalErrors.length === 0, finalCode, finalErrors);
}
