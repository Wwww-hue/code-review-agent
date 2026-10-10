import { lintCode, autoFix, checkFormat, type LintMessage } from "./api";
import { fixWithLLM, callLLMWithTools } from "./llm";
import { AGENT_TOOLS } from "./tools";
import {
  loadMemory,
  saveMemory,
  recordStrategies,
  buildMemoryHint,
} from "./memory";

export interface AgentStep {
  index: number;
  type: "lint" | "fix";
  tool?: string;
  errors: LintMessage[];
  code: string;
  rolledBack?: boolean;
}

export interface AgentResult {
  originalCode: string;
  fixedCode: string;
  steps: AgentStep[];
  attempts: number;
  finalErrors: LintMessage[];
  success: boolean;
  rollbackCount: number;
  durationMs: number;
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
- 如果系统提示"历史经验"，优先用高成功率的方案
- 禁止使用 eslint-disable 注释绕过报错
- 最多修复 2 次 LLM 修复，超过就 finish
- 你必须在 8 步内结束`;

export async function runAgent(
  originalCode: string,
  rules: Record<string, any>,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  // ===== 长期记忆 =====
  let memory = loadMemory();
  let lastStrategies: { ruleId: string; strategy: string }[] = [];
  const startTime = Date.now();

  const allRuleIds = Object.keys(memory);
  const memoryHint = buildMemoryHint(memory, allRuleIds);

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(memoryHint ? [{ role: "system", content: memoryHint }] : []),
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
  let lastTool = "none";

  const finish = (success: boolean, code: string, errors: LintMessage[]) => ({
    originalCode,
    fixedCode: code,
    steps,
    attempts: fixCount,
    finalErrors: success ? [] : errors,
    success,
    rollbackCount,
    durationMs: Date.now() - startTime,
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

        // ===== 回滚判断 =====
        if (errorCount >= lastErrorCount && lastErrorCount !== Infinity) {
          rollbackCount++;

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

          // ===== 记录上一次修复的方案：失败 =====
          if (lastStrategies.length > 0) {
            memory = recordStrategies(memory, lastStrategies, false);
            saveMemory(memory);
            lastStrategies = [];
          }

          toolResult = {
            errorCount,
            rolledBack: true,
            message: `你上一次用 ${lastTool} 修复后报错数从 ${lastErrorCount} 变成 ${errorCount}，没有进步。已回滚到 ${lastErrorCount} 个报错的版本。请换一种方案。`,
            restoredCode: lastCode,
          };

          finalCode = lastCode;
          finalErrors = errors;
        } else {
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

          // ===== 记录上一次修复的方案：成功 =====
          if (lastStrategies.length > 0) {
            const success = errorCount === 0;
            memory = recordStrategies(memory, lastStrategies, success);
            saveMemory(memory);
            lastStrategies = [];
          }

          lastCode = args.code;
          lastErrorCount = errorCount;

          if (errorCount < bestErrorCount) {
            bestErrorCount = errorCount;
            bestCode = args.code;
          }

          // ESLint 通过 → Prettier
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

          if (fixCount >= MAX_FIXES) {
            return finish(false, bestCode, errors);
          }

          toolResult = errors;
        }
      } else if (name === "auto_fix") {
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
          lastCode = args.code;
          lastTool = "fix_code";

          let parsedErrors: LintMessage[] = [];
          try {
            parsedErrors = JSON.parse(args.errors);
          } catch {
            parsedErrors = finalErrors;
          }

          // ===== 新返回结构：{ code, strategies } =====
          const result = await fixWithLLM(args.code, parsedErrors);
          toolResult = result.code;
          lastStrategies = result.strategies;

          const step: AgentStep = {
            index: steps.length,
            type: "fix",
            tool: "fix_code",
            errors: [],
            code: result.code,
          };
          steps.push(step);
          onStep?.(step);
          finalCode = result.code;
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

  return finish(bestErrorCount === 0, bestCode, finalErrors);
}
