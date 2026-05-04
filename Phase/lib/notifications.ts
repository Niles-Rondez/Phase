import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type ReminderSettings = {
  weeklyEnabled: boolean;
  weeklyHour: number; // 0-23
  weeklyMinute: number; // 0-59
  biweeklyEnabled: boolean;
};

const PERMISSIONS_KEY = 'phase_notifications_permission';

const WEEKLY_MESSAGE = 'Phase check-in — log your weight and review your week.';
const BIWEEKLY_MESSAGE = 'Time to measure your waist. Tape, relaxed, navel level.';

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function nextSundayAtLocal(hour: number, minute: number, now: Date = new Date()): Date {
  const h = clampInt(hour, 0, 23);
  const m = clampInt(minute, 0, 59);

  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const day = d.getDay(); // 0..6, Sunday=0
  const daysUntilSunday = (7 - day) % 7;
  d.setDate(d.getDate() + daysUntilSunday);

  // If it's already past the time today (and today is Sunday), move to next week.
  if (daysUntilSunday === 0 && d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 7);
  }
  return d;
}

export async function requestPermissions(): Promise<Notifications.PermissionStatus> {
  const existing = await AsyncStorage.getItem(PERMISSIONS_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { status?: Notifications.PermissionStatus };
      if (parsed?.status) return parsed.status;
    } catch {
      // ignore and re-check
    }
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await AsyncStorage.setItem(
    PERMISSIONS_KEY,
    JSON.stringify({ status, askedAt: Date.now() })
  );

  return status;
}

export async function scheduleWeeklyLogReminder(
  hour: number,
  minute: number
): Promise<string> {
  const h = clampInt(hour, 0, 23);
  const m = clampInt(minute, 0, 59);

  // Calendar trigger: weekday is 1-7, Sunday=1 (Expo Notifications / iOS-style).
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Phase',
      body: WEEKLY_MESSAGE,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      weekday: 1,
      hour: h,
      minute: m,
      repeats: true,
    },
  });
}

export async function scheduleBiweeklyMeasurementReminder(): Promise<string> {
  // Expo doesn't offer "every 2 weeks on Sunday" as a calendar trigger.
  // We approximate with a 14-day repeating interval anchored to the next Sunday morning.
  const first = nextSundayAtLocal(8, 0);
  const secondsUntilFirst = Math.max(1, Math.round((first.getTime() - Date.now()) / 1000));
  const twoWeeksSeconds = 14 * 24 * 60 * 60;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Phase',
      body: BIWEEKLY_MESSAGE,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntilFirst,
      repeats: false,
    },
  }).then(async () => {
    // After the first fires, we want it to repeat every 14 days. Schedule the repeating
    // one starting two weeks after the first.
    const secondsUntilRepeatingStart = secondsUntilFirst + twoWeeksSeconds;
    return Notifications.scheduleNotificationAsync({
      content: { title: 'Phase', body: BIWEEKLY_MESSAGE },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilRepeatingStart,
        repeats: true,
      },
    });
  });
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function rescheduleAll(settings: ReminderSettings): Promise<void> {
  await cancelAllReminders();

  // If permissions aren't granted, scheduling still "works" on some platforms but will never show.
  // We'll request/check once here so "Save" is enough to make it functional.
  const status = await requestPermissions();
  if (status !== 'granted') return;

  if (settings.weeklyEnabled) {
    await scheduleWeeklyLogReminder(settings.weeklyHour, settings.weeklyMinute);
  }
  if (settings.biweeklyEnabled) {
    await scheduleBiweeklyMeasurementReminder();
  }
}

