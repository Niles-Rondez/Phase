import type { PhaseRow, WeeklySummaryRow } from '@/lib/queries';

export type RuleStatus =
  | 'on_track'
  | 'adjust_up'
  | 'adjust_down'
  | 'too_fast'
  | 'stalled'
  | 'no_data';

export type RuleSeverity = 'ok' | 'warn' | 'alert';

export type RuleResult = {
  status: RuleStatus;
  headline: string;
  action: string;
  severity: RuleSeverity;
};

export type WeeklySummary = Pick<WeeklySummaryRow, 'avg_weight' | 'week_start'>;
export type Phase = Pick<PhaseRow, 'type' | 'weekly_target_rate' | 'calorie_target'>;

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function deltasFromNewestFirst(weights: number[]): number[] {
  // weights: newest-first, 2+ values
  const deltas: number[] = [];
  for (let i = 0; i + 1 < weights.length; i++) {
    deltas.push(weights[i] - weights[i + 1]); // change per week
  }
  return deltas;
}

export function analyzePhase(summaries: WeeklySummary[], phase: Phase): RuleResult {
  const weightsNewestFirst = summaries
    .map((s) => s.avg_weight)
    .filter((x): x is number => x != null)
    .slice(0, 3);

  if (weightsNewestFirst.length < 2) {
    return {
      status: 'no_data',
      headline: 'Not enough data yet. Keep logging daily weights.',
      action: 'Log daily weights for at least 2 weeks, then check back.',
      severity: 'warn',
    };
  }

  const deltas = deltasFromNewestFirst(weightsNewestFirst);
  const avgWeeklyChange2w =
    deltas.length >= 2 ? (deltas[0] + deltas[1]) / 2 : (avg(deltas) ?? 0);

  const target = phase.weekly_target_rate;
  const targetAbs = Math.abs(target);
  const avgAbs = Math.abs(avgWeeklyChange2w);

  const stalledThresholdAbs = 0.3 * targetAbs;
  const halfTargetAbs = 0.5 * targetAbs;

  // RULES (first match wins)

  // Maintain phase special-case
  if (phase.type === 'maintain') {
    // Only flag if drifting consistently up/down (>0.2 kg/wk avg) over 2 weeks.
    if (deltas.length >= 2 && Math.abs(avgWeeklyChange2w) > 0.2) {
      const driftingUp = avgWeeklyChange2w > 0;
      return {
        status: driftingUp ? 'adjust_down' : 'adjust_up',
        headline: driftingUp
          ? "You're drifting up in maintenance."
          : "You're drifting down in maintenance.",
        action: driftingUp
          ? 'Trim 100–150 kcal/day (or reduce snacks) and keep steps consistent for 1–2 weeks.'
          : 'Add 100–150 kcal/day (or a small carb portion) and keep steps consistent for 1–2 weeks.',
        severity: 'warn',
      };
    }

    return {
      status: 'on_track',
      headline: "You're on track — no changes needed",
      action: '',
      severity: 'ok',
    };
  }

  // stalled (bulk or cut)
  if (avgAbs < stalledThresholdAbs) {
    return {
      status: 'stalled',
      headline: "Scale hasn't moved in 2 weeks.",
      action:
        phase.type === 'bulk'
          ? 'Add 100–150 kcal/day for 7–10 days, then reassess.'
          : 'Reduce 100 kcal/day or add 1500 steps/day for 7–10 days, then reassess.',
      severity: 'alert',
    };
  }

  // too_fast (bulk)
  if (phase.type === 'bulk' && avgWeeklyChange2w > 0.45) {
    return {
      status: 'too_fast',
      headline: 'Gaining faster than target.',
      action: 'Reduce calories by 100–150 kcal/day for the next week.',
      severity: 'alert',
    };
  }

  // too_fast (cut)
  if (phase.type === 'cut' && avgWeeklyChange2w < -0.85) {
    return {
      status: 'too_fast',
      headline: 'Losing too fast.',
      action: 'Add 150–200 kcal/day or take a refeed day this week, then reassess.',
      severity: 'alert',
    };
  }

  // adjust_up (bulk only): avg weekly gain < 50% of target rate for 2+ weeks
  if (phase.type === 'bulk') {
    const gainingSlow =
      deltas.length >= 2 && avgWeeklyChange2w > 0 && avgWeeklyChange2w < halfTargetAbs;
    if (gainingSlow) {
      return {
        status: 'adjust_up',
        headline: 'Gaining slower than target.',
        action: 'Add 100–150 kcal/day for 7–10 days, then reassess.',
        severity: 'warn',
      };
    }
  }

  // adjust_down (cut only): avg weekly loss < 50% of target rate for 2+ weeks
  if (phase.type === 'cut') {
    const losingSlow =
      deltas.length >= 2 && avgWeeklyChange2w < 0 && Math.abs(avgWeeklyChange2w) < halfTargetAbs;
    if (losingSlow) {
      return {
        status: 'adjust_down',
        headline: 'Losing slower than target.',
        action: 'Reduce 100 kcal/day or add 1500 steps/day for 7–10 days, then reassess.',
        severity: 'warn',
      };
    }
  }

  return {
    status: 'on_track',
    headline: "You're on track — no changes needed",
    action: '',
    severity: 'ok',
  };
}

