import type { AgentResult } from "./agent";

const KEY = "code-review-history";
const MAX_ITEMS = 20;

export interface HistoryItem {
  id: string;
  timestamp: number;
  originalCode: string;
  fixedCode: string;
  attempts: number;
  success: boolean;
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
