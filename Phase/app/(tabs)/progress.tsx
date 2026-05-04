import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

import { useColorScheme } from '@/components/useColorScheme';
import { PHASE_COLORS, theme } from '@/constants/theme';
import {
  getActivePhase,
  getAllBiweeklyLogs,
  getAllPhases,
  getLast12WeeklySummaries,
  type BiweeklyLogRow,
  type LiftRating,
  type PhaseRow,
  type WeeklySummaryRow,
} from '@/lib/queries';

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatWeekLabel(iFromOldest: number) {
  return `W${iFromOldest + 1}`;
}

function formatShortDateLabel(iso: string): string {
  const d = parseISODateLocal(iso);
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
  } catch {
    return iso.slice(5);
  }
}

function weeksBetweenCeil(startISO: string, endISO: string): number {
  const a = parseISODateLocal(startISO);
  const b = parseISODateLocal(endISO);
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const days = Math.max(1, Math.round((bb.getTime() - aa.getTime()) / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.ceil(days / 7));
}

function liftDotColor(t: (typeof theme)['dark'], r: LiftRating | null) {
  if (r === 'improving') return '#2ECC71';
  if (r === 'holding') return '#F5A524';
  if (r === 'declining') return '#FF4D4F';
  return t.colors.border;
}

export default function ProgressScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  const [activePhase, setActivePhase] = useState<PhaseRow | null>(null);
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummaryRow[]>([]);
  const [biweeklyLogs, setBiweeklyLogs] = useState<BiweeklyLogRow[]>([]);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      (async () => {
        const [ap, ws, bl, ps] = await Promise.all([
          getActivePhase(),
          getLast12WeeklySummaries(),
          getAllBiweeklyLogs(),
          getAllPhases(),
        ]);
        if (cancelled) return;
        setActivePhase(ap);
        setWeeklySummaries(ws);
        setBiweeklyLogs(bl);
        setPhases(ps);
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

  const chartWidth = useMemo(() => {
    const w = Dimensions.get('window').width;
    return Math.max(280, w - 32);
  }, []);

  const chartConfig = useMemo(() => {
    return {
      backgroundGradientFrom: t.colors.card,
      backgroundGradientTo: t.colors.card,
      decimalPlaces: 1,
      color: (opacity = 1) => {
        // chart-kit wants a function; tint is our primary accent.
        return `rgba(143, 163, 255, ${opacity})`;
      },
      labelColor: (opacity = 1) => {
        const rgb = '231, 234, 240'; // close to theme text (#E7EAF0)
        return `rgba(${rgb}, ${opacity})`;
      },
      propsForDots: {
        r: '4',
        strokeWidth: '2',
        stroke: t.colors.card,
      },
      propsForBackgroundLines: {
        stroke: t.colors.border,
        strokeDasharray: '6 6',
      },
    } as const;
  }, [t.colors.border, t.colors.card]);

  const weightSeries = useMemo(() => {
    const rows = [...weeklySummaries]
      .filter((r) => r.avg_weight != null)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-12);

    const labels = rows.map((_, i) => formatWeekLabel(i));
    const data = rows.map((r) => Number(r.avg_weight));
    return { labels, data, count: data.length };
  }, [weeklySummaries]);

  const weightGoal = useMemo(() => {
    return activePhase?.goal_weight ?? null;
  }, [activePhase]);

  const weightRefLine = useMemo(() => {
    if (weightGoal == null) return null;
    if (weightSeries.count < 2) return null;
    const all = [...weightSeries.data, weightGoal].filter((x) => Number.isFinite(x));
    if (all.length < 2) return null;
    const min = Math.min(...all);
    const max = Math.max(...all);
    if (min === max) return null;

    // Approximate chart-kit drawing area (tuned to be stable across platforms).
    const height = 220;
    const padTop = 18;
    const padBottom = 38;
    const usable = height - padTop - padBottom;
    const y = padTop + ((max - weightGoal) / (max - min)) * usable;
    return { y: clamp(y, padTop, padTop + usable) };
  }, [weightGoal, weightSeries.count, weightSeries.data]);

  const waistSeries = useMemo(() => {
    const rows = [...biweeklyLogs].sort((a, b) => a.date.localeCompare(b.date));
    const labels = rows.map((r) => formatShortDateLabel(r.date));
    const data = rows.map((r) => r.waist_cm);
    return { labels, data, count: data.length };
  }, [biweeklyLogs]);

  const phasesForTimeline = useMemo(() => {
    const today = isoTodayLocal(new Date());
    const rows = [...phases].sort((a, b) => a.start_date.localeCompare(b.start_date));
    return rows.map((p) => {
      const end = p.end_date ?? today;
      const weeks = weeksBetweenCeil(p.start_date, end);
      const label = `${p.type} • ${weeks}w`;
      const color = PHASE_COLORS[p.type].primary;
      return { id: p.id, type: p.type, start: p.start_date, end, weeks, label, color };
    });
  }, [phases, t.colors.border]);

  const liftDots = useMemo(() => {
    const rows = [...weeklySummaries]
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-12);

    const dots: Array<{ key: string; rating: LiftRating | null }> = rows.map((r) => ({
      key: `${r.week_start}-${r.id}`,
      rating: r.dominant_lift_rating ?? null,
    }));

    // Pad left with "no data" so the row always shows 12 weeks.
    while (dots.length < 12) {
      dots.unshift({ key: `pad-${dots.length}`, rating: null });
    }
    return dots;
  }, [weeklySummaries]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}>
      {/* 1) Weight trend */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          gap: 10,
        }}>
        <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>Weight trend</Text>

        {weightSeries.count < 2 ? (
          <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>
            keep logging — your trend will appear here after 2 weeks.
          </Text>
        ) : (
          <View style={{ position: 'relative' }}>
            <LineChart
              width={chartWidth}
              height={220}
              data={{
                labels: weightSeries.labels,
                datasets: [{ data: weightSeries.data }],
              }}
              chartConfig={chartConfig}
              bezier
              withShadow={false}
              fromZero={false}
              style={{ borderRadius: 14 }}
            />

            {weightRefLine ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 18,
                  right: 18,
                  top: weightRefLine.y,
                  height: 0,
                  borderTopWidth: 1,
                  borderColor: t.colors.mutedText,
                  borderStyle: 'dashed',
                }}
              />
            ) : null}

            {weightGoal != null ? (
              <Text style={{ marginTop: 8, color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
                Goal: <Text style={{ color: t.colors.text, fontWeight: '800' }}>{weightGoal} kg</Text>
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* 2) Waist trend */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          gap: 10,
        }}>
        <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>Waist trend</Text>

        {waistSeries.count < 2 ? (
          <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>
            keep logging — your trend will appear here after 2 weeks.
          </Text>
        ) : (
          <LineChart
            width={chartWidth}
            height={220}
            data={{
              labels: waistSeries.labels,
              datasets: [{ data: waistSeries.data }],
            }}
            chartConfig={{ ...chartConfig, decimalPlaces: 0 }}
            withShadow={false}
            fromZero={false}
            style={{ borderRadius: 14 }}
          />
        )}
      </View>

      {/* 3) Phase timeline */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          gap: 10,
        }}>
        <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>Phase timeline</Text>

        {phasesForTimeline.length === 0 ? (
          <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>
            No phases yet — create one in Settings.
          </Text>
        ) : (
          <>
            <View
              style={{
                width: '100%',
                flexDirection: 'row',
                overflow: 'hidden',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: t.colors.surface,
              }}>
              {phasesForTimeline.map((p) => (
                <View
                  key={p.id}
                  style={{
                    flex: Math.max(1, p.weeks),
                    backgroundColor: p.color,
                    paddingVertical: 10,
                    paddingHorizontal: 10,
                    justifyContent: 'center',
                    borderRightWidth: 1,
                    borderRightColor: 'rgba(0,0,0,0.12)',
                  }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: t.colors.background,
                      fontWeight: '900',
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}>
                    {p.label}
                  </Text>
                </View>
              ))}
            </View>

            {activePhase ? (
              <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
                Active phase runs through today.
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* 4) Lift trend over time */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.card,
          borderRadius: 16,
          padding: 14,
          gap: 12,
        }}>
        <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 14 }}>Lift trend over time</Text>

        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {liftDots.map((d) => (
            <View
              key={d.key}
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                backgroundColor: liftDotColor(t, d.rating),
                borderWidth: 1,
                borderColor: t.colors.border,
              }}
            />
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: t.colors.mutedText, fontWeight: '800', fontSize: 12 }}>Legend</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {[
              { label: 'Improving', color: '#2ECC71' },
              { label: 'Holding', color: '#F5A524' },
              { label: 'Declining', color: '#FF4D4F' },
              { label: 'No data', color: t.colors.border },
            ].map((x) => (
              <View key={x.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: x.color,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                  }}
                />
                <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
                  {x.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {loading ? (
          <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>Loading…</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

