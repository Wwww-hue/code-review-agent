/**
 * 这里实现「Agent 主循环」：
 *   1. 把任务 + 工具菜单发给 LLM
 *   2. LLM 说「请调用某个工具」
 *   3. 我们真正执行工具，把结果塞回对话
 *   4. 再问 LLM：下一步干嘛？
 *   5. 重复，直到成功 / 失败 / 超过次数上限
 *
 * 和「直接让 AI 改代码」的区别：
 * - 模型只负责「决策」（调哪个工具）
 * - 真正的检查/修复由工具完成（ESLint、Prettier、再一次 LLM）
 * - 代码层还有硬性兜底：最多修 2 次、最多循环 10 轮、报错不降就回滚
 * - 模型不调工具、调未知工具、参数不合法时：退回明确错误，连续 3 次就停
 */

import {
  lintCode,
  autoFix,
  checkFormat,
  deepCheck,
  type LintMessage,
} from "./api";
import { fixWithLLM, callLLMWithTools } from "./llm";
import { AGENT_TOOLS } from "./tools";
import {
  loadMemory,
  saveMemory,
  recordStrategies,
  buildMemoryHint,
} from "./memory";

/** Agent 走的每一步（给时间线 UI 展示用） */
export interface AgentStep {
  index: number;
  type: "lint" | "fix"; // 这一步是检查还是修复
  tool?: string; // 具体工具名，如 run_eslint
  errors: LintMessage[];
  code: string; // 这一步结束后的代码快照
  rolledBack?: boolean; // 是否因「没进步」被回滚
}

/** 一次完整审查的最终结果 */
export interface AgentResult {
  originalCode: string;
  fixedCode: string;
  steps: AgentStep[];
  attempts: number; // LLM 修复次数（fix_code）
  finalErrors: LintMessage[];
  success: boolean;
  rollbackCount: number;
  durationMs: number;
}

// 硬性上限：不完全信任模型自己会停
const MAX_LOOPS = 10; // 最多和模型来回 10 轮
const MAX_FIXES = 2; // 最多调用 2 次昂贵的 fix_code
const MAX_CONSECUTIVE_ERRORS = 3; // 连续不调工具 / 调错工具 / 参数非法，超过就停

/** 拼成「可用工具：a, b, c」，出错时原样告诉模型 */
function availableToolNames(): string {
  return AGENT_TOOLS.map((t) => t.function.name).join(", ");
}

/**
 * 按 tools.ts 的 JSON Schema 校验这一次调用的参数。
 * 解析失败、缺必填、类型不对都不执行工具，把原因退回给模型。
 */
function validateToolArgs(
  name: string,
  raw: unknown,
): { ok: true; args: Record<string, any> } | { ok: false; error: string } {
  let args: any;

  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    args = {};
  } else if (typeof raw !== "string") {
    return {
      ok: false,
      error: `工具 "${name}" 的参数不是合法 JSON。请传入 JSON 对象后重试。`,
    };
  } else {
    try {
      args = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: `工具 "${name}" 的参数不是合法 JSON。请传入 JSON 对象后重试。`,
      };
    }
  }

  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return {
      ok: false,
      error: `工具 "${name}" 的参数必须是 JSON 对象。`,
    };
  }

  const tool = AGENT_TOOLS.find((t) => t.function.name === name);
  const schema = tool?.function.parameters as unknown as {
    required?: string[];
    properties?: Record<string, { type?: string }>;
  };
  const required = schema?.required ?? [];
  const properties = schema?.properties ?? {};
  const problems: string[] = [];

  for (const key of required) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      problems.push(`缺少必填参数 "${key}"`);
    }
  }

  for (const [key, spec] of Object.entries(properties)) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    const expected = spec.type;
    if (!expected) continue;
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== expected) {
      problems.push(`参数 "${key}" 应为 ${expected}，实际是 ${actual}`);
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      error: `工具 "${name}" 参数不合法：${problems.join("；")}。请按 schema 重新调用。`,
    };
  }

  return { ok: true, args };
}

/**
 * System Prompt = 给模型的说明书。
 * 模型看不见我们的源码，只能靠这段文字知道：
 * 有哪些工具、该怎么用、什么时候结束。
 */
const SYSTEM_PROMPT = `你是一个代码审查 Agent。你的任务是检查代码的 ESLint 问题、结构问题和格式。
  
  你有以下工具：
  - run_eslint：快速检查，只跑 ESLint。适合简单代码（<10 行）
  - deep_check：深度检查，跑 ESLint + AST 分析 + 复杂度检查。适合复杂代码（多个函数、嵌套逻辑），能发现死代码、未使用函数、高复杂度函数
  - auto_fix：ESLint 自动修复（机械问题优先用它，零成本）
  - fix_code：LLM 手工修复（复杂逻辑问题用它，成本高）
  - finish：审查完成时调用
  
  检查策略：
  - 代码短、结构简单 → 用 run_eslint
  - 代码长、有多个函数 → 用 deep_check
  - 修复后必须重新检查验证
   修复流程：
  1. 先做检查（run_eslint 或 deep_check）
  2. 如果有报错：
     - 第一次修复先调 auto_fix
     - auto_fix 后仍有报错，调 fix_code
     - 修复后回到第 1 步
  3. 检查通过后，系统会自动做格式检查
  4. 调 finish 结束
  
  关键规则：
  - 如果系统提示"回滚"，说明你上一次修复让报错变多了，必须换策略
  - 如果系统提示"历史经验"，优先用高成功率的方案
  - 禁止使用 eslint-disable 注释绕过报错
  - 最多修复 2 次 LLM 修复，超过就 finish
  - 你必须在 10 步内结束`;

/**
 * 启动一次完整的 Agent 审查。
 *
 * @param originalCode 用户贴进来的原始代码
 * @param rules        当前勾选的 ESLint 规则
 * @param onStep       每走完一步就回调一次（用来实时刷新 UI）
 */
export async function runAgent(
  originalCode: string,
  rules: Record<string, any>,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const startTime = Date.now();

  // ---------- 1. 加载长期记忆，拼成「历史经验」提示 ----------
  let memory = loadMemory();
  // 上一次 fix_code 用了哪些方案；等下次检查完再记成功/失败
  let lastStrategies: { ruleId: string; strategy: string }[] = [];

  const allRuleIds = Object.keys(memory);
  const memoryHint = buildMemoryHint(memory, allRuleIds);

  /**
   * messages = 多轮对话上下文。
   * role 含义：
   * - system: 系统设定 / 额外提示（用户看不到）
   * - user: 用户任务
   * - assistant: 模型回复（可能含 tool_calls）
   * - tool: 工具执行结果（喂给模型看）
   */
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
  let fixCount = 0; // 已用的 LLM 修复次数
  let loopCount = 0;
  let rollbackCount = 0;
  // 不调工具、未知工具、参数非法都算一次；中间一旦成功执行就清零
  let consecutiveErrors = 0;

  // ---------- 回滚用的「快照」：保证报错数单调不增 ----------
  let bestCode = originalCode; // 历史上报错最少的那版代码
  let bestErrorCount = Infinity;
  let lastCode = originalCode; // 上一次「有效」检查时的代码
  let lastErrorCount = Infinity;
  let lastTool = "none"; // 上一次修复用的工具名（回滚提示里会用到）

  /** 统一打包返回结果，避免每处写重复字段 */
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

  // ========== 主循环：问模型 → 执行工具 → 把结果塞回去 ==========
  while (loopCount < MAX_LOOPS) {
    loopCount++;

    // 把当前对话 + 工具菜单发给模型，等它决定下一步
    const response = await callLLMWithTools(messages, AGENT_TOOLS);
    const msg = response.choices[0].message;
    // 必须把模型的回复也记进历史，否则下一轮它「失忆」
    messages.push(msg);

    // 情况 1：模型不调工具。报错已清零才算真完成；否则提醒它继续
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      if (bestErrorCount === 0) {
        break;
      }

      const nudge =
        bestErrorCount === Infinity
          ? `任务尚未开始检查。请调用工具。可用工具：${availableToolNames()}`
          : `任务未完成，还有报错未修复。请继续调用工具。可用工具：${availableToolNames()}`;
      messages.push({ role: "system", content: nudge });

      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      continue;
    }

    // 情况 2：模型调工具。未知工具 / 参数不合法不执行，把原因退回去
    let hitErrorLimit = false;

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let toolResult: any; // 执行完要回传给模型的内容
      let args: any = {};

      const toolExists = AGENT_TOOLS.some((t) => t.function.name === name);
      if (!toolExists) {
        consecutiveErrors++;
        toolResult = {
          error: `未知工具 "${name}"。可用工具：${availableToolNames()}`,
        };
      } else {
        const validated = validateToolArgs(name, call.function.arguments);
        if (!validated.ok) {
          consecutiveErrors++;
          toolResult = { error: validated.error };
        } else {
          // 这次调用合法，连续错误清零，下面才真正执行
          consecutiveErrors = 0;
          args = validated.args;
        }
      }

      // ===== 检查类：run_eslint / deep_check =====
      if (
        toolResult === undefined &&
        (name === "run_eslint" || name === "deep_check")
      ) {
        let errors: LintMessage[];

        if (name === "run_eslint") {
          errors = await lintCode(args.code, rules);
        } else {
          // 深度检查结果里有三类问题，统一转成 LintMessage 方便后续处理
          const deep = await deepCheck(args.code, rules);
          errors = [
            ...deep.eslint,
            ...deep.ast.map((a) => ({
              line: 0,
              column: 0,
              severity: 1 as const,
              message: a.message,
              ruleId: `ast/${a.type}`,
            })),
            ...deep.complexity.map((c) => ({
              line: 0,
              column: 0,
              severity: 1 as const,
              message: c.message,
              ruleId: "complexity",
            })),
          ];
        }

        const errorCount = errors.length;

        // ----- 单调递减约束：报错没变少 → 回滚 -----
        // 说明上一次修复「原地踏步或更糟」，不能认这笔账
        if (errorCount >= lastErrorCount && lastErrorCount !== Infinity) {
          rollbackCount++;

          const rbStep: AgentStep = {
            index: steps.length,
            type: "lint",
            tool: name,
            errors,
            code: args.code,
            rolledBack: true,
          };
          steps.push(rbStep);
          onStep?.(rbStep); // 通知 UI 立刻刷新

          // 把刚才那波修复方案记为「失败」
          if (lastStrategies.length > 0) {
            memory = recordStrategies(memory, lastStrategies, false);
            saveMemory(memory);
            lastStrategies = [];
          }

          // 用自然语言告诉模型：你这个方案不行，换一种方案
          toolResult = {
            errorCount,
            rolledBack: true,
            message: `你上一次用 ${lastTool} 修复后报错数从 ${lastErrorCount} 变成 ${errorCount}，没有进步。已回滚到 ${lastErrorCount} 个报错的版本。请换一种方案。`,
            restoredCode: lastCode,
          };

          finalCode = lastCode;
          finalErrors = errors;
        } else {
          // ----- 正常路径：有进步或第一次检查，方案可行 -----
          const step: AgentStep = {
            index: steps.length,
            type: "lint",
            tool: name,
            errors,
            code: args.code,
          };
          steps.push(step);
          onStep?.(step);

          finalCode = args.code;
          finalErrors = errors;

          // 有待评估的方案 → 按规则逐个判断成败（不能用「整体报错是否清零」）
          // 例：修了 3 个规则只修好 2 个时，只把还在报错里的规则记失败
          if (lastStrategies.length > 0) {
            const remainingRuleIds = new Set(
              errors.map((e) => e.ruleId).filter(Boolean),
            );
            for (const { ruleId, strategy } of lastStrategies) {
              const stillFailing = remainingRuleIds.has(ruleId);
              memory = recordStrategies(
                memory,
                [{ ruleId, strategy }],
                !stillFailing, // 该规则已不在报错里 = 成功
              );
            }
            saveMemory(memory);
            lastStrategies = [];
          }

          // 更新「上一个有效快照」
          lastCode = args.code;
          lastErrorCount = errorCount;

          if (errorCount < bestErrorCount) {
            bestErrorCount = errorCount;
            bestCode = args.code;
          }

          // 报错清零 → 再跑 Prettier，两个验证器都过才算成功
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

            // 格式不对就直接用 Prettier 格式化后的版本返回
            return finish(
              true,
              fmt.isFormatted ? args.code : fmt.formatted,
              [],
            );
          }

          // 已经修不动了（LLM 修复次数用尽）→ 带着最好的版本收工
          if (fixCount >= MAX_FIXES) {
            return finish(false, bestCode, errors);
          }

          // 把报错列表原样回给模型，让它决定下一步修不修、怎么修
          toolResult = errors;
        }
      } else if (toolResult === undefined && name === "auto_fix") {
        // ===== 确定性修复：ESLint 自己能改的先改 =====
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
      } else if (toolResult === undefined && name === "fix_code") {
        // ===== 昂贵路径：再请一次 LLM 改代码 =====
        if (fixCount >= MAX_FIXES) {
          toolResult = { error: "已达到最大修复次数，请调用 finish 结束" };
        } else {
          fixCount++;
          lastCode = args.code;
          lastTool = "fix_code";

          // 模型传来的 errors 是 JSON 字符串，解析失败就用上次检查结果
          let parsedErrors: LintMessage[] = [];
          try {
            parsedErrors = JSON.parse(args.errors);
          } catch {
            parsedErrors = finalErrors;
          }

          const result = await fixWithLLM(args.code, parsedErrors);
          toolResult = result.code;
          // 先记下方案，等下次检查完再判定成败
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
      } else if (toolResult === undefined && name === "finish") {
        // ===== 模型主动宣布结束 =====
        finalCode = args.code || bestCode;
        finalSuccess = !!args.success;
        return finish(finalSuccess, finalCode, finalErrors);
      }

      /**
       * 关键一步：把工具结果写回 messages。
       * 没有这一步，模型不知道工具跑出了什么，下一轮就会瞎猜。
       * tool_call_id 必须和模型请求时的 call.id 对上。
       * 未知工具 / 参数错误也要回这条，否则下一轮接口会因缺少 tool 消息直接失败。
       */
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        hitErrorLimit = true;
        break;
      }
    }

    if (hitErrorLimit) break;
  }

  // 循环耗尽、或连续 3 次卡住 → 返回历史上最好的一版
  return finish(bestErrorCount === 0, bestCode, finalErrors);
}
