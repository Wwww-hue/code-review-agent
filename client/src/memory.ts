const KEY = "agent-long-term-memory";

export interface StrategyRecord {
  success: number;
  fail: number;
}

// ruleId -> 方案描述 -> 成功/失败次数
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

// 记录一批方案的结果
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

// 生成给 LLM 的提示
export function buildMemoryHint(
  mem: LongTermMemory,
  ruleIds: string[],
): string {
  const lines: string[] = [];
  for (const ruleId of ruleIds) {
    const strategies = mem[ruleId];
    if (!strategies) continue;

    const entries = Object.entries(strategies)
      .filter(([, rec]) => rec.success + rec.fail >= 2) // 样本 >= 2
      .map(([strategy, rec]) => ({
        strategy,
        rate: rec.success / (rec.success + rec.fail),
        total: rec.success + rec.fail,
      }))
      .sort((a, b) => b.rate - a.rate);

    if (entries.length === 0) continue;

    const best = entries[0];
    const worst = entries[entries.length - 1];

    let line = `- ${ruleId}：优先"${best.strategy}"（成功率 ${Math.round(best.rate * 100)}%，${best.total} 次）`;
    if (worst.rate < 0.5 && worst.strategy !== best.strategy) {
      line += `，避免"${worst.strategy}"（成功率 ${Math.round(worst.rate * 100)}%）`;
    }
    lines.push(line);
  }

  return lines.length > 0
    ? `历史修复经验（供参考）：\n${lines.join("\n")}`
    : "";
}
