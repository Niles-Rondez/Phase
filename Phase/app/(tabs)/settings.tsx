import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { useColorScheme } from '@/components/useColorScheme';
import { PHASE_COLORS, theme } from '@/constants/theme';
import { cancelAllReminders, rescheduleAll, type ReminderSettings } from '@/lib/notifications';
import { resetDatabase } from '@/lib/db';
import type { PhasePace, PhaseRow, PhaseType } from '@/lib/queries';
import {
  endActivePhase,
  getActivePhase,
  getAllBiweeklyLogs,
  getAllDailyLogs,
  getAllPhases,
  getAllWeeklySummaries,
  getLastLoggedWeightKg,
  insertPhase,
} from '@/lib/queries';

type PhaseTypeOption = {
  type: PhaseType;
  title: string;
  subtitle: string;
};

const PHASE_TYPE_OPTIONS: PhaseTypeOption[] = [
  { type: 'bulk', title: 'Bulk', subtitle: '+size +strength' },
  { type: 'maintain', title: 'Maintain', subtitle: 'hold + recomp' },
  { type: 'cut', title: 'Cut', subtitle: '-fat, keep muscle' },
];

const PACE_OPTIONS: { pace: PhasePace; title: string }[] = [
  { pace: 'mild', title: 'Mild' },
  { pace: 'moderate', title: 'Moderate' },
  { pace: 'aggressive', title: 'Aggressive' },
];

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

function formatPaceLabel(pace: PhasePace): string {
  if (pace === 'mild') return 'Mild';
  if (pace === 'aggressive') return 'Aggressive';
  return 'Moderate';
}

function formatTimeLabel(hour: number, minute: number): string {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `${h}:${m}`;
}

const REMINDER_SETTINGS_KEY = 'phase_reminder_settings';

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  weeklyEnabled: true,
  weeklyHour: 8,
  weeklyMinute: 0,
  biweeklyEnabled: true,
};

function weeklyRateMidpointKg(phaseType: PhaseType, pace: PhasePace): number {
  if (phaseType === 'maintain') return 0;
  if (phaseType === 'bulk') {
    if (pace === 'mild') return 0.125;
    if (pace === 'aggressive') return 0.35;
    return 0.2;
  }
  // cut
  if (pace === 'mild') return -0.3;
  if (pace === 'aggressive') return -0.7;
  return -0.5;
}

function rateExplainer(phaseType: PhaseType, pace: PhasePace): string | null {
  if (phaseType === 'maintain') return null;
  if (phaseType === 'bulk') {
    if (pace === 'mild') return 'Mild: +0.10–0.15 kg/wk';
    if (pace === 'moderate') return 'Moderate: +0.15–0.25 kg/wk';
    return 'Aggressive: +0.30–0.40 kg/wk';
  }
  // cut
  if (pace === 'mild') return 'Mild: −0.25–0.35 kg/wk';
  if (pace === 'moderate') return 'Moderate: −0.40–0.60 kg/wk';
  return 'Aggressive: −0.60–0.80 kg/wk';
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];
  const router = useRouter();

  const [activePhase, setActivePhase] = useState<PhaseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(true);

  const [phaseType, setPhaseType] = useState<PhaseType>('bulk');
  const [pace, setPace] = useState<PhasePace>('moderate');
  const [startWeightKg, setStartWeightKg] = useState<string>('');
  const [goalWeightKg, setGoalWeightKg] = useState<string>('');
  const [calorieTarget, setCalorieTarget] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [remindersSaving, setRemindersSaving] = useState(false);
  const [showWeeklyTimePickerIOS, setShowWeeklyTimePickerIOS] = useState(false);
  const [resetting, setResetting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      (async () => {
        const ap = await getActivePhase();
        const lastWeight = await getLastLoggedWeightKg();
        if (cancelled) return;
        setActivePhase(ap);
        setShowForm(ap ? false : true);
        if (lastWeight != null && startWeightKg.trim().length === 0) {
          setStartWeightKg(String(lastWeight));
        }
        setLoading(false);
      })().catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [startWeightKg])
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(REMINDER_SETTINGS_KEY);
      if (!raw) return;
      if (cancelled) return;
      try {
        const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
        setReminderSettings((prev) => ({
          weeklyEnabled: parsed.weeklyEnabled ?? prev.weeklyEnabled,
          weeklyHour: Number.isFinite(parsed.weeklyHour) ? (parsed.weeklyHour as number) : prev.weeklyHour,
          weeklyMinute: Number.isFinite(parsed.weeklyMinute) ? (parsed.weeklyMinute as number) : prev.weeklyMinute,
          biweeklyEnabled: parsed.biweeklyEnabled ?? prev.biweeklyEnabled,
        }));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectivePace: PhasePace = phaseType === 'maintain' ? 'moderate' : pace;
  const paceHelper = useMemo(() => rateExplainer(phaseType, effectivePace), [phaseType, effectivePace]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    const sw = Number(startWeightKg);
    const gw = Number(goalWeightKg);
    const kcal = Number(calorieTarget);
    if (!Number.isFinite(sw) || sw <= 0) return false;
    if (!Number.isFinite(gw) || gw <= 0) return false;
    if (!Number.isFinite(kcal) || kcal <= 0) return false;
    return true;
  }, [startWeightKg, goalWeightKg, calorieTarget, submitting]);

  const onStartPhase = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await endActivePhase();
      const nowISO = isoTodayLocal();
      await insertPhase({
        type: phaseType,
        pace: effectivePace,
        start_date: nowISO,
        start_weight: Number(startWeightKg),
        goal_weight: Number(goalWeightKg),
        weekly_target_rate: weeklyRateMidpointKg(phaseType, effectivePace),
        calorie_target: Number(calorieTarget),
      });
      router.replace('/(tabs)');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, calorieTarget, effectivePace, goalWeightKg, phaseType, router, startWeightKg]);

  const onPickWeeklyTime = useCallback(() => {
    const current = new Date();
    current.setHours(reminderSettings.weeklyHour, reminderSettings.weeklyMinute, 0, 0);
    setShowWeeklyTimePickerIOS(true);
  }, [reminderSettings.weeklyHour, reminderSettings.weeklyMinute]);

  const onSaveReminders = useCallback(async () => {
    if (remindersSaving) return;
    setRemindersSaving(true);
    try {
      await AsyncStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(reminderSettings));
      await rescheduleAll(reminderSettings);
    } finally {
      setRemindersSaving(false);
    }
  }, [reminderSettings, remindersSaving]);

  const onExportData = useCallback(async () => {
    const [phases, daily_logs, biweekly_logs, weekly_summaries] = await Promise.all([
      getAllPhases(),
      getAllDailyLogs(),
      getAllBiweeklyLogs(),
      getAllWeeklySummaries(),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      tables: { phases, daily_logs, biweekly_logs, weekly_summaries },
    };
    const json = JSON.stringify(payload, null, 2);

    const file = new File(Paths.cache, 'phase-export.json');
    await FileSystem.writeAsStringAsync((file as unknown as { uri: string }).uri, json, { encoding: 'utf8' });
    await Sharing.shareAsync((file as unknown as { uri: string }).uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export my data',
      UTI: 'public.json',
    });
  }, []);

  const onResetAllData = useCallback(() => {
    if (resetting) return;

    Alert.alert(
      'Reset all data?',
      'This will permanently delete all your phases, logs, and measurements. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, reset',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Everything will be deleted. The app will return to a fresh state.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete everything',
                  style: 'destructive',
                  onPress: async () => {
                    setResetting(true);
                    try {
                      await cancelAllReminders();
                      await resetDatabase();
                      await AsyncStorage.multiRemove([
                        REMINDER_SETTINGS_KEY,
                        'phase_notifications_permission',
                        'phase_notifications_permission_ran_once',
                      ]);
                      router.replace('/(tabs)');
                    } finally {
                      setResetting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [resetting, router]);

  const appVersion = useMemo(() => {
    return (
      Constants.expoConfig?.version ??
      (Constants as unknown as { nativeAppVersion?: string }).nativeAppVersion ??
      '—'
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 14 }}
        keyboardShouldPersistTaps="handled">
        {activePhase ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: t.colors.card,
              borderRadius: 16,
              padding: 14,
              gap: 10,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                  }}>
                  <Text style={{ color: t.colors.text, fontWeight: '700' }}>
                    {formatPhaseTypeLabel(activePhase.type)}
                  </Text>
                </View>
                <Text style={{ color: t.colors.mutedText, fontWeight: '600' }}>
                  {formatPaceLabel(activePhase.pace)}
                </Text>
              </View>

              <Pressable
                onPress={() => setShowForm(true)}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: pressed ? t.colors.surface : t.colors.card,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                })}>
                <Text style={{ color: t.colors.text, fontWeight: '700' }}>End Phase &amp; Start New One</Text>
              </Pressable>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ color: t.colors.mutedText }}>
                Start date: <Text style={{ color: t.colors.text, fontWeight: '600' }}>{activePhase.start_date}</Text>
              </Text>
              <Text style={{ color: t.colors.mutedText }}>
                Start weight:{' '}
                <Text style={{ color: t.colors.text, fontWeight: '600' }}>{activePhase.start_weight} kg</Text>
              </Text>
              <Text style={{ color: t.colors.mutedText }}>
                Goal weight: <Text style={{ color: t.colors.text, fontWeight: '600' }}>{activePhase.goal_weight} kg</Text>
              </Text>
              <Text style={{ color: t.colors.mutedText }}>
                Current week:{' '}
                <Text style={{ color: t.colors.text, fontWeight: '700' }}>
                  {currentWeekNumber(activePhase.start_date)}
                </Text>
              </Text>
            </View>
          </View>
        ) : null}

        {showForm ? (
          <View style={{ gap: 14, opacity: loading ? 0.7 : 1 }}>
            <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: '800' }}>Create New Phase</Text>

            <View style={{ gap: 10 }}>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Phase type</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {PHASE_TYPE_OPTIONS.map((opt) => {
                  const selected = phaseType === opt.type;
                  return (
                    <Pressable
                      key={opt.type}
                      onPress={() => setPhaseType(opt.type)}
                      style={({ pressed }) => ({
                        flex: 1,
                        borderRadius: 16,
                        padding: 12,
                        borderWidth: 1,
                        borderColor: selected ? t.colors.tint : t.colors.border,
                        backgroundColor: pressed ? t.colors.surface : t.colors.card,
                        gap: 6,
                      })}>
                      <Text style={{ color: t.colors.text, fontWeight: '800', fontSize: 16 }}>{opt.title}</Text>
                      <Text style={{ color: t.colors.mutedText, fontWeight: '600' }}>{opt.subtitle}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {phaseType === 'maintain' ? null : (
              <View style={{ gap: 10 }}>
                <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Pace</Text>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  {PACE_OPTIONS.map((opt) => {
                    const selected = pace === opt.pace;
                    return (
                      <Pressable
                        key={opt.pace}
                        onPress={() => setPace(opt.pace)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: selected ? t.colors.tint : t.colors.border,
                          backgroundColor: pressed ? t.colors.surface : t.colors.card,
                        })}>
                        <Text style={{ color: t.colors.text, fontWeight: '700' }}>{opt.title}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {paceHelper ? <Text style={{ color: t.colors.mutedText }}>{paceHelper}</Text> : null}
              </View>
            )}

            <View style={{ gap: 10 }}>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Start weight</Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.card,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}>
                <TextInput
                  value={startWeightKg}
                  onChangeText={setStartWeightKg}
                  keyboardType="numeric"
                  placeholder="kg"
                  placeholderTextColor={t.colors.mutedText}
                  style={{ color: t.colors.text, fontSize: 16, fontWeight: '600' }}
                />
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Goal weight</Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.card,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}>
                <TextInput
                  value={goalWeightKg}
                  onChangeText={setGoalWeightKg}
                  keyboardType="numeric"
                  placeholder="kg"
                  placeholderTextColor={t.colors.mutedText}
                  style={{ color: t.colors.text, fontSize: 16, fontWeight: '600' }}
                />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Calorie target</Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.card,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}>
                <TextInput
                  value={calorieTarget}
                  onChangeText={setCalorieTarget}
                  keyboardType="numeric"
                  placeholder="kcal/day"
                  placeholderTextColor={t.colors.mutedText}
                  style={{ color: t.colors.text, fontSize: 16, fontWeight: '600' }}
                />
              </View>
              <Text style={{ color: t.colors.mutedText }}>
                your rough daily target, used for calorie compliance tracking
              </Text>
            </View>

            <Pressable
              onPress={onStartPhase}
              disabled={!canSubmit}
              style={({ pressed }) => ({
                marginTop: 6,
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: !canSubmit ? t.colors.surface : pressed ? t.colors.surface : t.colors.tint,
                borderWidth: 1,
                borderColor: !canSubmit ? t.colors.border : t.colors.tint,
              })}>
              <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 16 }}>
                {submitting ? 'Starting…' : 'Start Phase'}
              </Text>
            </Pressable>

            {activePhase ? (
              <Pressable
                onPress={() => setShowForm(false)}
                style={({ pressed }) => ({
                  alignSelf: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  opacity: pressed ? 0.8 : 1,
                })}>
                <Text style={{ color: t.colors.mutedText, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Reminders */}
        <View
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.card,
            borderRadius: 16,
            padding: 14,
            gap: 12,
          }}>
          <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: '800' }}>Reminders</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: t.colors.text, fontWeight: '800' }}>Weekly check-in</Text>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
                Sundays — log weight + review your week
              </Text>
            </View>
            <Switch
              value={reminderSettings.weeklyEnabled}
              onValueChange={(v) => setReminderSettings((prev) => ({ ...prev, weeklyEnabled: v }))}
              trackColor={{ false: t.colors.border, true: t.colors.tint }}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onPickWeeklyTime}
            disabled={!reminderSettings.weeklyEnabled}
            style={({ pressed }) => ({
              opacity: !reminderSettings.weeklyEnabled ? 0.5 : pressed ? 0.85 : 1,
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: t.colors.surface,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            })}>
            <Text style={{ color: t.colors.mutedText, fontWeight: '800' }}>Time</Text>
            <Text style={{ color: t.colors.text, fontWeight: '900' }}>
              {formatTimeLabel(reminderSettings.weeklyHour, reminderSettings.weeklyMinute)}
            </Text>
          </Pressable>

          {Platform.OS === 'ios' && showWeeklyTimePickerIOS ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: t.colors.surface,
              }}>
              <Text style={{ color: '#888', fontSize: 12 }}>Reminder time: 8:00 AM (default)</Text>
              <Pressable
                onPress={() => setShowWeeklyTimePickerIOS(false)}
                style={({ pressed }) => ({
                  paddingVertical: 12,
                  alignItems: 'center',
                  opacity: pressed ? 0.8 : 1,
                  borderTopWidth: 1,
                  borderTopColor: t.colors.border,
                })}>
                <Text style={{ color: t.colors.text, fontWeight: '900' }}>Done</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={{ height: 1, backgroundColor: t.colors.border, opacity: 0.6, marginVertical: 2 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: t.colors.text, fontWeight: '800' }}>Bi-weekly waist measurement</Text>
              <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
                Every 2 weeks on Sunday
              </Text>
            </View>
            <Switch
              value={reminderSettings.biweeklyEnabled}
              onValueChange={(v) => setReminderSettings((prev) => ({ ...prev, biweeklyEnabled: v }))}
              trackColor={{ false: t.colors.border, true: t.colors.tint }}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onSaveReminders}
            disabled={remindersSaving}
            style={({ pressed }) => ({
              marginTop: 4,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? t.colors.surface : t.colors.tint,
              borderWidth: 1,
              borderColor: pressed ? t.colors.border : t.colors.tint,
              opacity: remindersSaving ? 0.7 : 1,
            })}>
            <Text style={{ color: t.colors.background, fontWeight: '900', fontSize: 16 }}>
              {remindersSaving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {/* Export + app info */}
        <View style={{ gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            onPress={onExportData}
            style={({ pressed }) => ({
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? t.colors.surface : t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            })}>
            <Text style={{ color: t.colors.text, fontWeight: '900', fontSize: 15 }}>Export my data.</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onResetAllData}
            disabled={resetting}
            style={({ pressed }) => ({
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? t.colors.surface : 'transparent',
              borderWidth: 1,
              borderColor: PHASE_COLORS.cut.border,
              opacity: resetting ? 0.6 : 1,
            })}>
            <Text style={{ color: PHASE_COLORS.cut.text, fontWeight: '900', fontSize: 15 }}>
              {resetting ? 'Resetting…' : 'Reset All Data'}
            </Text>
          </Pressable>

          <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>
            All data stored locally on your device. Nothing is sent anywhere.
          </Text>
          <Text style={{ color: t.colors.mutedText, fontWeight: '700', fontSize: 12 }}>Version: {appVersion}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

