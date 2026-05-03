import { getDb } from "./db";

export type PhaseType = "bulk" | "cut" | "maintain";
export type PhasePace = "mild" | "moderate" | "aggressive";

export type LiftRating = "improving" | "holding" | "declining";
export type CalorieRating = "under" | "on" | "over";

export type ISODateString = string; // YYYY-MM-DD

export type PhaseRow = {
  id: number;
  type: PhaseType;
  pace: PhasePace;
  start_date: ISODateString;
  end_date: ISODateString | null;
  start_weight: number;
  goal_weight: number;
  weekly_target_rate: number;
  calorie_target: number;
};

export type DailyLogRow = {
  id: number;
  date: ISODateString;
  weight_kg: number | null;
  did_lift: 0 | 1 | null;
  lift_rating: LiftRating | null;
  calorie_rating: CalorieRating | null;
};

export type BiweeklyLogRow = {
  id: number;
  date: ISODateString;
  waist_cm: number;
};

export type WeeklySummaryRow = {
  id: number;
  week_start: ISODateString; // Monday
  avg_weight: number | null;
  dominant_lift_rating: LiftRating | null;
  calorie_compliance_pct: number | null;
  phase_id: number;
};

function toISODate(d: Date): ISODateString {
  // Use local date, not UTC, to match user expectations.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeekMondayISO(now: Date = new Date()): ISODateString {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 (Sun) ... 6 (Sat)
  const diffToMonday = (day + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  d.setDate(d.getDate() - diffToMonday);
  return toISODate(d);
}

export async function insertDailyLog(input: {
  date: ISODateString;
  weight_kg?: number | null;
  did_lift?: 0 | 1 | null;
  lift_rating?: LiftRating | null;
  calorie_rating?: CalorieRating | null;
}): Promise<void> {
  const db = await getDb();

  const weight_kg = input.weight_kg ?? null;
  const did_lift = input.did_lift ?? null;
  const lift_rating = input.lift_rating ?? null;
  const calorie_rating = input.calorie_rating ?? null;

  // Upsert by date (date is UNIQUE).
  await db.runAsync(
    `
    INSERT INTO daily_logs (date, weight_kg, did_lift, lift_rating, calorie_rating)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      weight_kg = excluded.weight_kg,
      did_lift = excluded.did_lift,
      lift_rating = excluded.lift_rating,
      calorie_rating = excluded.calorie_rating
    `,
    [input.date, weight_kg, did_lift, lift_rating, calorie_rating]
  );
}

export async function getDailyLogsForCurrentWeek(
  now: Date = new Date()
): Promise<DailyLogRow[]> {
  const db = await getDb();
  const weekStart = startOfWeekMondayISO(now);

  // weekEndExclusive = weekStart + 7 days, as ISO date
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ws = new Date(weekStart);
  // Date(YYYY-MM-DD) parses as UTC; avoid it by re-parsing manually.
  const [y, m, dd] = weekStart.split("-").map((x) => Number(x));
  const weekStartLocal = new Date(y, m - 1, dd);
  const weekEndLocal = new Date(weekStartLocal);
  weekEndLocal.setDate(weekEndLocal.getDate() + 7);
  const weekEndExclusive = toISODate(weekEndLocal);
  void start; // keep deterministic local logic; variable retained for clarity
  void ws;

  const rows = await db.getAllAsync<DailyLogRow>(
    `
    SELECT id, date, weight_kg, did_lift, lift_rating, calorie_rating
    FROM daily_logs
    WHERE date >= ? AND date < ?
    ORDER BY date ASC
    `,
    [weekStart, weekEndExclusive]
  );
  return rows;
}

export async function getActivePhase(): Promise<PhaseRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PhaseRow>(
    `
    SELECT id, type, pace, start_date, end_date, start_weight, goal_weight, weekly_target_rate, calorie_target
    FROM phases
    WHERE end_date IS NULL
    ORDER BY start_date DESC, id DESC
    LIMIT 1
    `
  );
  return row ?? null;
}

export async function setPhaseEnded(params: {
  phaseId: number;
  endDate: ISODateString;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE phases SET end_date = ? WHERE id = ?`, [
    params.endDate,
    params.phaseId,
  ]);
}

export async function insertNewPhase(input: {
  type: PhaseType;
  pace: PhasePace;
  start_date: ISODateString;
  end_date?: ISODateString | null;
  start_weight: number;
  goal_weight: number;
  weekly_target_rate: number;
  calorie_target: number;
}): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `
    INSERT INTO phases (type, pace, start_date, end_date, start_weight, goal_weight, weekly_target_rate, calorie_target)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.type,
      input.pace,
      input.start_date,
      input.end_date ?? null,
      input.start_weight,
      input.goal_weight,
      input.weekly_target_rate,
      input.calorie_target,
    ]
  );
  return result.lastInsertRowId;
}

export async function getLast8WeeklySummaries(): Promise<WeeklySummaryRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<WeeklySummaryRow>(
    `
    SELECT id, week_start, avg_weight, dominant_lift_rating, calorie_compliance_pct, phase_id
    FROM weekly_summaries
    ORDER BY week_start DESC, id DESC
    LIMIT 8
    `
  );
  return rows;
}

export async function insertBiweeklyLog(input: {
  date: ISODateString;
  waist_cm: number;
}): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO biweekly_logs (date, waist_cm) VALUES (?, ?)`,
    [input.date, input.waist_cm]
  );
  return result.lastInsertRowId;
}

export async function getAllBiweeklyLogs(): Promise<BiweeklyLogRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BiweeklyLogRow>(
    `
    SELECT id, date, waist_cm
    FROM biweekly_logs
    ORDER BY date ASC, id ASC
    `
  );
  return rows;
}

