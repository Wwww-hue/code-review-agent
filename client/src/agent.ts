import { lintCode, type LintMessage } from "./api";
import { fixWithLLM } from "./llm";

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

const MAX_RETRIES = 1;

export async function runAgent(
  originalCode: string,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  let currentCode = originalCode;

  // 第 0 步：初始校验
  let errors = await lintCode(currentCode);
  const initialStep: AgentStep = {
    index: 0,
    type: "lint",
    errors,
    code: currentCode,
  };
  steps.push(initialStep);
  onStep?.(initialStep);

  if (errors.length === 0) {
    return {
      originalCode,
      fixedCode: currentCode,
      steps,
      attempts: 0,
      finalErrors: [],
      success: true,
    };
  }

  // 循环修复
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    // 调 LLM 修复
    const fixed = await fixWithLLM(currentCode, errors);
    currentCode = fixed;

    // 再校验
    errors = await lintCode(currentCode);
    const step: AgentStep = {
      index: steps.length,
      type: "fix",
      errors,
      code: currentCode,
    };
    steps.push(step);
    onStep?.(step);

    if (errors.length === 0) {
      return {
        originalCode,
        fixedCode: currentCode,
        steps,
        attempts: attempt,
        finalErrors: [],
        success: true,
      };
    }

    // 超过重试次数就退出
    if (attempt > MAX_RETRIES) {
      break;
    }
  }

  return {
    originalCode,
    fixedCode: currentCode,
    steps,
    attempts: MAX_RETRIES + 1,
    finalErrors: errors,
    success: false,
  };
}
