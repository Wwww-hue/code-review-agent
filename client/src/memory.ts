/**
 * Agent 的「长期记忆」：跨会话记住「某条规则 → 哪种修复方案更管用」。
 *
 * 存在浏览器 localStorage 里，刷新页面也不会丢。
 *
 * 举例：
 * {
 *   "no-unused-vars": {
 *     "加 void 操作符": { success: 3, fail: 1 },
 *     "删除未使用变量": { success: 1, fail: 4 }
 *   }
 * }
 * 下次再遇到 no-unused-vars，会提示模型优先试「加 void」。
 *
 * 注意：记的是「方案」不是「工具」。
 * 工具只有 auto_fix / fix_code 两个，记工具意义不大；
 * 方案才是策略（删变量？加 void？导出？）。
 */

const KEY = "agent-long-term-memory"; // localStorage 的键名

/** 某个方案的胜负场次 */
export interface StrategyRecord {
  success: number;
  fail: number;
}

/** 整体记忆：规则名 → 方案名 → 胜负 */
export interface LongTermMemory {
  [ruleId: string]: Record<string, StrategyRecord>;
}

/** 从浏览器读出记忆；读失败就当空白 */
export function loadMemory(): LongTermMemory {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 把记忆写回浏览器 */
export function saveMemory(mem: LongTermMemory) {
  localStorage.setItem(KEY, JSON.stringify(mem));
}

/**
 * 根据这一次修复的成败，更新记忆里对应方案的计数。
 * @param success true = 修好了；false = 失败或被回滚
 */
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

/**
 * ===== 置信度校准=====
 *
 * 直接算 success/(success+fail) 有问题：
 * 「赢 1 次、输 0 次」= 100%，但其实样本太少，不可信。
 *
 * 用 Beta 先验平滑：把公式改成 (success+1)/(success+fail+2)
 * - 1 胜 0 负 → 约 67%，不再夸张成 100%
 * - 样本越多，越接近真实比例
 *
 * MIN_SAMPLES：样本 < 2 的方案干脆不拿来指导决策。
 */
const ALPHA = 1;
const BETA = 1;
const MIN_SAMPLES = 2;

//平滑处理，避免样本太少导致成功率过高
function smoothedRate(success: number, fail: number): number {
  return (success + ALPHA) / (success + fail + ALPHA + BETA);
}

/**
 * 把记忆变成一段中文提示，注入到 Agent 的 system message 里。
 * 没有足够经验时返回空字符串（就不注入）。
 */
export function buildMemoryHint(
  mem: LongTermMemory,
  ruleIds: string[],
): string {
  const lines: string[] = [];
  for (const ruleId of ruleIds) {
    const strategies = mem[ruleId];
    if (!strategies) continue;

    // 过滤小样本 → 算可信成功率 → 从高到低排
    const entries = Object.entries(strategies)
      .filter(([, rec]) => rec.success + rec.fail >= MIN_SAMPLES) //过滤掉样本太少的方案
      .map(([strategy, rec]) => ({
        //计算每个方案的可信成功率
        strategy,
        rate: smoothedRate(rec.success, rec.fail),
        total: rec.success + rec.fail,
      }))
      .sort((a, b) => b.rate - a.rate); //按可信成功率从高到低排序

    if (entries.length === 0) continue;

    const best = entries[0];
    let line = `- ${ruleId}：优先"${best.strategy}"（可信成功率 ${Math.round(
      best.rate * 100,
    )}%，样本 ${best.total} 次）`;

    // 顺便提醒最差方案（成功率 < 50% 才提）
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
