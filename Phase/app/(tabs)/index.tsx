import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { PHASE_COLORS, theme } from '@/constants/theme';
import {
  getActivePhase,
  getAllBiweeklyLogs,
  getDailyLogsForCurrentWeek,
  getLast8WeeklySummaries,
  type DailyLogRow,
  type LiftRating,
  type PhaseRow,
  type PhaseType,
  type WeeklySummaryRow,
} from '@/lib/queries';
import { analyzePhase } from '@/lib/rules';

function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map((x) => Number(x));
  return new Date(y, m - 1, d);
}

function isoTodayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetweenLocal(a: Date, b: Date): number {
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bb.getTime() - aa.getTime()) / (1000 * 60 * 60 * 24));
}

function currentWeekNumber(startDateISO: string, now: Date = new Date()): number {
  const start = parseISODateLocal(startDateISO);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startLocal = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const diffMs = today.getTime() - startLocal.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  return Math.floor(diffDays / 7) + 1;
}

function formatPhaseTypeLabel(type: PhaseType): string {
  if (type === 'bulk') return 'Bulk';
  if (type === 'cut') return 'Cut';
  return 'Maintain';
}

function formatPaceLabel(pace: PhaseRow['pace']): string {
  if (pace === 'mild') return 'Mild';
  if (pace === 'aggressive') return 'Aggressive';
  return 'Moderate';
}

function formatKg(n: number, decimals: 1 | 2 = 1): string {
  return n.toFixed(decimals);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function avg(nums: number[]) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function dominantLiftRatingFromWeekLogs(weekLogs: DailyLogRow[]): LiftRating | null {
  const counts: Record<LiftRating, number> = { improving: 0, holding: 0, declining: 0 };
  for (const row of weekLogs) {
    if (!row.lift_rating) continue;
    counts[row.lift_rating] += 1;
  }
  const entries = Object.entries(counts) as Array<[LiftRating, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  if (entries[0][1] === 0) return null;
  if (entries.length >= 2 && entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}

function formatLiftRating(r: LiftRating): string {
  if (r === 'improving') return 'Improving';
  if (r === 'declining') return 'Declining';
  return 'Holding';
}

function progressTowardGoal01(params: {
  startWeight: number;
  goalWeight: number;
  currentWeight: number;
}): number {
  const { startWeight, goalWeight, currentWeight } = params;
  const denom = goalWeight - startWeight;
  if (denom === 0) return 1;
  const p = (currentWeight - startWeight) / denom;
  // If the goal is lower than start (cut), denom is negative, so p still works.
  return clamp01(p);
}

function projectedEndDateISO(params: {
  now: Date;
  goalWeight: number;
  currentWeight: number;
  weeklyRate: number;
}): string | null {
  const { now, goalWeight, currentWeight, weeklyRate } = params;
  if (!Number.isFinite(weeklyRate) || weeklyRate === 0) return null;
  const remainingKg = goalWeight - currentWeight;
  const weeks = remainingKg / weeklyRate;
  if (!Number.isFinite(weeks)) return null;
  if (weeks <= 0) return isoTodayLocal(now);
  const days = Math.ceil(weeks * 7);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setDate(end.getDate() + days);
  return isoTodayLocal(end);
}

type WeeklyStatusTone = 'green' | 'amber' | 'red';

function buildWeeklyStatus(params: {
  lastSummariesForPhase: WeeklySummaryRow[];
  weeklyTargetRate: number;
}): { text: string; tone: WeeklyStatusTone } {
  const rows = params.lastSummariesForPhase
    .filter((r) => r.avg_weight != null)
    .slice(0, 3); // newest-first, we only need last 3 to compute last 2 deltas

  if (rows.length < 2) {
    return { text: 'Not enough data yet — keep logging daily.', tone: 'amber' };
  }

  const deltas: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i].avg_weight!;
    const b = rows[i + 1].avg_weight!;
    deltas.push(a - b); // change per week
  }

  const target = params.weeklyTargetRate;
  const lastDelta = deltas[0];
  const lastDeltaAbs = Math.abs(lastDelta);
  const targetAbs = Math.abs(target);

  const nearZero = (x: number) => Math.abs(x) < 0.05;
  const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

  if (deltas.length >= 2 && nearZero(deltas[0]) && nearZero(deltas[1])) {
    return { text: 'No change in 2 weeks — consider adding 100–150 kcal.', tone: 'red' };
  }

  if (target === 0) {
    if (nearZero(lastDelta)) return { text: 'Stable this week — right on track.', tone: 'green' };
    const dir = lastDelta > 0 ? 'Gaining' : 'Losing';
    return {
      text: `${dir} ${formatKg(Math.abs(lastDelta), 2)} kg/wk — aim for stable weight.`,
      tone: 'amber',
    };
  }

  // If moving opposite direction of target, that's action-needed.
  if (sign(lastDelta) !== sign(target)) {
    const dir = lastDelta > 0 ? 'Gaining' : 'Losing';
    return {
      text: `${dir} ${formatKg(lastDeltaAbs, 2)} kg/wk — action needed.`,
      tone: 'red',
    };
  }

  const diff = Math.abs(lastDeltaAbs - targetAbs);
  const onTrack = diff <= 0.08;
  const slightlyOff = diff <= 0.2;

  const dir = lastDelta > 0 ? 'Gaining' : lastDelta < 0 ? 'Losing' : 'No change';
  const rateText = lastDelta === 0 ? '0.00' : formatKg(lastDeltaAbs, 2);

  if (onTrack) {
    return { text: `${dir} ${rateText} kg/wk — right on track.`, tone: 'green' };
  }

  if (slightlyOff) {
    const advice =
      sign(target) === -1
        ? lastDeltaAbs > targetAbs
          ? 'slightly fast, add a refeed day.'
          : 'slightly slow, tighten weekends.'
        : lastDeltaAbs > targetAbs
          ? 'slightly fast, add a little food.'
          : 'slightly slow, add 100–150 kcal.';
    return { text: `${dir} ${rateText} kg/wk — ${advice}`, tone: 'amber' };
  }

  const advice =
    sign(target) === -1
      ? lastDeltaAbs > targetAbs
        ? 'too fast — increase calories.'
        : 'too slow — reduce calories slightly.'
      : lastDeltaAbs > targetAbs
        ? 'too fast — reduce calories slightly.'
        : 'too slow — increase calories.';
  return { text: `${dir} ${rateText} kg/wk — ${advice}`, tone: 'red' };
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];
  const router = useRouter();

  const [activePhase, setActivePhase] = useState<PhaseRow | null>(null);
  const [weekLogs, setWeekLogs] = useState<DailyLogRow[]>([]);
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummaryRow[]>([]);
  const [biweeklyLogs, setBiweeklyLogs] = useState<Array<{ date: string; waist_cm: number }>>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      (async () => {
        const now = new Date();
        const [ap, wl, ws, bl] = await Promise.all([
          getActivePhase(),
          getDailyLogsForCurrentWeek(now),
          getLast8WeeklySummaries(),
          getAllBiweeklyLogs(),
        ]);
        if (cancelled) return;
        setActivePhase(ap);
        setWeekLogs(wl);
        setWeeklySummaries(ws);
        setBiweeklyLogs(bl.map((x) => ({ date: x.date, waist_cm: x.waist_cm })));
        setLoading(false);
      })().catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const now = useMemo(() => new Date(), []);
  const todayISO = useMemo(() => isoTodayLocal(new Date()), []);

  const lastSummariesForPhase = useMemo(() => {
    if (!activePhase) return [];
    return weeklySummaries.filter((r) => r.phase_id === activePhase.id);
  }, [activePhase, weeklySummaries]);

  const thisWeekAvgWeight = useMemo(() => {
    const weights = weekLogs.map((r) => r.weight_kg).filter((x): x is number => x != null);
    return avg(weights);
  }, [weekLogs]);

  const lastWaist = useMemo(() => {
    if (biweeklyLogs.length === 0) return null;
    const last = biweeklyLogs[biweeklyLogs.length - 1];
    return last;
  }, [biweeklyLogs]);

  const daysSinceWaist = useMemo(() => {
    if (!lastWaist) return null;
    const d = parseISODateLocal(lastWaist.date);
    return Math.max(0, daysBetweenLocal(d, new Date()));
  }, [lastWaist]);

  const liftTrend = useMemo(() => dominantLiftRatingFromWeekLogs(weekLogs), [weekLogs]);

  const latestWeeklyAvg = useMemo(() => {
    const row = lastSummariesForPhase.find((r) => r.avg_weight != null) ?? null;
    return row?.avg_weight ?? null;
  }, [lastSummariesForPhase]);

  const currentWeightForProgress = useMemo(() => {
    if (thisWeekAvgWeight != null) return thisWeekAvgWeight;
    if (latestWeeklyAvg != null) return latestWeeklyAvg;
    return activePhase?.start_weight ?? null;
  }, [activePhase, latestWeeklyAvg, thisWeekAvgWeight]);

  const weekNumber = useMemo(() => {
    if (!activePhase) return null;
    return currentWeekNumber(activePhase.start_date);
  }, [activePhase]);

  const projectedEnd = useMemo(() => {
    if (!activePhase) return null;
    if (currentWeightForProgress == null) return null;
    return projectedEndDateISO({
      now: new Date(),
      goalWeight: activePhase.goal_weight,
      currentWeight: currentWeightForProgress,
      weeklyRate: activePhase.weekly_target_rate,
    });
  }, [activePhase, currentWeightForProgress]);

  const status = useMemo(() => {
    if (!activePhase) return null;
    return buildWeeklyStatus({
      lastSummariesForPhase,
      weeklyTargetRate: activePhase.weekly_target_rate,
    });
  }, [activePhase, lastSummariesForPhase]);

  const phaseBadge = useMemo(() => {
    if (!activePhase) return null;
    const label = formatPhaseTypeLabel(activePhase.type);
    const c = PHASE_COLORS[activePhase.type];
    return { label, bg: c.bg, border: c.border, text: c.text };
  }, [activePhase]);

  const statusBorderColor = useMemo(() => {
    if (!status) return t.colors.border;
    if (status.tone === 'green') return '#2ECC71';
    if (status.tone === 'amber') return '#F5A524';
    return '#FF4D4F';
  }, [status, t.colors.border]);

  const ruleResult = useMemo(() => {
    if (!activePhase) return null;
    const last3 = lastSummariesForPhase.slice(0, 3);
    return analyzePhase(last3, activePhase);
  }, [activePhase, lastSummariesForPhase]);

  const ruleBorderColor = useMemo(() => {
    if (!ruleResult) return t.colors.border;
    if (ruleResult.severity === 'ok') return '#2ECC71';
    if (ruleResult.severity === 'warn') return '#F5A524';
    return '#FF4D4F';
  }, [ruleResult, t.colors.border]);

  const todayWeight = useMemo(() => {
    const row = weekLogs.find((r) => r.date === todayISO) ?? null;
    return row?.weight_kg ?? null;
  }, [todayISO, weekLogs]);

  if (!activePhase) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 22,
          gap: 12,
        }}>
        <Text style={{ color: t.colors.text, fontSize: 42, fontWeight: '900', letterSpacing: 0.4 }}>
          Phase
        </Text>
        <Text style={{ color: t.colors.mutedText, fontSize: 14, fontWeight: '700' }}>
          set up your first phase to get started
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/settings')}
          style={({ pressed }) => ({
            marginTop: 8,
            borderRadius: 16,
            paddingVertical: 14,
            paddingHorizontal: 16,
            backgroundColor: pressed ? t.colors.surface : t.colors.tint,
            borderWidth: 1,
            borderColor: pressed ? t.colors.border : t.colors.tint,
            minWidth: 170,
            alignItems: 'center',
          })}>
          <Text style={{ color: t.colors.background, fontWeight: '900', fontSize: 15 }}>
            Set Up Phase
          </Text>
        </Pressable>

        {loading ? (
          <Text style={{ marginTop: 14, color: t.colors.mutedText, fontWeight: '700' }}>
            Loading…
          </Text>
        ) : null}
      </View>
    );
  }

  const paceLabel = formatPaceLabel(activePhase.pace);
  const typeLabel = formatPhaseTypeLabel(activePhase.type);
  const wk = weekNumber ?? 1;

  const progress01 =
    currentWeightForProgress == null
      ? 0
      : progressTowardGoal01({
          startWeight: activePhase.start_weight,
          goalWeight: activePhase.goal_weight,
          currentWeight: currentWeightForProgress,
        });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}>
      {/* 1) Phase status card */}
      <View
        style={{
          width: '100%',
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          gap: 12,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          {phaseBadge ? (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: phaseBadge.bg,
                borderWidth: 1,
                borderColor: phaseBadge.border,
              }}>
              <Text style={{ color: phaseBadge.text, fontWeight: '900', fontSize: 16 }}>
                {phaseBadge.label}
              </Text>
            </View>
          ) : null}

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.border,
            }}>
            <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>{paceLabel}</Text>
          </View>
        </View>

        <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
          Week {wk} of your {paceLabel} {typeLabel}
        </Text>

        <View style={{ gap: 6 }}>
          <View
            style={{
              height: 10,
              borderRadius: 999,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.border,
              overflow: 'hidden',
            }}>
            <View style={{ height: '100%', width: `${Math.round(progress01 * 100)}%`, backgroundColor: t.colors.tint }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>
              {activePhase.start_weight} → {activePhase.goal_weight} kg
            </Text>
            <Text style={{ color: t.colors.text, fontWeight: '800' }}>
              {currentWeightForProgress == null ? '—' : `${formatKg(currentWeightForProgress, 1)} kg`}
            </Text>
          </View>
        </View>

        <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>
          Projected end date:{' '}
          <Text style={{ color: t.colors.text, fontWeight: '800' }}>{projectedEnd ?? '—'}</Text>
        </Text>
      </View>

      {/* 2) This week's status */}
      {status ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 14,
            borderLeftWidth: 5,
            borderLeftColor: statusBorderColor,
          }}>
          <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>{status.text}</Text>
        </View>
      ) : null}

      {/* 2b) Decision rules */}
      {ruleResult ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 14,
            borderLeftWidth: 5,
            borderLeftColor: ruleBorderColor,
            gap: 6,
          }}>
          {ruleResult.status === 'on_track' ? (
            <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>
              You're on track — no changes needed
            </Text>
          ) : (
            <>
              <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
                {ruleResult.headline}
              </Text>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 13 }}>
                {ruleResult.action}
              </Text>
            </>
          )}
        </View>
      ) : null}

      {/* 3) Quick stats row */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 12,
            gap: 6,
          }}>
          <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>This week avg</Text>
          <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
            {thisWeekAvgWeight == null ? '—' : `${formatKg(thisWeekAvgWeight, 1)} kg`}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 12,
            gap: 6,
          }}>
          <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>Waist</Text>
          <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
            {lastWaist ? `${formatKg(lastWaist.waist_cm, 1)} cm` : '—'}
          </Text>
          <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
            {daysSinceWaist == null ? '—' : `${daysSinceWaist} days ago`}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 12,
            gap: 6,
          }}>
          <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>Lift trend</Text>
          <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
            {liftTrend ? formatLiftRating(liftTrend) : '—'}
          </Text>
        </View>
      </View>

      {/* 4) Today's log shortcut */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          marginTop: 2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>Today</Text>
          <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
            {todayWeight == null ? 'not logged yet' : `${formatKg(todayWeight, 1)} kg`}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/log')}
          style={({ pressed }) => ({
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 14,
            backgroundColor: pressed ? t.colors.surface : t.colors.tint,
            borderWidth: 1,
            borderColor: pressed ? t.colors.border : t.colors.tint,
          })}>
          <Text style={{ color: t.colors.background, fontWeight: '900' }}>Log Now</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
