import { lintCode, autoFix, checkFormat, type LintMessage } from "./api";
import { fixWithLLM, callLLMWithTools } from "./llm";
import { AGENT_TOOLS } from "./tools";

export interface AgentStep {
  index: number;
  type: "lint" | "fix";
  tool?: string;
  errors: LintMessage[];
  code: string;
  rolledBack?: boolean; // ← 新增：这一步是否触发了回滚
}

export interface AgentResult {
  originalCode: string;
  fixedCode: string;
  steps: AgentStep[];
  attempts: number;
  finalErrors: LintMessage[];
  success: boolean;
  rollbackCount: number; // ← 新增：总共回滚了几次
}

const MAX_LOOPS = 10;
const MAX_FIXES = 2;

const SYSTEM_PROMPT = `你是一个代码审查 Agent。你的任务是检查代码的 ESLint 问题和格式。

你有以下工具：
- run_eslint：检查代码，返回 ESLint 报错
- auto_fix：ESLint 自动修复（机械问题优先用它，零成本）
- fix_code：LLM 手工修复（复杂逻辑问题用它，成本高）
- finish：审查完成时调用

工作流程：
1. 调 run_eslint 检查代码
2. 如果有报错：
   - 第一次修复先调 auto_fix
   - auto_fix 后仍有报错，调 fix_code
   - 修复后回到第 1 步
3. ESLint 无报错后，系统会自动做格式检查
4. 调 finish 结束

关键规则：
- 如果系统提示"回滚"，说明你上一次修复让报错变多了，必须换策略
- 禁止使用 eslint-disable 注释绕过报错
- 最多修复 2 次 LLM 修复，超过就 finish
- 你必须在 8 步内结束`;

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
  let rollbackCount = 0;

  // ===== 回滚状态 =====
  let bestCode = originalCode;
  let bestErrorCount = Infinity;
  let lastCode = originalCode;
  let lastErrorCount = Infinity;
  let lastTool = "none"; // 上一次用的修复工具，回滚时用于提示 LLM

  const finish = (success: boolean, code: string, errors: LintMessage[]) => ({
    originalCode,
    fixedCode: code,
    steps,
    attempts: fixCount,
    finalErrors: success ? [] : errors,
    success,
    rollbackCount,
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
        const errorCount = errors.length;

        // ===== 回滚判断：本次校验 vs 上一次修复前的校验 =====
        let rolledBack = false;
        if (errorCount >= lastErrorCount && lastErrorCount !== Infinity) {
          // 退步了：回滚到 lastCode
          rolledBack = true;
          rollbackCount++;

          // 记录回滚步骤（用当前代码，但标记 rolledBack）
          const rbStep: AgentStep = {
            index: steps.length,
            type: "lint",
            tool: "run_eslint",
            errors,
            code: args.code,
            rolledBack: true,
          };
          steps.push(rbStep);
          onStep?.(rbStep);

          // 反馈给 LLM：回滚 + 换策略
          toolResult = {
            errorCount,
            rolledBack: true,
            message: `你上一次用 ${lastTool} 修复后报错数从 ${lastErrorCount} 变成 ${errorCount}，没有进步。已回滚到 ${lastErrorCount} 个报错的版本。请换一种策略（如果上次用 auto_fix，这次用 fix_code；反之亦然）。`,
            restoredCode: lastCode,
          };

          finalCode = lastCode;
          finalErrors = errors;
          // 回滚后 lastErrorCount 保持原值，等待 LLM 重新决策
        } else {
          // 进步或首次：接受
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

          // 更新 last
          lastCode = args.code;
          lastErrorCount = errorCount;

          // 更新 best
          if (errorCount < bestErrorCount) {
            bestErrorCount = errorCount;
            bestCode = args.code;
          }

          // ===== ESLint 通过：自动跑 Prettier =====
          if (errorCount === 0) {
            const fmt = await checkFormat(args.code);
            const fmtStep: AgentStep = {
              index: steps.length,
              type: "lint",
              tool: "check_format",
              errors: [],
              code: args.code,
            };
            steps.push(fmtStep);
            onStep?.(fmtStep);

            return finish(
              true,
              fmt.isFormatted ? args.code : fmt.formatted,
              [],
            );
          }

          // 达修复上限
          if (fixCount >= MAX_FIXES) {
            return finish(false, bestCode, errors);
          }

          toolResult = errors;
        }
      } else if (name === "auto_fix") {
        // 记录修复前的快照
        lastCode = args.code;
        lastTool = "auto_fix";

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
          // 记录修复前的快照
          lastCode = args.code;
          lastTool = "fix_code";

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
        finalCode = args.code || bestCode;
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

  // 循环上限兜底：返回历史最优
  return finish(bestErrorCount === 0, bestCode, finalErrors);
}
