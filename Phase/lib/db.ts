import * as SQLite from "expo-sqlite";

export const DB_NAME = "phase.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initPromise: Promise<void> | null = null;

async function init(db: SQLite.SQLiteDatabase) {
  // Idempotent initialization; never drops or resets tables.
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('bulk', 'cut', 'maintain')),
      pace TEXT NOT NULL CHECK (pace IN ('mild', 'moderate', 'aggressive')),
      start_date TEXT NOT NULL,
      end_date TEXT NULL,
      start_weight REAL NOT NULL,
      goal_weight REAL NOT NULL,
      weekly_target_rate REAL NOT NULL,
      calorie_target INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      weight_kg REAL NULL,
      did_lift INTEGER NULL CHECK (did_lift IN (0, 1)),
      lift_rating TEXT NULL CHECK (lift_rating IN ('improving', 'holding', 'declining')),
      calorie_rating TEXT NULL CHECK (calorie_rating IN ('under', 'on', 'over'))
    );

    CREATE TABLE IF NOT EXISTS biweekly_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      waist_cm REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      avg_weight REAL NULL,
      dominant_lift_rating TEXT NULL,
      calorie_compliance_pct REAL NULL,
      phase_id INTEGER NOT NULL,
      FOREIGN KEY (phase_id) REFERENCES phases(id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
    CREATE INDEX IF NOT EXISTS idx_biweekly_logs_date ON biweekly_logs(date);
    CREATE INDEX IF NOT EXISTS idx_weekly_summaries_week_start ON weekly_summaries(week_start);
    CREATE INDEX IF NOT EXISTS idx_weekly_summaries_phase_id ON weekly_summaries(phase_id);
  `);
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  const db = await dbPromise;

  if (!initPromise) {
    initPromise = init(db);
  }
  await initPromise;

  return db;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS weekly_summaries;
    DROP TABLE IF EXISTS biweekly_logs;
    DROP TABLE IF EXISTS daily_logs;
    DROP TABLE IF EXISTS phases;
    PRAGMA foreign_keys = ON;
  `);

  initPromise = init(db);
  await initPromise;
}

