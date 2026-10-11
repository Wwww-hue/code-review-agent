/**
 * 把每次审查的「结果摘要」存进 localStorage，供侧边栏历史列表回看。
 *
 * 和 memory.ts 的区别：
 * - history：记「这一次审查整体结果」（成功吗、修了几次）
 * - memory：记「哪条规则用哪种方案更管用」（跨会话策略经验）
 */

import type { AgentResult } from "./agent";

const KEY = "code-review-history";
const MAX_ITEMS = 50; // 最多留 50 条，防止 localStorage 膨胀

/** 侧边栏里一条历史记录的样子 */
export interface HistoryItem {
  id: string;
  timestamp: number;
  originalCode: string;
  fixedCode: string;
  attempts: number;
  success: boolean;
  rollbackCount: number;
  durationMs: number;
}

/** 顶部统计：一次成功 / 重试成功 / 失败 */
export interface Stats {
  total: number;
  firstTrySuccess: number;
  retrySuccess: number;
  failed: number;
}

/** 读出全部历史 */
export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 审查结束后调用：把本次结果插到列表最前面。
 * @returns 更新后的完整列表（方便 UI 直接 setState）
 */
export function saveHistory(result: AgentResult): HistoryItem[] {
  const items = loadHistory();
  const item: HistoryItem = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    originalCode: result.originalCode,
    fixedCode: result.fixedCode,
    attempts: result.attempts,
    success: result.success,
    rollbackCount: result.rollbackCount,
    durationMs: result.durationMs,
  };
  // 新记录在前，超过上限就丢掉最旧的
  const next = [item, ...items].slice(0, MAX_ITEMS);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** 清空全部历史（当前 UI 没暴露按钮，但逻辑留着） */
export function clearHistory() {
  localStorage.removeItem(KEY);
}

/**
 * 根据历史列表算统计数字。
 * attempts === 1 且成功 → 一次成功；
 * attempts > 1 且成功 → 重试成功；
 * 否则失败。
 */
export function computeStats(items: HistoryItem[]): Stats {
  return items.reduce(
    (acc, item) => {
      acc.total++;
      if (item.success && item.attempts === 1) acc.firstTrySuccess++;
      else if (item.success && item.attempts > 1) acc.retrySuccess++;
      else if (!item.success) acc.failed++;
      return acc;
    },
    { total: 0, firstTrySuccess: 0, retrySuccess: 0, failed: 0 },
  );
}
