const KEY = "agent-long-term-memory";

export interface StrategyRecord {
  success: number;
  fail: number;
}

export interface LongTermMemory {
  [ruleId: string]: Record<string, StrategyRecord>;
}

export function loadMemory(): LongTermMemory {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveMemory(mem: LongTermMemory) {
  localStorage.setItem(KEY, JSON.stringify(mem));
}

export function recordStrategies(
  mem: LongTermMemory,
  strategies: { ruleId: string; strategy: string }[],
  success: boolean,
): LongTermMemory {
  const next = { ...mem };
  for (const { ruleId, strategy } of strategies) {
    if (!next[ruleId]) next[ruleId] = {};
    if (!next[ruleId][strategy]) {
      next[ruleId][strategy] = { success: 0, fail: 0 };
    }
    if (success) {
      next[ruleId][strategy].success++;
    } else {
      next[ruleId][strategy].fail++;
    }
  }
  return next;
}

// ===== 置信度校准 =====
const ALPHA = 1;
const BETA = 1;
const MIN_SAMPLES = 2;

function smoothedRate(success: number, fail: number): number {
  return (success + ALPHA) / (success + fail + ALPHA + BETA);
}

export function buildMemoryHint(
  mem: LongTermMemory,
  ruleIds: string[],
): string {
  const lines: string[] = [];
  for (const ruleId of ruleIds) {
    const strategies = mem[ruleId];
    if (!strategies) continue;

    const entries = Object.entries(strategies)
      .filter(([, rec]) => rec.success + rec.fail >= MIN_SAMPLES)
      .map(([strategy, rec]) => ({
        strategy,
        rate: smoothedRate(rec.success, rec.fail),
        total: rec.success + rec.fail,
      }))
      .sort((a, b) => b.rate - a.rate);

    if (entries.length === 0) continue;

    const best = entries[0];
    let line = `- ${ruleId}：优先"${best.strategy}"（可信成功率 ${Math.round(
      best.rate * 100,
    )}%，样本 ${best.total} 次）`;

    if (entries.length > 1) {
      const worst = entries[entries.length - 1];
      if (worst.rate < 0.5 && worst.strategy !== best.strategy) {
        line += `，避免"${worst.strategy}"（可信成功率 ${Math.round(
          worst.rate * 100,
        )}%）`;
      }
    }

    lines.push(line);
  }

  return lines.length > 0
    ? `历史修复经验（供参考，已做小样本校准）：\n${lines.join("\n")}`
    : "";
}
