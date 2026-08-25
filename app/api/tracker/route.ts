import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { requireTrackerAccess } from "../../tracker-access";

type EventType = "diaper" | "feeding" | "sleep" | "medication";

type TrackerEvent = {
  id: string;
  type: EventType;
  occurredAt: string;
  endedAt: string | null;
  detail: string;
  feedingStatus: "in_progress" | "completed";
  amountMl: number | null;
  durationMinutes: number | null;
  nextFeedMinutes: number | null;
  diaperSize: string | null;
  diaperColor: string | null;
  diaperLook: string | null;
  medicationDose?: string | null;
  medicationUnit?: string | null;
  medicationStrength?: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

type MedicationRecord = {
  id: string;
  medicationName: string;
  strength: string | null;
  dose: string;
  doseUnit: string;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type MedicationFavorite = {
  id: string;
  medicationName: string;
  strength: string | null;
  defaultDose: string | null;
  defaultDoseUnit: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrackerProfile = {
  id: string;
  name: string;
  email: string | null;
  nextFeedMinutes: number;
  formulaReminderEnabled: boolean;
  nextFeedReminderEnabled: boolean;
  emailRemindersEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ScheduledReminder = {
  id: string;
  eventId: string;
  profileId: string;
  resendEmailId: string;
  kind: "formula" | "next_feed";
  scheduledAt: string;
  recipient: string;
  createdAt: string;
};

type PlannerTask = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  note: string | null;
  createdBy: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type RecurringTask = {
  id: string;
  title: string;
  timeOfDay: string;
  weekdays: number[];
  durationMinutes: number;
  note: string | null;
  createdBy: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_SETTINGS = {
  babyName: "Baby",
  birthAt: "",
  dayStartHour: "7",
  dayEndHour: "20",
  daytimeFeedMinutes: "180",
  nighttimeFeedMinutes: "240",
  expectedEventsLimit: "6",
};

async function getDatabase() {
  const { env } = await import("cloudflare:workers");

  if (!env.DB) {
    throw new Error("Database is not available.");
  }

  return env.DB;
}

async function ensureSchema() {
  const db = await getDatabase();
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS baby_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS baby_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('diaper', 'feeding', 'sleep')),
        occurred_at TEXT NOT NULL,
        ended_at TEXT,
        detail TEXT NOT NULL,
        feeding_status TEXT NOT NULL DEFAULT 'completed' CHECK (feeding_status IN ('in_progress', 'completed')),
        amount_ml INTEGER,
        duration_minutes INTEGER,
        next_feed_minutes INTEGER,
        diaper_size TEXT,
        diaper_color TEXT,
        diaper_look TEXT,
        note TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS medication_records (
        id TEXT PRIMARY KEY,
        medication_name TEXT NOT NULL,
        strength TEXT,
        dose TEXT NOT NULL,
        dose_unit TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        note TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS medication_favorites (
        id TEXT PRIMARY KEY,
        medication_name TEXT NOT NULL,
        strength TEXT,
        default_dose TEXT,
        default_dose_unit TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS baby_event_archive (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
        snapshot TEXT NOT NULL,
        archived_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS tracker_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        next_feed_minutes INTEGER NOT NULL,
        formula_reminder_enabled INTEGER NOT NULL DEFAULT 1,
        next_feed_reminder_enabled INTEGER NOT NULL DEFAULT 1,
        email_reminders_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS scheduled_email_reminders (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        resend_email_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('formula', 'next_feed')),
        scheduled_at TEXT NOT NULL,
        recipient TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS planner_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        note TEXT,
        created_by TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS recurring_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        time_of_day TEXT NOT NULL,
        weekdays TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        note TEXT,
        created_by TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS recurring_task_skips (
        id TEXT PRIMARY KEY,
        recurring_task_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(recurring_task_id, date_key)
      )`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS baby_events_type_idx ON baby_events (type)"),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS baby_events_occurred_at_idx ON baby_events (occurred_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS medication_records_occurred_at_idx ON medication_records (occurred_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS medication_favorites_name_idx ON medication_favorites (medication_name)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS baby_event_archive_event_idx ON baby_event_archive (event_id, archived_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS scheduled_email_reminders_event_idx ON scheduled_email_reminders (event_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS planner_tasks_scheduled_at_idx ON planner_tasks (scheduled_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS recurring_tasks_active_idx ON recurring_tasks (active)",
    ),
  ]);

  const columns = await db.prepare("PRAGMA table_info(baby_events)").all<{ name: string }>();
  const hasDurationMinutes = columns.results.some(
    (column) => column.name === "duration_minutes",
  );
  if (!hasDurationMinutes) {
    await db.prepare("ALTER TABLE baby_events ADD COLUMN duration_minutes INTEGER").run();
  }
  const columnNames = new Set(columns.results.map((column) => column.name));
  if (!columnNames.has("next_feed_minutes")) {
    await db.prepare("ALTER TABLE baby_events ADD COLUMN next_feed_minutes INTEGER").run();
  }
  if (!columnNames.has("diaper_size")) {
    await db.prepare("ALTER TABLE baby_events ADD COLUMN diaper_size TEXT").run();
  }
  if (!columnNames.has("diaper_color")) {
    await db.prepare("ALTER TABLE baby_events ADD COLUMN diaper_color TEXT").run();
  }
  if (!columnNames.has("diaper_look")) {
    await db.prepare("ALTER TABLE baby_events ADD COLUMN diaper_look TEXT").run();
  }
  if (!columnNames.has("feeding_status")) {
    await db
      .prepare(
        "ALTER TABLE baby_events ADD COLUMN feeding_status TEXT NOT NULL DEFAULT 'completed'",
      )
      .run();
  }
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS baby_events_feeding_status_idx ON baby_events (feeding_status, occurred_at)",
    )
    .run();
  const profileColumns = await db
    .prepare("PRAGMA table_info(tracker_profiles)")
    .all<{ name: string }>();
  const profileColumnNames = new Set(profileColumns.results.map((column) => column.name));
  if (!profileColumnNames.has("email")) {
    await db.prepare("ALTER TABLE tracker_profiles ADD COLUMN email TEXT").run();
  }
  if (!profileColumnNames.has("email_reminders_enabled")) {
    await db
      .prepare(
        "ALTER TABLE tracker_profiles ADD COLUMN email_reminders_enabled INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  }

  const favoriteTimestamp = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO medication_favorites (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("favorite-tylenol", "Tylenol", null, null, "mL", favoriteTimestamp, favoriteTimestamp),
    db.prepare("INSERT OR IGNORE INTO medication_favorites (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("favorite-ibuprofen", "Ibuprofen", null, null, "mL", favoriteTimestamp, favoriteTimestamp),
    db.prepare("INSERT OR IGNORE INTO medication_favorites (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("favorite-benadryl", "Benadryl", null, null, "mL", favoriteTimestamp, favoriteTimestamp),
    db.prepare("INSERT OR IGNORE INTO medication_favorites (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("favorite-zyrtec", "Zyrtec", null, null, "mL", favoriteTimestamp, favoriteTimestamp),
    db.prepare("INSERT OR IGNORE INTO medication_favorites (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("favorite-antibiotic", "Antibiotic", null, null, "mL", favoriteTimestamp, favoriteTimestamp),
  ]);
}

async function readSettings() {
  const db = await getDatabase();
  const rows = await db
    .prepare("SELECT key, value FROM baby_settings")
    .all<{ key: string; value: string }>();

  return rows.results.reduce(
    (settings, row) => ({ ...settings, [row.key]: row.value }),
    DEFAULT_SETTINGS,
  );
}

async function readProfiles() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      `SELECT
        id,
        name,
        email,
        next_feed_minutes as nextFeedMinutes,
        formula_reminder_enabled as formulaReminderEnabled,
        next_feed_reminder_enabled as nextFeedReminderEnabled,
        email_reminders_enabled as emailRemindersEnabled,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tracker_profiles
      ORDER BY created_at ASC`,
    )
    .all<
      Omit<
        TrackerProfile,
        "formulaReminderEnabled" | "nextFeedReminderEnabled" | "emailRemindersEnabled"
      > & {
      formulaReminderEnabled: number;
      nextFeedReminderEnabled: number;
      emailRemindersEnabled: number;
    }>();

  if (!rows.results.length) {
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO tracker_profiles
            (id, name, next_feed_minutes, formula_reminder_enabled, next_feed_reminder_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind("parent-1", "Parent 1", 180, 1, 1, now, now),
      db
        .prepare(
          `INSERT INTO tracker_profiles
            (id, name, next_feed_minutes, formula_reminder_enabled, next_feed_reminder_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind("parent-2", "Parent 2", 180, 1, 1, now, now),
    ]);
    return readProfiles();
  }

  return rows.results.map((profile) => ({
    ...profile,
    formulaReminderEnabled: Boolean(profile.formulaReminderEnabled),
    nextFeedReminderEnabled: Boolean(profile.nextFeedReminderEnabled),
    emailRemindersEnabled: Boolean(profile.emailRemindersEnabled),
  }));
}

async function readPlannerTasks() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      `SELECT
        id,
        title,
        scheduled_at as scheduledAt,
        duration_minutes as durationMinutes,
        note,
        created_by as createdBy,
        completed,
        created_at as createdAt,
        updated_at as updatedAt
      FROM planner_tasks
      ORDER BY scheduled_at ASC
      LIMIT 1000`,
    )
    .all<Omit<PlannerTask, "completed"> & { completed: number }>();

  return rows.results.map((task) => ({ ...task, completed: Boolean(task.completed) }));
}

function normalizeWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [] as number[];

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6),
    ),
  ).sort((a, b) => a - b);
}

function normalizeTimeOfDay(value: unknown) {
  const timeOfDay = cleanText(value).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay) ? timeOfDay : "";
}

function parseWeekdays(value: string) {
  try {
    return normalizeWeekdays(JSON.parse(value));
  } catch {
    return [];
  }
}

async function readRecurringTasks() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      `SELECT
        id,
        title,
        time_of_day as timeOfDay,
        weekdays,
        duration_minutes as durationMinutes,
        note,
        created_by as createdBy,
        active,
        created_at as createdAt,
        updated_at as updatedAt
      FROM recurring_tasks
      ORDER BY time_of_day ASC, title ASC
      LIMIT 500`,
    )
    .all<Omit<RecurringTask, "active" | "weekdays"> & { active: number; weekdays: string }>();

  return rows.results.map((task) => ({
    ...task,
    active: Boolean(task.active),
    weekdays: parseWeekdays(task.weekdays),
  }));
}

async function readRecurringTaskSkips() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      "SELECT recurring_task_id as recurringTaskId, date_key as dateKey FROM recurring_task_skips LIMIT 5000",
    )
    .all<{ recurringTaskId: string; dateKey: string }>();
  return rows.results.map((skip) => `${skip.recurringTaskId}:${skip.dateKey}`);
}

function medicationEvent(record: MedicationRecord): TrackerEvent {
  return {
    id: record.id,
    type: "medication",
    occurredAt: record.occurredAt,
    endedAt: null,
    detail: record.medicationName,
    feedingStatus: "completed",
    amountMl: null,
    durationMinutes: null,
    nextFeedMinutes: null,
    diaperSize: null,
    diaperColor: null,
    diaperLook: null,
    medicationDose: record.dose,
    medicationUnit: record.doseUnit,
    medicationStrength: record.strength,
    note: record.note,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  };
}

async function readMedicationRecords() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      `SELECT id, medication_name as medicationName, strength, dose, dose_unit as doseUnit,
        occurred_at as occurredAt, note, created_by as createdBy, created_at as createdAt,
        updated_at as updatedAt
       FROM medication_records ORDER BY occurred_at DESC LIMIT 5000`,
    )
    .all<MedicationRecord>();
  return rows.results;
}

async function readMedicationFavorites() {
  const db = await getDatabase();
  const rows = await db
    .prepare(
      `SELECT id, medication_name as medicationName, strength, default_dose as defaultDose,
        default_dose_unit as defaultDoseUnit, created_at as createdAt, updated_at as updatedAt
       FROM medication_favorites ORDER BY medication_name COLLATE NOCASE ASC LIMIT 100`,
    )
    .all<MedicationFavorite>();
  return rows.results;
}

async function resendRequest(path: string, init: RequestInit) {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const apiKey = typeof runtimeEnv.RESEND_API_KEY === "string" ? runtimeEnv.RESEND_API_KEY : "";
  if (!apiKey) return null;

  return fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function cancelEventEmailReminders(eventId: string) {
  const db = await getDatabase();
  const reminders = await db
    .prepare(
      `SELECT
        id,
        event_id as eventId,
        profile_id as profileId,
        resend_email_id as resendEmailId,
        kind,
        scheduled_at as scheduledAt,
        recipient,
        created_at as createdAt
      FROM scheduled_email_reminders WHERE event_id = ?`,
    )
    .bind(eventId)
    .all<ScheduledReminder>();

  await Promise.all(
    reminders.results.map(async (reminder) => {
      await resendRequest(`/emails/${reminder.resendEmailId}/cancel`, { method: "POST" });
    }),
  );
  await db.prepare("DELETE FROM scheduled_email_reminders WHERE event_id = ?").bind(eventId).run();
}

async function cancelSupersededFeedEmailReminders(event: TrackerEvent) {
  if (event.type !== "feeding") return;
  const db = await getDatabase();
  const olderFeedReminders = await db
    .prepare(
      `SELECT DISTINCT reminders.event_id as eventId
       FROM scheduled_email_reminders reminders
       INNER JOIN baby_events events ON events.id = reminders.event_id
       WHERE events.type = 'feeding'
         AND events.occurred_at <= ?
         AND events.id != ?`,
    )
    .bind(event.occurredAt, event.id)
    .all<{ eventId: string }>();

  await Promise.all(olderFeedReminders.results.map((reminder) => cancelEventEmailReminders(reminder.eventId)));
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function medicationUnit(value: unknown) {
  const unit = cleanText(value);
  return ["mL", "mg", "tablet", "drop", "puff", "other"].includes(unit) ? unit : "mL";
}

function feedingStatusFor(type: EventType, value: unknown) {
  return type === "feeding" && value === "in_progress" ? "in_progress" : "completed";
}

async function archiveEvent(event: TrackerEvent, action: "created" | "updated" | "deleted") {
  const db = await getDatabase();
  await db
    .prepare(
      "INSERT INTO baby_event_archive (id, event_id, action, snapshot, archived_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), event.id, action, JSON.stringify(event), new Date().toISOString())
    .run();
}

async function readEventById(id: string) {
  const db = await getDatabase();
  return db
    .prepare(
      `SELECT id, type, occurred_at as occurredAt, ended_at as endedAt, detail,
        feeding_status as feedingStatus, amount_ml as amountMl, duration_minutes as durationMinutes, next_feed_minutes as nextFeedMinutes, diaper_size as diaperSize,
        diaper_color as diaperColor, diaper_look as diaperLook, note, created_by as createdBy,
        created_at as createdAt
       FROM baby_events WHERE id = ?`,
    )
    .bind(id)
    .first<TrackerEvent>();
}

export async function GET(request: NextRequest) {
  const locked = await requireTrackerAccess(request);
  if (locked) return locked;

  await ensureSchema();
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get("format");
  const settings = await readSettings();
  const profiles = await readProfiles();
  const db = await getDatabase();
  const babyEvents = await db
    .prepare(
      `SELECT
        id,
        type,
        occurred_at as occurredAt,
        ended_at as endedAt,
        detail,
        feeding_status as feedingStatus,
        amount_ml as amountMl,
        duration_minutes as durationMinutes,
        next_feed_minutes as nextFeedMinutes,
        diaper_size as diaperSize,
        diaper_color as diaperColor,
        diaper_look as diaperLook,
        note,
        created_by as createdBy,
        created_at as createdAt
      FROM baby_events
      ORDER BY occurred_at DESC
      LIMIT 5000`,
    )
    .all<TrackerEvent>();
  const medicationEvents = (await readMedicationRecords()).map(medicationEvent);
  const events = [...babyEvents.results, ...medicationEvents].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );

  if (format === "csv") {
    const header = [
      "id",
      "type",
      "occurredAt",
      "endedAt",
      "detail",
      "feedingStatus",
      "amountMl",
      "amountOz",
      "durationMinutes",
      "diaperSize",
      "diaperColor",
      "diaperLook",
      "medicationDose",
      "medicationUnit",
      "medicationStrength",
      "note",
      "createdBy",
      "createdAt",
    ];
    const rows = events.map((event) =>
      header
        .map((key) => {
          const value =
            key === "amountOz"
              ? event.amountMl
                ? (event.amountMl / 29.5735).toFixed(1)
                : ""
              : String(event[key as keyof TrackerEvent] ?? "");
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(","),
    );

    return new Response([header.join(","), ...rows].join("\n"), {
      headers: {
        "Content-Disposition": "attachment; filename=baby-tracker-doctor-log.csv",
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  const tasks = await readPlannerTasks();
  const recurringTasks = await readRecurringTasks();
  const recurringTaskSkips = await readRecurringTaskSkips();
  const medicationFavorites = await readMedicationFavorites();
  return NextResponse.json({ settings, profiles, events, tasks, recurringTasks, recurringTaskSkips, medicationFavorites });
}

export async function POST(request: NextRequest) {
  const locked = await requireTrackerAccess(request);
  if (locked) return locked;

  await ensureSchema();
  const user = await getChatGPTUser();
  const body = await request.json();
  const now = new Date().toISOString();

  if (body.action === "save-settings") {
    const babyName = cleanText(body.babyName, "Baby") || "Baby";
    const birthAt = cleanText(body.birthAt);
    const dayStartHour = [0, 6, 7, 8, 9, 10, 12].includes(Number(body.dayStartHour))
      ? String(Number(body.dayStartHour))
      : DEFAULT_SETTINGS.dayStartHour;
    const dayEndHour = [17, 18, 19, 20, 21, 22, 23, 24].includes(Number(body.dayEndHour))
      ? String(Number(body.dayEndHour))
      : DEFAULT_SETTINGS.dayEndHour;
    const daytimeFeedMinutes = [120, 180, 240, 300, 360].includes(Number(body.daytimeFeedMinutes))
      ? String(Number(body.daytimeFeedMinutes))
      : DEFAULT_SETTINGS.daytimeFeedMinutes;
    const nighttimeFeedMinutes = [120, 180, 240, 300, 360].includes(Number(body.nighttimeFeedMinutes))
      ? String(Number(body.nighttimeFeedMinutes))
      : DEFAULT_SETTINGS.nighttimeFeedMinutes;
    const expectedEventsLimitValue = Number(body.expectedEventsLimit);
    const expectedEventsLimit = Number.isFinite(expectedEventsLimitValue)
      ? String(Math.min(Math.max(Math.round(expectedEventsLimitValue), 1), 30))
      : DEFAULT_SETTINGS.expectedEventsLimit;
    const db = await getDatabase();

    await db.batch([
      db
        .prepare(
          "INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)",
        )
        .bind("babyName", babyName, now),
      db
        .prepare(
          "INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)",
        )
        .bind("birthAt", birthAt, now),
      db.prepare("INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)").bind("dayStartHour", dayStartHour, now),
      db.prepare("INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)").bind("dayEndHour", dayEndHour, now),
      db.prepare("INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)").bind("daytimeFeedMinutes", daytimeFeedMinutes, now),
      db.prepare("INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)").bind("nighttimeFeedMinutes", nighttimeFeedMinutes, now),
      db.prepare("INSERT OR REPLACE INTO baby_settings (key, value, updated_at) VALUES (?, ?, ?)").bind("expectedEventsLimit", expectedEventsLimit, now),
    ]);

    return NextResponse.json({ ok: true, settings: { babyName, birthAt, dayStartHour, dayEndHour, daytimeFeedMinutes, nighttimeFeedMinutes, expectedEventsLimit } });
  }

  if (body.action === "save-task") {
    const id = cleanText(body.id).slice(0, 100) || crypto.randomUUID();
    const title = cleanText(body.title).slice(0, 120);
    if (!title) return NextResponse.json({ error: "Add a task name." }, { status: 400 });
    const duration = Number(body.durationMinutes);
    const durationMinutes = Number.isFinite(duration) ? Math.min(720, Math.max(5, Math.round(duration))) : 30;
    const task: PlannerTask = {
      id,
      title,
      scheduledAt: normalizeIso(body.scheduledAt),
      durationMinutes,
      note: cleanText(body.note) || null,
      createdBy: cleanText(body.createdBy) || user?.displayName || user?.email || null,
      completed: Boolean(body.completed),
      createdAt: now,
      updatedAt: now,
    };
    const db = await getDatabase();
    const existing = await db.prepare("SELECT created_at as createdAt FROM planner_tasks WHERE id = ?").bind(id).first<{ createdAt: string }>();
    if (existing) task.createdAt = existing.createdAt;
    await db.prepare(
      `INSERT INTO planner_tasks (id, title, scheduled_at, duration_minutes, note, created_by, completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, scheduled_at = excluded.scheduled_at,
         duration_minutes = excluded.duration_minutes, note = excluded.note, created_by = excluded.created_by,
         completed = excluded.completed, updated_at = excluded.updated_at`,
    ).bind(task.id, task.title, task.scheduledAt, task.durationMinutes, task.note, task.createdBy, task.completed ? 1 : 0, task.createdAt, task.updatedAt).run();
    return NextResponse.json({ ok: true, task });
  }

  if (body.action === "save-recurring-task") {
    const id = cleanText(body.id).slice(0, 100) || crypto.randomUUID();
    const title = cleanText(body.title).slice(0, 120);
    if (!title) return NextResponse.json({ error: "Add a task name." }, { status: 400 });
    const timeOfDay = normalizeTimeOfDay(body.timeOfDay);
    if (!timeOfDay) return NextResponse.json({ error: "Choose a time." }, { status: 400 });
    const weekdays = normalizeWeekdays(body.weekdays);
    if (!weekdays.length) return NextResponse.json({ error: "Choose at least one day." }, { status: 400 });
    const duration = Number(body.durationMinutes);
    const durationMinutes = Number.isFinite(duration) ? Math.min(720, Math.max(5, Math.round(duration))) : 30;
    const recurringTask: RecurringTask = {
      id,
      title,
      timeOfDay,
      weekdays,
      durationMinutes,
      note: cleanText(body.note) || null,
      createdBy: cleanText(body.createdBy) || user?.displayName || user?.email || null,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    };
    const db = await getDatabase();
    const existing = await db.prepare("SELECT created_at as createdAt FROM recurring_tasks WHERE id = ?").bind(id).first<{ createdAt: string }>();
    if (existing) recurringTask.createdAt = existing.createdAt;
    await db.prepare(
      `INSERT INTO recurring_tasks (id, title, time_of_day, weekdays, duration_minutes, note, created_by, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, time_of_day = excluded.time_of_day,
         weekdays = excluded.weekdays, duration_minutes = excluded.duration_minutes, note = excluded.note,
         created_by = excluded.created_by, active = excluded.active, updated_at = excluded.updated_at`,
    ).bind(
      recurringTask.id,
      recurringTask.title,
      recurringTask.timeOfDay,
      JSON.stringify(recurringTask.weekdays),
      recurringTask.durationMinutes,
      recurringTask.note,
      recurringTask.createdBy,
      recurringTask.active ? 1 : 0,
      recurringTask.createdAt,
      recurringTask.updatedAt,
    ).run();
    return NextResponse.json({ ok: true, recurringTask });
  }

  if (body.action === "save-profile") {
    const id = cleanText(body.id).slice(0, 100) || crypto.randomUUID();
    const name = cleanText(body.name, "Family member") || "Family member";
    const email = null;
    const interval = Number(body.nextFeedMinutes);
    const nextFeedMinutes = [120, 180, 240].includes(interval) ? interval : 180;
    const formulaReminderEnabled = body.formulaReminderEnabled ? 1 : 0;
    const nextFeedReminderEnabled = body.nextFeedReminderEnabled ? 1 : 0;
    const emailRemindersEnabled = 0;
    const db = await getDatabase();

    await db
      .prepare(
        `INSERT INTO tracker_profiles
          (id, name, email, next_feed_minutes, formula_reminder_enabled, next_feed_reminder_enabled, email_reminders_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           email = excluded.email,
           next_feed_minutes = excluded.next_feed_minutes,
           formula_reminder_enabled = excluded.formula_reminder_enabled,
           next_feed_reminder_enabled = excluded.next_feed_reminder_enabled,
           email_reminders_enabled = excluded.email_reminders_enabled,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        name,
        email,
        nextFeedMinutes,
        formulaReminderEnabled,
        nextFeedReminderEnabled,
        emailRemindersEnabled,
        now,
        now,
      )
      .run();

    return NextResponse.json({ ok: true, profiles: await readProfiles() });
  }

  if (body.action === "send-test-email") {
    return NextResponse.json({ error: "Email reminders are disabled for this tracker." }, { status: 410 });
  }

  if (body.action === "get-email-status") {
    return NextResponse.json({ error: "Email reminders are disabled for this tracker." }, { status: 410 });
  }

  if (body.action === "save-medication") {
    const id = cleanText(body.id).slice(0, 100) || crypto.randomUUID();
    const medicationName = cleanText(body.medicationName).slice(0, 120);
    const dose = cleanText(body.dose).slice(0, 40);
    if (!medicationName || !dose) {
      return NextResponse.json({ error: "Add the medication name and dose." }, { status: 400 });
    }
    const db = await getDatabase();
    const existing = await db
      .prepare("SELECT created_at as createdAt FROM medication_records WHERE id = ?")
      .bind(id)
      .first<{ createdAt: string }>();
    const record: MedicationRecord = {
      id,
      medicationName,
      strength: cleanText(body.strength).slice(0, 120) || null,
      dose,
      doseUnit: medicationUnit(body.doseUnit),
      occurredAt: normalizeIso(body.occurredAt),
      note: cleanText(body.note) || null,
      createdBy: cleanText(body.loggedBy) || user?.displayName || user?.email || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db
      .prepare(
        `INSERT INTO medication_records
          (id, medication_name, strength, dose, dose_unit, occurred_at, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET medication_name = excluded.medication_name,
           strength = excluded.strength, dose = excluded.dose, dose_unit = excluded.dose_unit,
           occurred_at = excluded.occurred_at, note = excluded.note, created_by = excluded.created_by,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.medicationName,
        record.strength,
        record.dose,
        record.doseUnit,
        record.occurredAt,
        record.note,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
      )
      .run();
    const event = medicationEvent(record);
    await archiveEvent(event, existing ? "updated" : "created");
    return NextResponse.json({ ok: true, event, medication: record });
  }

  if (body.action === "save-medication-favorite") {
    const id = cleanText(body.id).slice(0, 100) || crypto.randomUUID();
    const medicationName = cleanText(body.medicationName).slice(0, 120);
    if (!medicationName) return NextResponse.json({ error: "Add a medication name." }, { status: 400 });
    const db = await getDatabase();
    const existing = await db
      .prepare("SELECT created_at as createdAt FROM medication_favorites WHERE id = ?")
      .bind(id)
      .first<{ createdAt: string }>();
    const favorite: MedicationFavorite = {
      id,
      medicationName,
      strength: cleanText(body.strength).slice(0, 120) || null,
      defaultDose: cleanText(body.defaultDose).slice(0, 40) || null,
      defaultDoseUnit: body.defaultDose ? medicationUnit(body.defaultDoseUnit) : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db
      .prepare(
        `INSERT INTO medication_favorites
          (id, medication_name, strength, default_dose, default_dose_unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET medication_name = excluded.medication_name,
           strength = excluded.strength, default_dose = excluded.default_dose,
           default_dose_unit = excluded.default_dose_unit, updated_at = excluded.updated_at`,
      )
      .bind(
        favorite.id,
        favorite.medicationName,
        favorite.strength,
        favorite.defaultDose,
        favorite.defaultDoseUnit,
        favorite.createdAt,
        favorite.updatedAt,
      )
      .run();
    return NextResponse.json({ ok: true, favorite });
  }

  if (body.action === "skip-recurring-task") {
    const recurringTaskId = cleanText(body.recurringTaskId).slice(0, 100);
    const dateKey = cleanText(body.dateKey).slice(0, 10);
    if (!recurringTaskId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return NextResponse.json({ error: "Could not skip this recurring task." }, { status: 400 });
    }
    const db = await getDatabase();
    await db
      .prepare(
        "INSERT OR IGNORE INTO recurring_task_skips (id, recurring_task_id, date_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), recurringTaskId, dateKey, now)
      .run();
    return NextResponse.json({ ok: true, skipKey: `${recurringTaskId}:${dateKey}` });
  }

  if (body.action === "update-event") {
    const id = cleanText(body.id).slice(0, 100);
    const type = body.type as EventType;
    if (!id || !["diaper", "feeding", "sleep"].includes(type)) {
      return NextResponse.json({ error: "Unknown event." }, { status: 400 });
    }
    const db = await getDatabase();
    const existing = await db
      .prepare("SELECT created_at as createdAt, feeding_status as feedingStatus, next_feed_minutes as nextFeedMinutes FROM baby_events WHERE id = ?")
      .bind(id)
      .first<{ createdAt: string; feedingStatus: "in_progress" | "completed"; nextFeedMinutes: number | null }>();
    if (!existing) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }

    const event: TrackerEvent = {
      id,
      type,
      occurredAt: normalizeIso(body.occurredAt),
      endedAt: body.endedAt ? normalizeIso(body.endedAt) : null,
      detail: cleanText(body.detail, type),
      feedingStatus: feedingStatusFor(type, body.feedingStatus),
      amountMl: Number.isFinite(Number(body.amountMl)) ? Number(body.amountMl) : null,
      durationMinutes: Number.isFinite(Number(body.durationMinutes))
        ? Number(body.durationMinutes)
        : null,
      nextFeedMinutes: [120, 180, 240, 300, 360].includes(Number(body.nextFeedMinutes))
        ? Number(body.nextFeedMinutes)
        : existing.nextFeedMinutes,
      diaperSize: cleanText(body.diaperSize) || null,
      diaperColor: cleanText(body.diaperColor) || null,
      diaperLook: cleanText(body.diaperLook) || null,
      note: cleanText(body.note) || null,
      createdBy: cleanText(body.loggedBy) || user?.displayName || user?.email || null,
      createdAt: existing.createdAt,
    };

    await db
      .prepare(
        `UPDATE baby_events SET
          type = ?, occurred_at = ?, ended_at = ?, detail = ?, amount_ml = ?, duration_minutes = ?, next_feed_minutes = ?,
          feeding_status = ?, diaper_size = ?, diaper_color = ?, diaper_look = ?, note = ?, created_by = ?
         WHERE id = ?`,
      )
      .bind(
        event.type,
        event.occurredAt,
        event.endedAt,
        event.detail,
        event.amountMl,
        event.durationMinutes,
        event.nextFeedMinutes,
        event.feedingStatus,
        event.diaperSize,
        event.diaperColor,
        event.diaperLook,
        event.note,
        event.createdBy,
        event.id,
      )
      .run();

    await archiveEvent(event, "updated");

    if (event.type === "feeding" && event.feedingStatus === "completed") {
      await cancelEventEmailReminders(event.id).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, event });
  }

  if (body.action === "delete-event") {
    const id = cleanText(body.id).slice(0, 100);
    const db = await getDatabase();
    const existing = id ? await readEventById(id) : null;
    if (existing) {
      await cancelEventEmailReminders(id).catch(() => undefined);
      await db.prepare("DELETE FROM baby_events WHERE id = ?").bind(id).run();
      await archiveEvent(existing, "deleted");
      return NextResponse.json({ ok: true });
    }
    const medication = id
      ? await db
          .prepare(
            `SELECT id, medication_name as medicationName, strength, dose, dose_unit as doseUnit,
              occurred_at as occurredAt, note, created_by as createdBy, created_at as createdAt,
              updated_at as updatedAt FROM medication_records WHERE id = ?`,
          )
          .bind(id)
          .first<MedicationRecord>()
      : null;
    if (!medication) return NextResponse.json({ ok: true, alreadyDeleted: true });
    await db.prepare("DELETE FROM medication_records WHERE id = ?").bind(id).run();
    await archiveEvent(medicationEvent(medication), "deleted");
    return NextResponse.json({ ok: true });
  }

  const type = body.type as EventType;
  if (!["diaper", "feeding", "sleep"].includes(type)) {
    return NextResponse.json({ error: "Unknown event type." }, { status: 400 });
  }

  const requestedId = cleanText(body.id).slice(0, 100);
  const requestedFeedingStatus = feedingStatusFor(type, body.feedingStatus);
  if (type === "feeding" && requestedFeedingStatus === "in_progress") {
    const activeSession = await getDatabase()
      .then((db) => db.prepare(
        `SELECT id, type, occurred_at as occurredAt, ended_at as endedAt, detail,
          feeding_status as feedingStatus, amount_ml as amountMl, duration_minutes as durationMinutes, next_feed_minutes as nextFeedMinutes,
          diaper_size as diaperSize, diaper_color as diaperColor, diaper_look as diaperLook, note,
          created_by as createdBy, created_at as createdAt
         FROM baby_events
         WHERE type = 'feeding' AND feeding_status = 'in_progress'
         ORDER BY occurred_at DESC
         LIMIT 1`,
      ).first<TrackerEvent>());
    if (activeSession) {
      return NextResponse.json({ ok: true, event: activeSession, alreadySaved: true, activeSession: true });
    }
  }
  const duplicate = requestedId ? await readEventById(requestedId) : null;
  if (duplicate) {
    return NextResponse.json({ ok: true, event: duplicate, alreadySaved: true });
  }

  const event: TrackerEvent = {
    id: requestedId || crypto.randomUUID(),
    type,
    occurredAt: normalizeIso(body.occurredAt),
    endedAt: body.endedAt ? normalizeIso(body.endedAt) : null,
    detail: cleanText(body.detail, type),
    feedingStatus: requestedFeedingStatus,
    amountMl: Number.isFinite(Number(body.amountMl)) ? Number(body.amountMl) : null,
    durationMinutes: Number.isFinite(Number(body.durationMinutes))
      ? Number(body.durationMinutes)
      : null,
    nextFeedMinutes: [120, 180, 240, 300, 360].includes(Number(body.nextFeedMinutes))
      ? Number(body.nextFeedMinutes)
      : null,
    diaperSize: cleanText(body.diaperSize) || null,
    diaperColor: cleanText(body.diaperColor) || null,
    diaperLook: cleanText(body.diaperLook) || null,
    note: cleanText(body.note) || null,
    createdBy: cleanText(body.loggedBy) || user?.displayName || user?.email || null,
    createdAt: now,
  };

  const db = await getDatabase();
  await db
    .prepare(
      `INSERT INTO baby_events
        (id, type, occurred_at, ended_at, detail, feeding_status, amount_ml, duration_minutes, next_feed_minutes, diaper_size, diaper_color, diaper_look, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.type,
      event.occurredAt,
      event.endedAt,
      event.detail,
      event.feedingStatus,
      event.amountMl,
      event.durationMinutes,
      event.nextFeedMinutes,
      event.diaperSize,
      event.diaperColor,
      event.diaperLook,
      event.note,
      event.createdBy,
      event.createdAt,
    )
    .run();

  await archiveEvent(event, "created");
  await cancelSupersededFeedEmailReminders(event).catch(() => undefined);

  return NextResponse.json({ ok: true, event });
}

export async function DELETE(request: NextRequest) {
  const locked = await requireTrackerAccess(request);
  if (locked) return locked;

  await ensureSchema();
  const id = request.nextUrl.searchParams.get("id");
  const kind = request.nextUrl.searchParams.get("kind");

  if (!id) {
    return NextResponse.json({ error: "Missing event id." }, { status: 400 });
  }

  const db = await getDatabase();
  if (kind === "task") {
    await db.prepare("DELETE FROM planner_tasks WHERE id = ?").bind(id).run();
    return NextResponse.json({ ok: true });
  }
  if (kind === "recurring-task") {
    await db.batch([
      db.prepare("DELETE FROM recurring_tasks WHERE id = ?").bind(id),
      db.prepare("DELETE FROM planner_tasks WHERE completed = 0 AND id LIKE ?").bind(`repeat-%-${id}`),
      db.prepare("DELETE FROM recurring_task_skips WHERE recurring_task_id = ?").bind(id),
    ]);
    return NextResponse.json({ ok: true });
  }
  if (kind === "medication-favorite") {
    await db.prepare("DELETE FROM medication_favorites WHERE id = ?").bind(id).run();
    return NextResponse.json({ ok: true });
  }
  const existing = await readEventById(id);
  await cancelEventEmailReminders(id);
  await db.prepare("DELETE FROM baby_events WHERE id = ?").bind(id).run();
  if (existing) await archiveEvent(existing, "deleted");
  return NextResponse.json({ ok: true });
}
