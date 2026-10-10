import type { AgentResult } from "./agent";

const KEY = "code-review-history";
const MAX_ITEMS = 20;

export interface Stats {
  total: number;
  firstTrySuccess: number; // 一次修复成功
  retrySuccess: number; // 重试后成功
  failed: number;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  originalCode: string;
  fixedCode: string;
  attempts: number;
  success: boolean;
}

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

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(result: AgentResult): HistoryItem[] {
  const items = loadHistory();
  const item: HistoryItem = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    originalCode: result.originalCode,
    fixedCode: result.fixedCode,
    attempts: result.attempts,
    success: result.success,
  };
  const next = [item, ...items].slice(0, MAX_ITEMS);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}
