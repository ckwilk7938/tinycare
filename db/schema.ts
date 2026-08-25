import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const babySettings = sqliteTable("baby_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trackerProfiles = sqliteTable("tracker_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  nextFeedMinutes: integer("next_feed_minutes").notNull(),
  formulaReminderEnabled: integer("formula_reminder_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  nextFeedReminderEnabled: integer("next_feed_reminder_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  emailRemindersEnabled: integer("email_reminders_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const scheduledEmailReminders = sqliteTable(
  "scheduled_email_reminders",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    profileId: text("profile_id").notNull(),
    resendEmailId: text("resend_email_id").notNull(),
    kind: text("kind", { enum: ["formula", "next_feed"] }).notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    recipient: text("recipient").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("scheduled_email_reminders_event_idx").on(table.eventId)],
);

export const plannerTasks = sqliteTable(
  "planner_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    note: text("note"),
    createdBy: text("created_by"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("planner_tasks_scheduled_at_idx").on(table.scheduledAt)],
);

export const recurringTasks = sqliteTable(
  "recurring_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    timeOfDay: text("time_of_day").notNull(),
    weekdays: text("weekdays").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    note: text("note"),
    createdBy: text("created_by"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("recurring_tasks_active_idx").on(table.active)],
);

export const recurringTaskSkips = sqliteTable(
  "recurring_task_skips",
  {
    id: text("id").primaryKey(),
    recurringTaskId: text("recurring_task_id").notNull(),
    dateKey: text("date_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("recurring_task_skips_rule_date_unique").on(table.recurringTaskId, table.dateKey),
    index("recurring_task_skips_rule_date_idx").on(table.recurringTaskId, table.dateKey),
  ],
);

export const babyEvents = sqliteTable(
  "baby_events",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["diaper", "feeding", "sleep"] }).notNull(),
    occurredAt: text("occurred_at").notNull(),
    endedAt: text("ended_at"),
    detail: text("detail").notNull(),
    feedingStatus: text("feeding_status", {
      enum: ["in_progress", "completed"],
    })
      .notNull()
      .default("completed"),
    amountMl: integer("amount_ml"),
    durationMinutes: integer("duration_minutes"),
    diaperSize: text("diaper_size"),
    diaperColor: text("diaper_color"),
    diaperLook: text("diaper_look"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("baby_events_type_idx").on(table.type),
    index("baby_events_occurred_at_idx").on(table.occurredAt),
    index("baby_events_feeding_status_idx").on(table.feedingStatus, table.occurredAt),
  ],
);

export const medicationRecords = sqliteTable(
  "medication_records",
  {
    id: text("id").primaryKey(),
    medicationName: text("medication_name").notNull(),
    strength: text("strength"),
    dose: text("dose").notNull(),
    doseUnit: text("dose_unit").notNull(),
    occurredAt: text("occurred_at").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("medication_records_occurred_at_idx").on(table.occurredAt)],
);

export const medicationFavorites = sqliteTable(
  "medication_favorites",
  {
    id: text("id").primaryKey(),
    medicationName: text("medication_name").notNull(),
    strength: text("strength"),
    defaultDose: text("default_dose"),
    defaultDoseUnit: text("default_dose_unit"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("medication_favorites_name_idx").on(table.medicationName)],
);

export const babyEventArchive = sqliteTable(
  "baby_event_archive",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    action: text("action", { enum: ["created", "updated", "deleted"] }).notNull(),
    snapshot: text("snapshot").notNull(),
    archivedAt: text("archived_at").notNull(),
  },
  (table) => [index("baby_event_archive_event_idx").on(table.eventId, table.archivedAt)],
);
