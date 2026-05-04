import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { theme } from '@/constants/theme';
import {
  type CalorieRating,
  type DailyLogRow,
  type ISODateString,
  type LiftRating,
  getDailyLogsForCurrentWeek,
  insertDailyLog,
} from '@/lib/queries';

type Tri = 'yes' | 'no' | 'skip';

function toISODateLocal(d: Date): ISODateString {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeekMondayLocal(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 (Sun) ... 6 (Sat)
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function Pill(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: props.selected ? t.colors.tint : t.colors.surface,
          borderColor: props.selected ? t.colors.tint : t.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <Text
        style={[
          styles.pillText,
          { color: props.selected ? t.colors.background : t.colors.text },
        ]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function Badge(props: { text: string }) {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
      ]}>
      <Text style={[styles.badgeText, { color: t.colors.mutedText }]}>
        {props.text}
      </Text>
    </View>
  );
}

export default function LogScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  const [now, setNow] = useState(() => new Date());
  const todayISO = useMemo(() => toISODateLocal(now), [now]);
  const isPast6am = useMemo(() => now.getHours() >= 6, [now]);

  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, [])
  );

  const title = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(now);
    } catch {
      return todayISO;
    }
  }, [now, todayISO]);

  const [weekLogs, setWeekLogs] = useState<DailyLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveMsgTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [weightText, setWeightText] = useState('');

  const [didLift, setDidLift] = useState<Tri>('skip');
  const [liftRating, setLiftRating] = useState<LiftRating | null>(null);
  const [calorieRating, setCalorieRating] = useState<CalorieRating | null>(
    null
  );

  const weekStart = useMemo(() => startOfWeekMondayLocal(now), [now]);
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return { date: d, iso: toISODateLocal(d) as ISODateString };
    });
  }, [weekStart]);

  const weekLogByDate = useMemo(() => {
    const m = new Map<string, DailyLogRow>();
    for (const row of weekLogs) m.set(row.date, row);
    return m;
  }, [weekLogs]);

  const todayRow = useMemo(() => weekLogByDate.get(todayISO) ?? null, [weekLogByDate, todayISO]);
  const alreadyLoggedToday = Boolean(todayRow?.weight_kg != null);
  const [showLogReminderBanner, setShowLogReminderBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getDailyLogsForCurrentWeek(now);
        if (cancelled) return;
        setWeekLogs(rows);

        const today = rows.find((r) => r.date === todayISO) ?? null;
        if (today?.weight_kg != null) setWeightText(String(today.weight_kg));

        if (today?.did_lift === 1) setDidLift('yes');
        else if (today?.did_lift === 0) setDidLift('no');
        else setDidLift('skip');

        setLiftRating(today?.lift_rating ?? null);
        setCalorieRating(today?.calorie_rating ?? null);

        const hasTodayWeight = Boolean(today?.weight_kg != null);
        setShowLogReminderBanner(isPast6am && !hasTodayWeight);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPast6am, now, todayISO]);

  useEffect(() => {
    if (didLift !== 'yes') setLiftRating(null);
  }, [didLift]);

  useEffect(() => {
    return () => {
      if (saveMsgTimeout.current) clearTimeout(saveMsgTimeout.current);
    };
  }, []);

  const parsedWeight = useMemo(() => {
    const s = weightText.trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return n;
  }, [weightText]);

  const canSave = parsedWeight != null && !saving;

  async function refreshWeek() {
    const rows = await getDailyLogsForCurrentWeek(now);
    setWeekLogs(rows);
  }

  async function onSave() {
    if (!parsedWeight) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const did_lift: 0 | 1 | null =
        didLift === 'yes' ? 1 : didLift === 'no' ? 0 : null;

      await insertDailyLog({
        date: todayISO,
        weight_kg: parsedWeight,
        did_lift,
        lift_rating: did_lift === 1 ? liftRating : null,
        calorie_rating: calorieRating,
      });

      await refreshWeek();
      setShowLogReminderBanner(false);

      setSaveMsg('Logged ✓');
      if (saveMsgTimeout.current) clearTimeout(saveMsgTimeout.current);
      saveMsgTimeout.current = setTimeout(() => setSaveMsg(null), 1500);
    } finally {
      setSaving(false);
    }
  }

  const [dotLayouts, setDotLayouts] = useState<
    Array<{ x: number; width: number } | null>
  >(Array.from({ length: 7 }, () => null));
  const [tooltip, setTooltip] = useState<{
    index: number;
    text: string;
  } | null>(null);
  const [tooltipWidth, setTooltipWidth] = useState(0);
  const [weekAreaWidth, setWeekAreaWidth] = useState(0);

  const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const tooltipLeft = useMemo(() => {
    if (!tooltip) return 0;
    const layout = dotLayouts[tooltip.index];
    if (!layout) return 0;
    const centerX = layout.x + layout.width / 2;
    const maxLeft = Math.max(0, weekAreaWidth - tooltipWidth);
    return clamp(centerX - tooltipWidth / 2, 0, maxLeft);
  }, [dotLayouts, tooltip, tooltipWidth, weekAreaWidth]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {showLogReminderBanner ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowLogReminderBanner(false)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: pressed ? t.colors.surface : t.colors.card,
              borderRadius: 14,
              paddingVertical: 10,
              paddingHorizontal: 12,
              marginBottom: 12,
            })}>
            <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>
              don&apos;t forget to log today&apos;s weight
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: t.colors.text }]}>{title}</Text>
          {alreadyLoggedToday ? <Badge text="already logged today — editing" /> : null}
        </View>

        <View style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.border }]}>
          <Text style={[styles.sectionLabel, { color: t.colors.text }]}>
            Weight <Text style={{ color: t.colors.mutedText }}>(required)</Text>
          </Text>
          <TextInput
            value={weightText}
            onChangeText={setWeightText}
            keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
            placeholder="kg"
            placeholderTextColor={t.colors.mutedText}
            style={[
              styles.weightInput,
              {
                color: t.colors.text,
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          />
          <Text style={[styles.hint, { color: t.colors.mutedText }]}>
            morning, fasted
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.border }]}>
          <Text style={[styles.sectionLabel, { color: t.colors.text }]}>
            Lift session <Text style={{ color: t.colors.mutedText }}>(optional)</Text>
          </Text>

          <Text style={[styles.prompt, { color: t.colors.mutedText }]}>
            Did you lift today?
          </Text>
          <View style={styles.pillRow}>
            <Pill label="Yes" selected={didLift === 'yes'} onPress={() => setDidLift('yes')} />
            <Pill label="No" selected={didLift === 'no'} onPress={() => setDidLift('no')} />
            <Pill label="Skip" selected={didLift === 'skip'} onPress={() => setDidLift('skip')} />
          </View>

          {didLift === 'yes' ? (
            <>
              <Text style={[styles.prompt, { color: t.colors.mutedText, marginTop: 12 }]}>
                How did it feel?
              </Text>
              <View style={styles.pillRow}>
                <Pill
                  label="Improving"
                  selected={liftRating === 'improving'}
                  onPress={() =>
                    setLiftRating((prev) => (prev === 'improving' ? null : 'improving'))
                  }
                />
                <Pill
                  label="Holding"
                  selected={liftRating === 'holding'}
                  onPress={() =>
                    setLiftRating((prev) => (prev === 'holding' ? null : 'holding'))
                  }
                />
                <Pill
                  label="Declining"
                  selected={liftRating === 'declining'}
                  onPress={() =>
                    setLiftRating((prev) => (prev === 'declining' ? null : 'declining'))
                  }
                />
              </View>
            </>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.border }]}>
          <Text style={[styles.sectionLabel, { color: t.colors.text }]}>
            Calories <Text style={{ color: t.colors.mutedText }}>(optional)</Text>
          </Text>
          <Text style={[styles.prompt, { color: t.colors.text }]}>
            Calories this week, roughly?
          </Text>
          <Text style={[styles.subtext, { color: t.colors.mutedText }]}>
            compared to your target
          </Text>
          <View style={styles.pillRow}>
            <Pill
              label="Under"
              selected={calorieRating === 'under'}
              onPress={() =>
                setCalorieRating((prev) => (prev === 'under' ? null : 'under'))
              }
            />
            <Pill
              label="On Target"
              selected={calorieRating === 'on'}
              onPress={() =>
                setCalorieRating((prev) => (prev === 'on' ? null : 'on'))
              }
            />
            <Pill
              label="Over"
              selected={calorieRating === 'over'}
              onPress={() =>
                setCalorieRating((prev) => (prev === 'over' ? null : 'over'))
              }
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onSave}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: canSave ? t.colors.tint : t.colors.surface,
              borderColor: canSave ? t.colors.tint : t.colors.border,
              opacity: pressed ? 0.9 : 1,
            },
          ]}>
          <Text
            style={[
              styles.saveButtonText,
              { color: canSave ? t.colors.background : t.colors.mutedText },
            ]}>
            {saving ? 'Saving…' : 'Save Today'}
          </Text>
        </Pressable>

        {saveMsg ? (
          <Text style={[styles.success, { color: t.colors.text }]}>{saveMsg}</Text>
        ) : null}

        <View style={{ height: 16 }} />

        <View style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.border }]}>
          <Text style={[styles.sectionLabel, { color: t.colors.text }]}>
            This week so far
          </Text>

          <Pressable
            onPress={() => setTooltip(null)}
            onLayout={(e) => setWeekAreaWidth(e.nativeEvent.layout.width)}
            style={{ position: 'relative', paddingTop: 8, paddingBottom: 4 }}>
            <View style={styles.weekRow}>
              {weekDays.map((d, i) => {
                const row = weekLogByDate.get(d.iso) ?? null;
                const hasWeight = row?.weight_kg != null;
                const isToday = d.iso === todayISO;
                return (
                  <View
                    key={d.iso}
                    style={styles.weekItem}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout;
                      setDotLayouts((prev) => {
                        const next = [...prev];
                        next[i] = { x, width };
                        return next;
                      });
                    }}>
                    <Text
                      style={[
                        styles.dayLetter,
                        { color: isToday ? t.colors.text : t.colors.mutedText },
                      ]}>
                      {dayLetters[i]}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (!hasWeight) {
                          setTooltip(null);
                          return;
                        }
                        setTooltip({
                          index: i,
                          text: `${row!.weight_kg} kg`,
                        });
                      }}
                      style={({ pressed }) => [
                        styles.dotOuter,
                        {
                          borderColor: isToday ? t.colors.tint : t.colors.border,
                          backgroundColor: t.colors.surface,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}>
                      <View
                        style={[
                          styles.dotInner,
                          {
                            backgroundColor: hasWeight ? t.colors.tint : 'transparent',
                          },
                        ]}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {tooltip ? (
              <View
                onLayout={(e) => setTooltipWidth(e.nativeEvent.layout.width)}
                style={[
                  styles.tooltip,
                  {
                    left: tooltipLeft,
                    backgroundColor: t.colors.surface,
                    borderColor: t.colors.border,
                  },
                ]}>
                <Text style={[styles.tooltipText, { color: t.colors.text }]}>
                  {tooltip.text}
                </Text>
              </View>
            ) : null}
          </Pressable>

          {loading ? (
            <Text style={[styles.hint, { color: t.colors.mutedText, marginTop: 8 }]}>
              Loading…
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  weightInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 14, android: 10, default: 12 }),
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  prompt: {
    fontSize: 13,
    fontWeight: '700',
  },
  subtext: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  saveButton: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  success: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  weekItem: {
    alignItems: 'center',
    gap: 8,
    width: 38,
  },
  dayLetter: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  dotOuter: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  tooltip: {
    position: 'absolute',
    top: 0,
    transform: [{ translateY: -8 }],
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tooltipText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});

