"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  Baby,
  Bell,
  BellRing,
  Milk,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  CloudOff,
  Download,
  Droplets,
  Minus,
  Moon,
  Pencil,
  Pill,
  Plus,
  Repeat2,
  Settings2,
  Share,
  Sun,
  Table2,
  Trash2,
  X,
} from "lucide-react";

type EventType = "diaper" | "feeding" | "sleep" | "medication";
type ThemePreference = "auto" | "light" | "dark";
type VolumeUnit = "ml" | "oz";

type Settings = {
  babyName: string;
  birthAt: string;
  dayStartHour: string;
  dayEndHour: string;
  daytimeFeedMinutes: string;
  nighttimeFeedMinutes: string;
  expectedEventsLimit: string;
};

type PlannerTask = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  note: string | null;
  createdBy: string | null;
  completed: boolean;
  recurringTaskId?: string | null;
  recurrenceLabel?: string | null;
  isGenerated?: boolean;
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

type MedicationFavorite = {
  id: string;
  medicationName: string;
  strength: string | null;
  defaultDose: string | null;
  defaultDoseUnit: string | null;
  createdAt: string;
  updatedAt: string;
};

type FeedReminder = {
  eventId?: string;
  profileId: string;
  profileName: string;
  feedStartedAt: string;
  formulaDueAt: string;
  nextFeedDueAt: string;
  nextFeedMinutes: number;
  formulaNotified: boolean;
  nextFeedNotified: boolean;
  formulaReminderEnabled: boolean;
  nextFeedReminderEnabled: boolean;
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

const feedReminderStorageKey = "tinycare-feed-reminder";
const activeProfileStorageKey = "tinycare-active-profile";
const deviceCacheStorageKey = "tinycare-device-cache-v1";
const pendingChangesStorageKey = "tinycare-pending-changes-v1";
const themePreferenceStorageKey = "tinycare-theme-v1";
const expectedEventsStorageKey = "tinycare-expected-events-open-v1";
const formulaWindowMs = 60 * 60_000;
const trackerSaveTimeoutMs = 8_000;
// A neutral continental-US default for estimating sunrise and sunset.
const defaultLatitude = 39.8283;
const defaultLongitude = -98.5795;

type PendingChange = {
  id: string;
  method: "POST";
  body: Record<string, unknown>;
  createdAt: string;
};

type DeviceCache = {
  settings: Settings;
  profiles: TrackerProfile[];
  events: TrackerEvent[];
  tasks: PlannerTask[];
  recurringTasks: RecurringTask[];
  recurringTaskSkips?: string[];
  medicationFavorites?: MedicationFavorite[];
  savedAt: string;
};

const emptySettings: Settings = {
  babyName: "Baby",
  birthAt: "",
  dayStartHour: "7",
  dayEndHour: "20",
  daytimeFeedMinutes: "180",
  nighttimeFeedMinutes: "240",
  expectedEventsLimit: "6",
};

function expectedEventsLimitFromSettings(settings: Settings) {
  const parsed = Number(settings.expectedEventsLimit || emptySettings.expectedEventsLimit);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1), 30) : Number(emptySettings.expectedEventsLimit);
}

const weekdays = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
];

const quickActions = [
  { type: "feeding", detail: "Formula", label: "Bottle", helper: "Start timer" },
  { type: "diaper", detail: "Wet", label: "Wet", helper: "Pee diaper" },
  { type: "diaper", detail: "Dirty", label: "Dirty", helper: "Poop details" },
  { type: "sleep", detail: "Sleep", label: "Sleep", helper: "Start and end" },
] satisfies Array<{
  type: EventType;
  detail: string;
  label: string;
  helper: string;
}>;

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  if (!value) {
    return new Date().toISOString();
  }

  return new Date(value).toISOString();
}

function reminderForFeed(
  event: TrackerEvent,
  profile: TrackerProfile | undefined,
  fallbackName: string,
  currentMs: number,
  nextFeedMinutes = 180,
): FeedReminder {
  const recordedFeedStartMs = new Date(event.occurredAt).getTime();
  const safeCurrentMs = currentMs > 0 ? currentMs : recordedFeedStartMs;
  const feedStartMs = Number.isFinite(recordedFeedStartMs)
    ? Math.min(recordedFeedStartMs, safeCurrentMs)
    : currentMs;
  const feedStartedAt = new Date(feedStartMs).toISOString();
  const nextFeedStartMs = Number.isFinite(recordedFeedStartMs)
    ? recordedFeedStartMs
    : feedStartMs;
  const savedInterval = Number(event.nextFeedMinutes);
  const interval = [120, 180, 240, 300, 360].includes(savedInterval)
    ? savedInterval
    : nextFeedMinutes;

  return {
    eventId: event.id,
    profileId: profile?.id ?? "",
    profileName: profile?.name ?? (fallbackName || "Family"),
    feedStartedAt,
    formulaDueAt: new Date(feedStartMs + formulaWindowMs).toISOString(),
    nextFeedDueAt: new Date(nextFeedStartMs + interval * 60_000).toISOString(),
    nextFeedMinutes: interval,
    formulaNotified: false,
    nextFeedNotified: false,
    formulaReminderEnabled: profile?.formulaReminderEnabled ?? true,
    nextFeedReminderEnabled: profile?.nextFeedReminderEnabled ?? true,
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromIso(value: string) {
  return toDateKey(new Date(value));
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeWeekdaySelection(values: number[]) {
  return Array.from(
    new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)),
  ).sort((a, b) => a - b);
}

function timeOfDayFromDate(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeLocalForTimeOfDay(timeOfDay: string) {
  const date = new Date();
  const [hours = 9, minutes = 0] = timeOfDay.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return toDateTimeLocal(date);
}

function occurrenceAtForDateKey(task: RecurringTask, dateKey: string) {
  const date = dateFromKey(dateKey);
  const [hours = 9, minutes = 0] = task.timeOfDay.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function recurringOccurrenceId(ruleId: string, dateKey: string) {
  return `repeat-${dateKey}-${ruleId}`;
}

function recurringRuleIdFromOccurrenceId(id: string) {
  return /^repeat-\d{4}-\d{2}-\d{2}-/.test(id) ? id.slice(18) : null;
}

function recurringSummary(task: RecurringTask) {
  const days = normalizeWeekdaySelection(task.weekdays);
  if (days.length === 7) return "Every day";
  if (days.join(",") === "1,2,3,4,5") return "Weekdays";
  if (days.join(",") === "0,6") return "Weekends";
  return days
    .map((day) => weekdays.find((weekday) => weekday.value === day)?.short)
    .filter(Boolean)
    .join(", ");
}

function recurringTaskForDate(
  task: RecurringTask,
  dateKey: string,
  existingTaskIds: Set<string>,
  skippedOccurrences: Set<string>,
) {
  if (!task.active) return null;
  const date = dateFromKey(dateKey);
  if (!task.weekdays.includes(date.getDay())) return null;
  const id = recurringOccurrenceId(task.id, dateKey);
  if (existingTaskIds.has(id) || skippedOccurrences.has(`${task.id}:${dateKey}`)) return null;

  return {
    id,
    title: task.title,
    scheduledAt: occurrenceAtForDateKey(task, dateKey),
    durationMinutes: task.durationMinutes,
    note: task.note,
    createdBy: task.createdBy,
    completed: false,
    recurringTaskId: task.id,
    recurrenceLabel: recurringSummary(task),
    isGenerated: true,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  } satisfies PlannerTask;
}

function recurringTasksForDateKeys(
  tasks: RecurringTask[],
  dateKeys: string[],
  existingTaskIds: Set<string>,
  skippedOccurrences: Set<string>,
) {
  return dateKeys.flatMap((dateKey) =>
    tasks
      .map((task) => recurringTaskForDate(task, dateKey, existingTaskIds, skippedOccurrences))
      .filter((task): task is PlannerTask => Boolean(task)),
  );
}

function formatSelectedDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dateFromKey(value));
}

function minutesBetween(start: string, end: string | null) {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function babyAge(birthAt: string) {
  if (!birthAt) return "Set birth time";

  const birth = new Date(birthAt);
  const diffMs = Date.now() - birth.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "Birth time not reached";

  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const weeks = Math.floor(days / 7);
  const weekDays = days % 7;

  if (days < 2) return `${totalHours} hours old`;
  if (days < 14) return `${days} days, ${hours} hours old`;
  return `${weeks} weeks, ${weekDays} days old`;
}

function cleanNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = trackerSaveTimeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function postTrackerWithRetry(body: Record<string, unknown>, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchWithTimeout("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, trackerSaveTimeoutMs + attempt * 4_000);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(600);
    }
  }
  throw lastError;
}

function volumeToMl(value: string, unit: VolumeUnit) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(unit === "oz" ? number * 29.5735 : number);
}

function trimVolume(value: number, decimals = 2) {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function volumeForUnit(milliliters: number | null, unit: VolumeUnit) {
  if (milliliters === null || milliliters === undefined) return "";
  return unit === "oz" ? trimVolume(milliliters / 29.5735, 2) : String(milliliters);
}

function solarEventUtc(date: Date, sunrise: boolean) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const dayStart = Date.UTC(year, month, day);
  const dayOfYear = Math.floor((dayStart - Date.UTC(year, 0, 0)) / 86_400_000);
  const longitudeHour = defaultLongitude / 15;
  const approximateTime = dayOfYear + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const meanLongitude = (meanAnomaly + 1.916 * Math.sin(meanAnomaly * Math.PI / 180) + 0.02 * Math.sin(2 * meanAnomaly * Math.PI / 180) + 282.634 + 360) % 360;
  const rightAscension = (Math.atan(0.91764 * Math.tan(meanLongitude * Math.PI / 180)) * 180 / Math.PI + 360) % 360;
  const longitudeQuadrant = Math.floor(meanLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  const adjustedRightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;
  const sinDeclination = 0.39782 * Math.sin(meanLongitude * Math.PI / 180);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const latitudeRadians = defaultLatitude * Math.PI / 180;
  const cosineHourAngle = (Math.cos(90.833 * Math.PI / 180) - sinDeclination * Math.sin(latitudeRadians)) / (cosDeclination * Math.cos(latitudeRadians));
  if (cosineHourAngle > 1 || cosineHourAngle < -1) return null;

  const hourAngle = (sunrise ? 360 - Math.acos(cosineHourAngle) * 180 / Math.PI : Math.acos(cosineHourAngle) * 180 / Math.PI) / 15;
  const localMeanTime = hourAngle + adjustedRightAscension - 0.06571 * approximateTime - 6.622;
  const universalTime = ((localMeanTime - longitudeHour) % 24 + 24) % 24;
  return new Date(dayStart + universalTime * 3_600_000);
}

function isNightAtHome(date: Date) {
  const sunrise = solarEventUtc(date, true);
  const sunset = solarEventUtc(date, false);
  if (!sunrise || !sunset) return false;
  return date < sunrise || date >= sunset;
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function mlToOunces(value: number | null) {
  if (!value) return "";
  return trimVolume(value / 29.5735, 2);
}

const ounceDialValues = Array.from({ length: 48 }, (_, index) => (index + 1) * 0.25);
const milliliterDialValues = Array.from({ length: 72 }, (_, index) => (index + 1) * 5);

function eventStyle(event: TrackerEvent) {
  if (event.type === "medication") {
    return {
      label: "Medication",
      dot: "bg-[#d4547d]",
      block: "border-[#d4547d] bg-[#fff0f5] text-[#9a3054]",
    };
  }
  if (event.type === "feeding") {
    return {
      label: "Feed",
      dot: "bg-[#1a73e8]",
      block: "border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]",
    };
  }
  if (event.type === "diaper" && event.detail === "Wet") {
    return {
      label: "Pee",
      dot: "bg-[#fbbc04]",
      block: "border-[#fbbc04] bg-[#fff7d6] text-[#7a5200]",
    };
  }
  if (event.type === "diaper" && event.detail === "Dirty") {
    return {
      label: "Poop",
      dot: "bg-[#8a5a2b]",
      block: "border-[#8a5a2b] bg-[#f3e5d3] text-[#5f3a16]",
    };
  }
  return {
    label: "Sleep",
    dot: "bg-[#7e57c2]",
    block: "border-[#7e57c2] bg-[#eee7fb] text-[#4d2f83]",
  };
}

function diaperCode(value: string | null) {
  if (!value) return "";
  return value.split(" - ")[0];
}

function plannedFeedInterval(at: Date, settings: Settings) {
  const hour = at.getHours();
  return hour >= Number(settings.dayStartHour) && hour < Number(settings.dayEndHour)
    ? Number(settings.daytimeFeedMinutes)
    : Number(settings.nighttimeFeedMinutes);
}

function nextFeedAfter(start: Date, settings: Settings) {
  return new Date(start.getTime() + plannedFeedInterval(start, settings) * 60_000);
}

function readDeviceCache(): DeviceCache | null {
  try {
    const saved = window.localStorage.getItem(deviceCacheStorageKey);
    return saved ? (JSON.parse(saved) as DeviceCache) : null;
  } catch {
    return null;
  }
}

function writeDeviceCache(cache: Omit<DeviceCache, "savedAt">) {
  try {
    window.localStorage.setItem(
      deviceCacheStorageKey,
      JSON.stringify({ ...cache, savedAt: new Date().toISOString() }),
    );
  } catch {
    // The live database remains the primary record when browser storage is unavailable.
  }
}

function readPendingChanges(): PendingChange[] {
  try {
    const saved = window.localStorage.getItem(pendingChangesStorageKey);
    return saved ? (JSON.parse(saved) as PendingChange[]) : [];
  } catch {
    return [];
  }
}

function writePendingChanges(changes: PendingChange[]) {
  try {
    window.localStorage.setItem(pendingChangesStorageKey, JSON.stringify(changes));
  } catch {
    // Changes remain in memory for this visit if storage is unavailable.
  }
}

export default function BabyTracker() {
  const initialDateKey = new Date().toISOString().slice(0, 10);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [profiles, setProfiles] = useState<TrackerProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileInterval, setProfileInterval] = useState("180");
  const [profileFormulaReminder, setProfileFormulaReminder] = useState(true);
  const [profileNextFeedReminder, setProfileNextFeedReminder] = useState(true);
  const [emailQueueMessage, setEmailQueueMessage] = useState("");
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>([]);
  const [recurringTaskSkips, setRecurringTaskSkips] = useState<string[]>([]);
  const [medicationFavorites, setMedicationFavorites] = useState<MedicationFavorite[]>([]);
  const [selected, setSelected] = useState(quickActions[0]);
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal(new Date()));
  const [endedAt, setEndedAt] = useState("");
  const [amountMl, setAmountMl] = useState("30");
  const [amountUnit, setAmountUnit] = useState<VolumeUnit>("oz");
  const [durationMinutes, setDurationMinutes] = useState("15");
  const [nextFeedMinutes, setNextFeedMinutes] = useState("180");
  const [diaperSize, setDiaperSize] = useState("M - Medium");
  const [diaperColor, setDiaperColor] = useState("M - Mec/black");
  const [diaperLook, setDiaperLook] = useState("SO - Soft");
  const [note, setNote] = useState("");
  const [loggedBy, setLoggedBy] = useState("Parent 1");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDateKey);
  const [composerOpen, setComposerOpen] = useState(false);
  const [medicationComposerOpen, setMedicationComposerOpen] = useState(false);
  const [medicationPanelOpen, setMedicationPanelOpen] = useState(false);
  const [medicationFavoriteComposerOpen, setMedicationFavoriteComposerOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState<TrackerEvent | null>(null);
  const [medicationName, setMedicationName] = useState("");
  const [medicationStrength, setMedicationStrength] = useState("");
  const [medicationDose, setMedicationDose] = useState("");
  const [medicationDoseUnit, setMedicationDoseUnit] = useState("mL");
  const [medicationOccurredAt, setMedicationOccurredAt] = useState(toDateTimeLocal(new Date()));
  const [medicationNote, setMedicationNote] = useState("");
  const [medicationLoggedBy, setMedicationLoggedBy] = useState("Parent 1");
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteStrength, setFavoriteStrength] = useState("");
  const [favoriteDose, setFavoriteDose] = useState("");
  const [favoriteDoseUnit, setFavoriteDoseUnit] = useState("mL");
  const [lastMedicationForShare, setLastMedicationForShare] = useState<TrackerEvent | null>(null);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TrackerEvent | null>(null);
  const [editingTask, setEditingTask] = useState<PlannerTask | null>(null);
  const [editingRecurringTask, setEditingRecurringTask] = useState<RecurringTask | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskScheduledAt, setTaskScheduledAt] = useState(toDateTimeLocal(new Date()));
  const [taskTimeOfDay, setTaskTimeOfDay] = useState(timeOfDayFromDate(new Date()));
  const [taskDuration, setTaskDuration] = useState("30");
  const [taskNote, setTaskNote] = useState("");
  const [taskRepeats, setTaskRepeats] = useState(false);
  const [taskWeekdays, setTaskWeekdays] = useState<number[]>([new Date().getDay()]);
  const [taskRecurringActive, setTaskRecurringActive] = useState(true);
  const [view, setView] = useState<"today" | "calendar" | "log">("today");
  const [timelineNewestFirst, setTimelineNewestFirst] = useState(true);
  const [feedReminder, setFeedReminder] = useState<FeedReminder | null>(null);
  const [feedStartConfirmOpen, setFeedStartConfirmOpen] = useState(false);
  const [editingFeedStartSession, setEditingFeedStartSession] = useState<TrackerEvent | null>(null);
  const [editedFeedStartedAt, setEditedFeedStartedAt] = useState(toDateTimeLocal(new Date()));
  const [finishingFeedSession, setFinishingFeedSession] = useState<TrackerEvent | null>(null);
  const [finishAmountMl, setFinishAmountMl] = useState("");
  const [finishAmountUnit, setFinishAmountUnit] = useState<VolumeUnit>("ml");
  const [finishNote, setFinishNote] = useState("");
  const [finishLoggedBy, setFinishLoggedBy] = useState("Parent 1");
  const [nowMs, setNowMs] = useState(0);
  const [localTodayKey, setLocalTodayKey] = useState(initialDateKey);
  const [themePreference, setThemePreference] = useState<ThemePreference>("auto");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [expectedEventsOpen, setExpectedEventsOpen] = useState(true);
  const [expectedEventsHydrated, setExpectedEventsHydrated] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [syncStatus, setSyncStatus] = useState<"syncing" | "synced" | "offline" | "pending">("syncing");
  const [pendingChangeCount, setPendingChangeCount] = useState(0);

  const saveFeedReminder = useCallback((reminder: FeedReminder | null) => {
    setFeedReminder(reminder);
    if (reminder) {
      window.localStorage.setItem(feedReminderStorageKey, JSON.stringify(reminder));
    } else {
      window.localStorage.removeItem(feedReminderStorageKey);
    }
  }, []);

  const sendReminderNotification = useCallback((title: string, body: string) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }, []);

  const applyTrackerData = useCallback((data: DeviceCache) => {
    setLocked(false);
    setSettings(data.settings ?? emptySettings);
    setEvents(data.events ?? []);
    setTasks(data.tasks ?? []);
    setRecurringTasks(data.recurringTasks ?? []);
    setRecurringTaskSkips(data.recurringTaskSkips ?? []);
    setMedicationFavorites(data.medicationFavorites ?? []);
    const loadedProfiles = (data.profiles ?? []) as TrackerProfile[];
    setProfiles(loadedProfiles);
    const storedProfileId = window.localStorage.getItem(activeProfileStorageKey);
    const currentProfile =
      loadedProfiles.find((profile) => profile.id === storedProfileId) ?? loadedProfiles[0];
    if (currentProfile) {
      setActiveProfileId(currentProfile.id);
      setProfileName(currentProfile.name);
      setProfileInterval(String(currentProfile.nextFeedMinutes));
      setProfileFormulaReminder(currentProfile.formulaReminderEnabled);
      setProfileNextFeedReminder(currentProfile.nextFeedReminderEnabled);
      setLoggedBy(currentProfile.name);
    }
    setSetupOpen(!data.settings?.birthAt);
  }, []);

  const cacheCurrentData = useCallback((next: Omit<DeviceCache, "savedAt">) => {
    writeDeviceCache(next);
  }, []);

  const queueChange = useCallback((body: Record<string, unknown>) => {
    const queued = [...readPendingChanges(), { id: createClientId("change"), method: "POST" as const, body, createdAt: new Date().toISOString() }];
    writePendingChanges(queued);
    setPendingChangeCount(queued.length);
    setSyncStatus("pending");
  }, []);

  const syncPendingChanges = useCallback(async () => {
    const queued = readPendingChanges();
    if (!queued.length) return true;
    const remaining: PendingChange[] = [];
    for (const change of queued) {
      try {
        const response = await postTrackerWithRetry(change.body);
        if (!response.ok) remaining.push(change);
      } catch {
        remaining.push(change);
      }
    }
    writePendingChanges(remaining);
    setPendingChangeCount(remaining.length);
    return remaining.length === 0;
  }, []);

  const loadTracker = useCallback(async () => {
    setLoading(true);
    setSyncStatus("syncing");
    try {
      const pendingSynced = await syncPendingChanges();
      const response = await fetchWithTimeout("/api/tracker", { cache: "no-store" });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Could not reach the tracker");
      const data = await response.json();
      applyTrackerData(data);
      cacheCurrentData({
        settings: data.settings ?? emptySettings,
        profiles: data.profiles ?? [],
        events: data.events ?? [],
        tasks: data.tasks ?? [],
        recurringTasks: data.recurringTasks ?? [],
        recurringTaskSkips: data.recurringTaskSkips ?? [],
        medicationFavorites: data.medicationFavorites ?? [],
      });
      setSyncStatus(pendingSynced ? "synced" : "pending");
    } catch {
      const cached = readDeviceCache();
      if (cached) applyTrackerData(cached);
      setPendingChangeCount(readPendingChanges().length);
      setSyncStatus(readPendingChanges().length ? "pending" : "offline");
    } finally {
      setLoading(false);
    }
  }, [applyTrackerData, cacheCurrentData, syncPendingChanges]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTracker();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadTracker]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" || navigator.onLine) void loadTracker();
    };
    const interval = window.setInterval(() => void loadTracker(), 30_000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadTracker]);

  useEffect(() => {
    if (!loading) {
      cacheCurrentData({ settings, profiles, events, tasks, recurringTasks, recurringTaskSkips, medicationFavorites });
    }
  }, [cacheCurrentData, events, loading, medicationFavorites, profiles, recurringTaskSkips, recurringTasks, settings, tasks]);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      if (typeof Notification === "undefined") {
        setNotificationPermission("unsupported");
        return;
      }
      setNotificationPermission(Notification.permission);
      const savedReminder = window.localStorage.getItem(feedReminderStorageKey);
      if (!savedReminder) return;
      try {
        setFeedReminder(JSON.parse(savedReminder) as FeedReminder);
      } catch {
        window.localStorage.removeItem(feedReminderStorageKey);
      }
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  useEffect(() => {
    const updateClock = () => {
      setNowMs(Date.now());
      const localKey = toDateKey(new Date());
      setLocalTodayKey(localKey);
      setSelectedDate((current) => current === initialDateKey ? localKey : current);
    };
    const initialClock = window.setTimeout(updateClock, 0);
    const interval = window.setInterval(updateClock, 10_000);
    return () => {
      window.clearTimeout(initialClock);
      window.clearInterval(interval);
    };
  }, [initialDateKey]);

  useEffect(() => {
    const initializeTheme = window.setTimeout(() => {
      const saved = window.localStorage.getItem(themePreferenceStorageKey);
      if (saved === "auto" || saved === "light" || saved === "dark") {
        setThemePreference(saved);
      }
      setThemeHydrated(true);
    }, 0);
    return () => window.clearTimeout(initializeTheme);
  }, []);

  useEffect(() => {
    if (themeHydrated) {
      window.localStorage.setItem(themePreferenceStorageKey, themePreference);
    }
  }, [themeHydrated, themePreference]);

  useEffect(() => {
    const initializeExpectedEvents = window.setTimeout(() => {
      const saved = window.localStorage.getItem(expectedEventsStorageKey);
      if (saved === "open" || saved === "closed") {
        setExpectedEventsOpen(saved === "open");
      }
      setExpectedEventsHydrated(true);
    }, 0);
    return () => window.clearTimeout(initializeExpectedEvents);
  }, []);

  useEffect(() => {
    if (expectedEventsHydrated) {
      window.localStorage.setItem(
        expectedEventsStorageKey,
        expectedEventsOpen ? "open" : "closed",
      );
    }
  }, [expectedEventsHydrated, expectedEventsOpen]);

  useEffect(() => {
    if (!feedReminder || !nowMs) return;

    const newestFeed = events.reduce<TrackerEvent | undefined>((latest, event) => {
      if (event.type !== "feeding") return latest;
      if (!latest || new Date(event.occurredAt).getTime() > new Date(latest.occurredAt).getTime()) {
        return event;
      }
      return latest;
    }, undefined);
    if (newestFeed && newestFeed.id !== feedReminder.eventId) return;

    let updated: FeedReminder = feedReminder;
    if (
      feedReminder.formulaReminderEnabled &&
      !feedReminder.formulaNotified &&
      nowMs >= new Date(feedReminder.formulaDueAt).getTime()
    ) {
      sendReminderNotification(
        "Formula time is up",
        "Discard any formula left in the bottle.",
      );
      updated = { ...updated, formulaNotified: true };
    }
    if (
      updated.nextFeedReminderEnabled &&
      !updated.nextFeedNotified &&
      nowMs >= new Date(updated.nextFeedDueAt).getTime()
    ) {
      sendReminderNotification(
        "Next feeding time",
        `${settings.babyName || "Baby"} may be ready for the next bottle.`,
      );
      updated = { ...updated, nextFeedNotified: true };
    }
    if (updated !== feedReminder) {
      const persistUpdate = window.setTimeout(() => saveFeedReminder(updated), 0);
      return () => window.clearTimeout(persistUpdate);
    }
  }, [events, feedReminder, nowMs, saveFeedReminder, sendReminderNotification, settings.babyName]);

  const resolvedTheme = themePreference === "dark"
    ? "dark"
    : themePreference === "light"
      ? "light"
      : nowMs > 0 && isNightAtHome(new Date(nowMs))
        ? "dark"
        : "light";

  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  async function unlockTracker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setUnlockError("");
    const response = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: accessCode }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setUnlockError(data.error ?? "That code did not work. Try again.");
      setSaving(false);
      return;
    }

    setAccessCode("");
    setLocked(false);
    setSaving(false);
    await loadTracker();
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-settings",
        babyName: form.get("babyName"),
        birthAt: fromDateTimeLocal(String(form.get("birthAt") ?? "")),
        dayStartHour: form.get("dayStartHour"),
        dayEndHour: form.get("dayEndHour"),
        daytimeFeedMinutes: form.get("daytimeFeedMinutes"),
        nighttimeFeedMinutes: form.get("nighttimeFeedMinutes"),
        expectedEventsLimit: form.get("expectedEventsLimit"),
      }),
    });
    const data = await response.json();
    if (response.status === 401) {
      setLocked(true);
      setSaving(false);
      return;
    }
    setSettings(data.settings);
    setSetupOpen(false);
    setSaving(false);
  }

  function selectProfile(id: string, choices = profiles) {
    const profile = choices.find((candidate) => candidate.id === id);
    if (!profile) return;
    setActiveProfileId(profile.id);
    window.localStorage.setItem(activeProfileStorageKey, profile.id);
    setProfileName(profile.name);
    setProfileInterval(String(profile.nextFeedMinutes));
    setProfileFormulaReminder(profile.formulaReminderEnabled);
    setProfileNextFeedReminder(profile.nextFeedReminderEnabled);
    setLoggedBy(profile.name);
  }

  function addProfileDraft() {
    setActiveProfileId("");
    setProfileName("");
    setProfileInterval("180");
    setProfileFormulaReminder(true);
    setProfileNextFeedReminder(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileName.trim()) return;
    setSaving(true);
    const response = await fetch("/api/tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-profile",
        id: activeProfileId || undefined,
        name: profileName,
        email: null,
        nextFeedMinutes: Number(profileInterval),
        formulaReminderEnabled: profileFormulaReminder,
        nextFeedReminderEnabled: profileNextFeedReminder,
        emailRemindersEnabled: false,
      }),
    });
    if (response.status === 401) {
      setLocked(true);
      setSaving(false);
      return;
    }
    const data = await response.json();
    const updatedProfiles = (data.profiles ?? []) as TrackerProfile[];
    setProfiles(updatedProfiles);
    const savedProfile = updatedProfiles.find(
      (profile) => profile.id === activeProfileId || profile.name === profileName.trim(),
    );
    if (savedProfile) selectProfile(savedProfile.id, updatedProfiles);
    setSaving(false);
  }

  function openFinishFeedSession(session: TrackerEvent) {
    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    setFinishingFeedSession(session);
    setFinishAmountMl(session.amountMl === null || session.amountMl <= 0 ? "" : volumeForUnit(session.amountMl, "oz"));
    setFinishAmountUnit("oz");
    setFinishNote(session.note ?? "");
    setFinishLoggedBy(profile?.name ?? session.createdBy ?? loggedBy ?? "Parent 1");
  }

  function openFeedStartEditor(session: TrackerEvent) {
    setEditingFeedStartSession(session);
    setEditedFeedStartedAt(toDateTimeLocal(new Date(session.occurredAt)));
  }

  async function saveFeedStartTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = editingFeedStartSession;
    if (!session) return;

    const occurredAt = fromDateTimeLocal(editedFeedStartedAt);
    const occurredAtMs = new Date(occurredAt).getTime();
    if (!Number.isFinite(occurredAtMs) || occurredAtMs > Date.now() + 60_000) {
      setEmailQueueMessage("Choose a bottle start time that is not in the future.");
      return;
    }

    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    const recalculatedNextFeedMinutes = plannedFeedInterval(new Date(occurredAt), settings);
    const updatedSession: TrackerEvent = {
      ...session,
      occurredAt,
      nextFeedMinutes: recalculatedNextFeedMinutes,
    };
    const payload = {
      action: "update-event",
      id: session.id,
      type: "feeding",
      detail: session.detail,
      occurredAt,
      endedAt: null,
      feedingStatus: "in_progress",
      amountMl: null,
      durationMinutes: null,
      nextFeedMinutes: recalculatedNextFeedMinutes,
      diaperSize: null,
      diaperColor: null,
      diaperLook: null,
      note: session.note,
      loggedBy: session.createdBy,
      profileId: activeProfileId,
    };

    setSaving(true);
    setEvents((current) => current.map((item) => item.id === session.id ? updatedSession : item));
    saveFeedReminder(reminderForFeed(updatedSession, profile, updatedSession.createdBy ?? loggedBy, Date.now(), recalculatedNextFeedMinutes));
    setNowMs(Date.now());
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Could not update bottle start time");
      const savedEvent = data.event as TrackerEvent;
      setEvents((current) => current.map((item) => item.id === savedEvent.id ? savedEvent : item));
      saveFeedReminder(reminderForFeed(savedEvent, profile, savedEvent.createdBy ?? loggedBy, Date.now(), recalculatedNextFeedMinutes));
      setEmailQueueMessage("Bottle start time updated. Formula discard and next-feed timers were recalculated.");
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("Bottle start time saved safely on this phone. Timers were updated and the shared record will sync automatically.");
    } finally {
      setEditingFeedStartSession(null);
      setSaving(false);
    }
  }

  async function startFeedSession() {
    if (activeFeedSession) {
      openFinishFeedSession(activeFeedSession);
      return;
    }

    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    const startedAt = new Date().toISOString();
    const scheduledInterval = plannedFeedInterval(new Date(startedAt), settings);
    const localEvent: TrackerEvent = {
      id: createClientId("feed"),
      type: "feeding",
      occurredAt: startedAt,
      endedAt: null,
      detail: "Formula",
      feedingStatus: "in_progress",
      amountMl: null,
      durationMinutes: null,
      nextFeedMinutes: scheduledInterval,
      diaperSize: null,
      diaperColor: null,
      diaperLook: null,
      note: null,
      createdBy: profile?.name ?? (loggedBy || null),
      createdAt: startedAt,
    };
    const payload = {
      id: localEvent.id,
      type: localEvent.type,
      detail: localEvent.detail,
      occurredAt: localEvent.occurredAt,
      endedAt: null,
      feedingStatus: "in_progress",
      amountMl: null,
      durationMinutes: null,
      nextFeedMinutes: scheduledInterval,
      diaperSize: null,
      diaperColor: null,
      diaperLook: null,
      note: null,
      loggedBy: localEvent.createdBy,
      profileId: activeProfileId,
    };

    setSaving(true);
    setEvents((current) => [localEvent, ...current]);
    const startedMs = new Date(startedAt).getTime();
    saveFeedReminder(reminderForFeed(localEvent, profile, loggedBy, startedMs, scheduledInterval));
    setNowMs(startedMs);
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Could not start bottle");
      const savedEvent = data.event as TrackerEvent;
      setEvents((current) => [
        savedEvent,
        ...current.filter((event) => event.id !== localEvent.id && event.id !== savedEvent.id),
      ]);
      saveFeedReminder(reminderForFeed(savedEvent, profile, loggedBy, startedMs, scheduledInterval));
      setEmailQueueMessage(
        data.activeSession
          ? "A bottle was already in progress, so the shared record is open and ready to finish."
          : "Bottle started and saved to the shared timeline. The one-hour formula timer is running.",
      );
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("Bottle started and saved safely on this phone. It will sync to the shared timeline when the connection returns.");
    } finally {
      setSaving(false);
    }
  }

  async function finishFeedSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = finishingFeedSession;
    const completedAmountMl = volumeToMl(finishAmountMl, finishAmountUnit);
    if (!session || completedAmountMl === null || completedAmountMl <= 0) return;

    const finishedAt = new Date().toISOString();
    const durationMinutes = Math.max(
      1,
      Math.round((new Date(finishedAt).getTime() - new Date(session.occurredAt).getTime()) / 60_000),
    );
    const payload = {
      action: "update-event",
      id: session.id,
      type: "feeding",
      detail: session.detail,
      occurredAt: session.occurredAt,
      endedAt: null,
      feedingStatus: "completed",
      amountMl: completedAmountMl,
      durationMinutes,
      nextFeedMinutes: session.nextFeedMinutes,
      diaperSize: null,
      diaperColor: null,
      diaperLook: null,
      note: finishNote,
      loggedBy: finishLoggedBy,
      profileId: activeProfileId,
    };
    const completedLocally: TrackerEvent = {
      ...session,
      feedingStatus: "completed",
      amountMl: completedAmountMl,
      durationMinutes,
      note: finishNote || null,
      createdBy: finishLoggedBy || session.createdBy,
    };

    setSaving(true);
    setEvents((current) => current.map((item) => item.id === session.id ? completedLocally : item));
    try {
      const response = await postTrackerWithRetry(payload);
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Could not finish bottle");
      const savedEvent = data.event as TrackerEvent;
      setEvents((current) => current.map((item) => item.id === savedEvent.id ? savedEvent : item));
      setEmailQueueMessage("Bottle finished and updated on the shared timeline. The next-feed timer is still running.");
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("Bottle finished safely on this phone. If the shared save did not confirm, it will retry automatically.");
      window.setTimeout(() => void loadTracker(), 1_500);
    } finally {
      setFinishingFeedSession(null);
      setSaving(false);
    }
  }

  function openQuickLog(action: (typeof quickActions)[number]) {
    if (action.type === "feeding") {
      if (activeFeedSession) {
        openFinishFeedSession(activeFeedSession);
      } else {
        setFeedStartConfirmOpen(true);
      }
      return;
    }
    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    setSelected(action);
    setEditingEvent(null);
    setOccurredAt(toDateTimeLocal(new Date()));
    setNextFeedMinutes(String(plannedFeedInterval(new Date(), settings)));
    setAmountUnit("oz");
    setLoggedBy(profile?.name ?? "Parent 1");
    setComposerOpen(true);
  }

  function openMedicationComposer(favorite?: MedicationFavorite) {
    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    setEditingMedication(null);
    setMedicationName(favorite?.medicationName ?? "");
    setMedicationStrength(favorite?.strength ?? "");
    setMedicationDose(favorite?.defaultDose ?? "");
    setMedicationDoseUnit(favorite?.defaultDoseUnit ?? "mL");
    setMedicationOccurredAt(toDateTimeLocal(new Date()));
    setMedicationNote("");
    setMedicationLoggedBy(profile?.name ?? loggedBy ?? "Parent 1");
    setMedicationComposerOpen(true);
  }

  function openMedicationEditor(event: TrackerEvent) {
    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    setEditingMedication(event);
    setMedicationName(event.detail);
    setMedicationStrength(event.medicationStrength ?? "");
    setMedicationDose(event.medicationDose ?? "");
    setMedicationDoseUnit(event.medicationUnit ?? "mL");
    setMedicationOccurredAt(toDateTimeLocal(new Date(event.occurredAt)));
    setMedicationNote(event.note ?? "");
    setMedicationLoggedBy(event.createdBy ?? profile?.name ?? loggedBy ?? "Parent 1");
    setMedicationComposerOpen(true);
  }

  function medicationShareText(event: TrackerEvent) {
    const baby = settings.babyName || "Baby";
    const dose = [event.medicationDose, event.medicationUnit].filter(Boolean).join(" ");
    const strength = event.medicationStrength ? ` (${event.medicationStrength})` : "";
    const by = event.createdBy ? ` Logged by ${event.createdBy}.` : "";
    return `${baby} received ${event.detail}${strength} — ${dose} at ${formatTime(event.occurredAt)}.${by}`;
  }

  async function shareMedication(event: TrackerEvent) {
    const text = medicationShareText(event);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Medication logged", text });
        return;
      }
      await navigator.clipboard?.writeText(text);
      setEmailQueueMessage("Medication update copied. Paste it into a message.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setEmailQueueMessage("Couldn’t open sharing. Please try again.");
      }
    }
  }

  async function saveMedication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!medicationName.trim() || !medicationDose.trim()) return;
    const id = editingMedication?.id ?? createClientId("medication");
    const now = new Date().toISOString();
    const payload = {
      action: "save-medication",
      id,
      medicationName,
      strength: medicationStrength,
      dose: medicationDose,
      doseUnit: medicationDoseUnit,
      occurredAt: fromDateTimeLocal(medicationOccurredAt),
      note: medicationNote,
      loggedBy: medicationLoggedBy,
    };
    const localEvent: TrackerEvent = {
      id,
      type: "medication",
      occurredAt: payload.occurredAt,
      endedAt: null,
      detail: medicationName.trim().slice(0, 120),
      feedingStatus: "completed",
      amountMl: null,
      durationMinutes: null,
      nextFeedMinutes: null,
      diaperSize: null,
      diaperColor: null,
      diaperLook: null,
      medicationDose: medicationDose.trim().slice(0, 40),
      medicationUnit: medicationDoseUnit,
      medicationStrength: medicationStrength.trim().slice(0, 120) || null,
      note: medicationNote.trim().slice(0, 500) || null,
      createdBy: medicationLoggedBy.trim() || null,
      createdAt: editingMedication?.createdAt ?? now,
    };
    setSaving(true);
    setEvents((current) => editingMedication
      ? current.map((existing) => existing.id === id ? localEvent : existing)
      : [localEvent, ...current]);
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Medication could not be saved");
      const savedEvent = data.event as TrackerEvent;
      setEvents((current) => editingMedication
        ? current.map((existing) => existing.id === id ? savedEvent : existing)
        : [savedEvent, ...current.filter((existing) => existing.id !== id)]);
      setLastMedicationForShare(savedEvent);
      setMedicationPanelOpen(true);
      setSyncStatus("synced");
      setEmailQueueMessage("Medication saved to the shared timeline.");
    } catch {
      queueChange(payload);
      setLastMedicationForShare(localEvent);
      setMedicationPanelOpen(true);
      setEmailQueueMessage("Medication saved safely on this phone. It will sync to the shared timeline automatically.");
    } finally {
      setMedicationComposerOpen(false);
      setEditingMedication(null);
      setSaving(false);
    }
  }

  async function saveMedicationFavorite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!favoriteName.trim()) return;
    const id = createClientId("medication-favorite");
    const payload = {
      action: "save-medication-favorite",
      id,
      medicationName: favoriteName,
      strength: favoriteStrength,
      defaultDose: favoriteDose,
      defaultDoseUnit: favoriteDoseUnit,
    };
    setSaving(true);
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.favorite) throw new Error(data.error ?? "Favorite could not be saved");
      setMedicationFavorites((current) => [...current.filter((favorite) => favorite.id !== data.favorite.id), data.favorite]);
      setEmailQueueMessage(`${data.favorite.medicationName} added to medication favorites.`);
      setMedicationFavoriteComposerOpen(false);
      setFavoriteName("");
      setFavoriteStrength("");
      setFavoriteDose("");
      setFavoriteDoseUnit("mL");
    } catch {
      setEmailQueueMessage("Couldn’t save that medication favorite. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMedicationFavorite(id: string) {
    setMedicationFavorites((current) => current.filter((favorite) => favorite.id !== id));
    const response = await fetch(`/api/tracker?id=${id}&kind=medication-favorite`, { method: "DELETE" });
    if (response.status === 401) setLocked(true);
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const isSleep = selected.type === "sleep";
    const eventId = editingEvent?.id ?? createClientId("event");
    const payload = {
        action: editingEvent ? "update-event" : undefined,
        id: eventId,
        type: selected.type,
        detail: selected.detail,
        occurredAt: fromDateTimeLocal(occurredAt),
        endedAt: isSleep && endedAt ? fromDateTimeLocal(endedAt) : null,
        feedingStatus: "completed",
        amountMl: selected.type === "feeding" ? volumeToMl(amountMl, amountUnit) : null,
        durationMinutes:
          selected.type === "feeding" ? cleanNumber(durationMinutes) : null,
        nextFeedMinutes:
          selected.type === "feeding" ? cleanNumber(nextFeedMinutes) : null,
        diaperSize:
          selected.type === "diaper" && selected.detail === "Dirty" ? diaperSize : null,
        diaperColor:
          selected.type === "diaper" && selected.detail === "Dirty" ? diaperColor : null,
        diaperLook:
          selected.type === "diaper" && selected.detail === "Dirty" ? diaperLook : null,
        note,
        loggedBy,
        profileId: activeProfileId,
      };
    const localEvent: TrackerEvent = {
      id: eventId,
      type: selected.type,
      occurredAt: fromDateTimeLocal(occurredAt),
      endedAt: isSleep && endedAt ? fromDateTimeLocal(endedAt) : null,
      detail: selected.detail,
      feedingStatus: "completed",
      amountMl: selected.type === "feeding" ? volumeToMl(amountMl, amountUnit) : null,
      durationMinutes: selected.type === "feeding" ? cleanNumber(durationMinutes) : null,
      nextFeedMinutes: selected.type === "feeding" ? cleanNumber(nextFeedMinutes) : null,
      diaperSize: selected.type === "diaper" && selected.detail === "Dirty" ? diaperSize : null,
      diaperColor: selected.type === "diaper" && selected.detail === "Dirty" ? diaperColor : null,
      diaperLook: selected.type === "diaper" && selected.detail === "Dirty" ? diaperLook : null,
      note: note || null,
      createdBy: loggedBy || null,
      createdAt: editingEvent?.createdAt ?? new Date().toISOString(),
    };
    let savedEvent = localEvent;
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        setSaving(false);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Save failed");
      savedEvent = data.event as TrackerEvent;
      if (selected.type === "feeding") setEmailQueueMessage("Bottle saved to the shared timeline. On-screen timers were updated.");
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("Saved safely on this phone. It will sync to the shared timeline automatically when the connection returns.");
    }
    setEvents((current) => editingEvent ? current.map((existing) => (existing.id === savedEvent.id ? savedEvent : existing)) : [savedEvent, ...current]);
    if (selected.type === "feeding" && !editingEvent) {
      const profile = profiles.find((candidate) => candidate.id === activeProfileId);
      saveFeedReminder(reminderForFeed(savedEvent, profile, loggedBy, new Date().getTime(), Number(nextFeedMinutes)));
      setNowMs(Date.now());
    }
    setOccurredAt(toDateTimeLocal(new Date()));
    setEndedAt("");
    setAmountUnit("oz");
    setDurationMinutes("15");
    setNextFeedMinutes("180");
    setDiaperSize("M - Medium");
    setDiaperColor("M - Mec/black");
    setDiaperLook("SO - Soft");
    setNote("");
    setEditingEvent(null);
    setComposerOpen(false);
    setSaving(false);
  }

  async function deleteEvent(id: string) {
    if (feedReminder?.eventId === id) saveFeedReminder(null);
    setEvents((current) => current.filter((event) => event.id !== id));
    const payload = { action: "delete-event", id };
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Delete failed");
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("Delete saved safely on this phone and will sync automatically.");
    }
  }

  function requestDeleteEvent(event: TrackerEvent) {
    const label = event.type === "feeding" ? "feeding" : event.type === "sleep" ? "sleep" : event.type === "medication" ? "medication" : "diaper";
    if (window.confirm(`Delete this ${label} record? It will be removed from the timeline and doctor export.`)) {
      void deleteEvent(event.id);
      if (editingEvent?.id === event.id) {
        setEditingEvent(null);
        setComposerOpen(false);
      }
      if (editingMedication?.id === event.id) {
        setEditingMedication(null);
        setMedicationComposerOpen(false);
      }
    }
  }

  async function exportHistory() {
    setExporting(true);
    try {
      const response = await fetch("/api/tracker?format=csv");
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const file = new File([blob], "baby-tracker-doctor-log.csv", { type: "text/csv" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          files: [file],
          title: "Baby tracker doctor log",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setEmailQueueMessage("Couldn’t export the backup. Please try again.");
      }
    } finally {
      setExporting(false);
    }
  }

  function openTaskComposer(task?: PlannerTask) {
    setEditingTask(task ?? null);
    setEditingRecurringTask(null);
    setTaskTitle(task?.title ?? "");
    const scheduledDate = task ? new Date(task.scheduledAt) : new Date();
    setTaskScheduledAt(toDateTimeLocal(scheduledDate));
    setTaskTimeOfDay(timeOfDayFromDate(scheduledDate));
    setTaskDuration(String(task?.durationMinutes ?? 30));
    setTaskNote(task?.note ?? "");
    setTaskRepeats(false);
    setTaskWeekdays([scheduledDate.getDay()]);
    setTaskRecurringActive(true);
    setTaskComposerOpen(true);
  }

  function openRecurringTaskComposer(task?: RecurringTask) {
    const timeOfDay = task?.timeOfDay ?? timeOfDayFromDate(new Date());
    setEditingTask(null);
    setEditingRecurringTask(task ?? null);
    setTaskTitle(task?.title ?? "");
    setTaskScheduledAt(dateTimeLocalForTimeOfDay(timeOfDay));
    setTaskTimeOfDay(timeOfDay);
    setTaskDuration(String(task?.durationMinutes ?? 30));
    setTaskNote(task?.note ?? "");
    setTaskRepeats(true);
    setTaskWeekdays(task?.weekdays?.length ? task.weekdays : [new Date().getDay()]);
    setTaskRecurringActive(task?.active ?? true);
    setTaskComposerOpen(true);
  }

  function openTaskOrRecurringComposer(task: PlannerTask) {
    const ruleId = task.recurringTaskId ?? recurringRuleIdFromOccurrenceId(task.id);
    const rule = ruleId ? recurringTasks.find((recurringTask) => recurringTask.id === ruleId) : null;
    if (rule && !task.completed) {
      openRecurringTaskComposer(rule);
      setEditingTask(task);
      return;
    }
    openTaskComposer(task);
  }

  function requestDeleteTaskOrRecurring(task: PlannerTask) {
    const isRecurringOccurrence = Boolean(task.recurringTaskId ?? recurringRuleIdFromOccurrenceId(task.id));
    const message = isRecurringOccurrence
      ? `Remove “${task.title}” from today’s schedule? Its future recurring events will stay.`
      : `Delete “${task.title}” from the schedule?`;
    if (!window.confirm(message)) return;
    deleteTaskOrRecurring(task);
    setTaskComposerOpen(false);
    setEditingTask(null);
    setEditingRecurringTask(null);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    if (taskRepeats) {
      await saveRecurringTask();
      return;
    }
    setSaving(true);
    const taskId = editingTask?.id ?? createClientId("task");
    const scheduledAt = fromDateTimeLocal(taskScheduledAt);
    const duration = cleanNumber(taskDuration) ?? 30;
    const taskBody = {
      action: "save-task",
      id: taskId,
      title: taskTitle,
      scheduledAt,
      durationMinutes: duration,
      note: taskNote,
      createdBy: loggedBy,
      completed: editingTask?.completed ?? false,
    };
    const optimisticTask: PlannerTask = {
      id: taskId,
      title: taskTitle.trim().slice(0, 120),
      scheduledAt,
      durationMinutes: duration,
      note: taskNote.trim().slice(0, 500) || null,
      createdBy: loggedBy.trim() || null,
      completed: editingTask?.completed ?? false,
      createdAt: editingTask?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskBody),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Task could not be saved");
      const data = await response.json();
      if (!data.task) throw new Error("Task response was incomplete");
      setTasks((current) => editingTask ? current.map((task) => task.id === data.task.id ? data.task : task) : [...current, data.task]);
      setEmailQueueMessage(editingTask ? "Task updated on the shared schedule." : "Task added to the shared schedule.");
    } catch {
      const queued = readPendingChanges().filter(
        (change) => !(change.body.action === "save-task" && change.body.id === taskId),
      );
      writePendingChanges([
        ...queued,
        { id: `task-${taskId}`, method: "POST", body: taskBody, createdAt: new Date().toISOString() },
      ]);
      setPendingChangeCount(queued.length + 1);
      setTasks((current) => editingTask ? current.map((task) => task.id === taskId ? optimisticTask : task) : [...current, optimisticTask]);
      setEmailQueueMessage("Task saved on this phone. It will sync to the shared schedule automatically when the connection returns.");
    } finally {
      setTaskComposerOpen(false);
      setEditingTask(null);
      setSaving(false);
    }
  }

  async function saveRecurringTask() {
    if (!taskTitle.trim() || !taskWeekdays.length) return;
    setSaving(true);
    const now = new Date().toISOString();
    const recurringTaskId = editingRecurringTask?.id ?? createClientId("recurring");
    const duration = cleanNumber(taskDuration) ?? 30;
    const weekdaysToSave = normalizeWeekdaySelection(taskWeekdays);
    const recurringTaskBody = {
      action: "save-recurring-task",
      id: recurringTaskId,
      title: taskTitle,
      timeOfDay: taskTimeOfDay,
      weekdays: weekdaysToSave,
      durationMinutes: duration,
      note: taskNote,
      createdBy: loggedBy,
      active: taskRecurringActive,
    };
    const optimisticRecurringTask: RecurringTask = {
      id: recurringTaskId,
      title: taskTitle.trim().slice(0, 120),
      timeOfDay: taskTimeOfDay,
      weekdays: weekdaysToSave,
      durationMinutes: duration,
      note: taskNote.trim().slice(0, 500) || null,
      createdBy: loggedBy.trim() || null,
      active: taskRecurringActive,
      createdAt: editingRecurringTask?.createdAt ?? now,
      updatedAt: now,
    };

    setRecurringTasks((current) => current.some((task) => task.id === recurringTaskId)
      ? current.map((task) => task.id === recurringTaskId ? optimisticRecurringTask : task)
      : [...current, optimisticRecurringTask]);

    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recurringTaskBody),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Recurring task could not be saved");
      const data = await response.json();
      if (!data.recurringTask) throw new Error("Recurring task response was incomplete");
      setRecurringTasks((current) => current.some((task) => task.id === data.recurringTask.id)
        ? current.map((task) => task.id === data.recurringTask.id ? data.recurringTask : task)
        : [...current, data.recurringTask]);
      setEmailQueueMessage(editingRecurringTask ? "Recurring task updated on the shared schedule." : "Recurring task added to the shared schedule.");
    } catch {
      const queued = readPendingChanges().filter(
        (change) => !(change.body.action === "save-recurring-task" && change.body.id === recurringTaskId),
      );
      writePendingChanges([
        ...queued,
        { id: `recurring-${recurringTaskId}`, method: "POST", body: recurringTaskBody, createdAt: now },
      ]);
      setPendingChangeCount(queued.length + 1);
      setEmailQueueMessage("Recurring task saved on this phone. It will sync to the shared schedule automatically.");
    } finally {
      setTaskComposerOpen(false);
      setEditingRecurringTask(null);
      setSaving(false);
    }
  }

  async function deleteTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
    const response = await fetch(`/api/tracker?id=${id}&kind=task`, { method: "DELETE" });
    if (response.status === 401) setLocked(true);
  }

  async function deleteRecurringTask(id: string) {
    setRecurringTasks((current) => current.filter((task) => task.id !== id));
    setTasks((current) => current.filter((task) => {
      const ruleId = task.recurringTaskId ?? recurringRuleIdFromOccurrenceId(task.id);
      return task.completed || ruleId !== id;
    }));
    const response = await fetch(`/api/tracker?id=${id}&kind=recurring-task`, { method: "DELETE" });
    if (response.status === 401) setLocked(true);
  }

  function requestDeleteRecurringTask(task: RecurringTask) {
    if (window.confirm(`Remove “${task.title}” from every future recurring schedule? This cannot be undone.`)) {
      void deleteRecurringTask(task.id);
      setEmailQueueMessage("Recurring task removed from the shared schedule.");
    }
  }

  async function skipRecurringTaskOccurrence(task: PlannerTask, ruleId: string) {
    const dateKey = dateKeyFromIso(task.scheduledAt);
    const skipKey = `${ruleId}:${dateKey}`;
    setRecurringTaskSkips((current) => current.includes(skipKey) ? current : [...current, skipKey]);
    const payload = { action: "skip-recurring-task", recurringTaskId: ruleId, dateKey };
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Recurring occurrence could not be skipped");
      setSyncStatus("synced");
      setEmailQueueMessage("This occurrence was removed. Future recurring tasks stay on the schedule.");
    } catch {
      queueChange(payload);
      setEmailQueueMessage("This occurrence was removed on this phone and will sync automatically.");
    }
  }

  function deleteTaskOrRecurring(task: PlannerTask) {
    const ruleId = task.recurringTaskId ?? recurringRuleIdFromOccurrenceId(task.id);
    if (ruleId && !task.completed) {
      void skipRecurringTaskOccurrence(task, ruleId);
      return;
    }
    void deleteTask(task.id);
  }

  async function toggleTaskCompleted(task: PlannerTask) {
    const nextCompleted = !task.completed;
    const now = new Date().toISOString();
    const updatedTask: PlannerTask = {
      ...task,
      completed: nextCompleted,
      updatedAt: now,
    };
    const payload = {
      action: "save-task",
      id: task.id,
      title: task.title,
      scheduledAt: task.scheduledAt,
      durationMinutes: task.durationMinutes,
      note: task.note ?? "",
      createdBy: task.createdBy ?? loggedBy,
      completed: nextCompleted,
    };

    setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? updatedTask : item)
      : [...current, updatedTask]);

    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error("Task completion could not be saved");
      const data = await response.json();
      if (!data.task) throw new Error("Task response was incomplete");
      setTasks((current) => current.some((item) => item.id === data.task.id)
        ? current.map((item) => item.id === data.task.id ? data.task : item)
        : [...current, data.task]);
      setEmailQueueMessage(nextCompleted ? "Task marked done on the shared timeline." : "Task moved back to expected events.");
    } catch {
      const queued = readPendingChanges().filter(
        (change) => !(change.body.action === "save-task" && change.body.id === task.id),
      );
      writePendingChanges([
        ...queued,
        { id: `task-${task.id}`, method: "POST", body: payload, createdAt: now },
      ]);
      setPendingChangeCount(queued.length + 1);
      setEmailQueueMessage(nextCompleted ? "Task marked done on this phone. It will sync automatically." : "Task reopened on this phone. It will sync automatically.");
    }
  }

  function openEditEvent(event: TrackerEvent) {
    if (event.type === "medication") {
      openMedicationEditor(event);
      return;
    }
    const action =
      event.type === "feeding"
        ? quickActions[0]
        : event.type === "diaper" && event.detail === "Wet"
          ? quickActions[1]
          : event.type === "diaper"
            ? quickActions[2]
            : quickActions[3];
    setEditingEvent(event);
    setSelected(action);
    setOccurredAt(toDateTimeLocal(new Date(event.occurredAt)));
    setEndedAt(event.endedAt ? toDateTimeLocal(new Date(event.endedAt)) : "");
    setAmountMl(event.amountMl ? volumeForUnit(event.amountMl, "oz") : "");
    setAmountUnit("oz");
    setDurationMinutes(event.durationMinutes ? String(event.durationMinutes) : "");
    setNextFeedMinutes(event.nextFeedMinutes ? String(event.nextFeedMinutes) : String(plannedFeedInterval(new Date(event.occurredAt), settings)));
    setDiaperSize(event.diaperSize ?? "M - Medium");
    setDiaperColor(event.diaperColor ?? "M - Mec/black");
    setDiaperLook(event.diaperLook ?? "SO - Soft");
    setNote((event.note ?? "").replace(/; ?paced and burped$/, ""));
    setLoggedBy(event.createdBy ?? "");
    setComposerOpen(true);
  }

  async function stopSleep(event: TrackerEvent) {
    if (event.type !== "sleep" || event.endedAt) return;
    setSaving(true);
    const payload = {
        action: "update-event",
        id: event.id,
        type: event.type,
        detail: event.detail,
        occurredAt: event.occurredAt,
        endedAt: new Date().toISOString(),
        amountMl: event.amountMl,
        durationMinutes: event.durationMinutes,
        diaperSize: event.diaperSize,
        diaperColor: event.diaperColor,
        diaperLook: event.diaperLook,
        note: event.note,
        loggedBy: event.createdBy,
        profileId: activeProfileId,
      };
    const stoppedLocally = { ...event, endedAt: payload.endedAt };
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setLocked(true);
        setSaving(false);
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.event) throw new Error(data.error ?? "Could not stop sleep");
      setEvents((current) => current.map((existing) => (existing.id === data.event.id ? data.event : existing)));
      setSyncStatus("synced");
    } catch {
      queueChange(payload);
      setEvents((current) => current.map((existing) => (existing.id === event.id ? stoppedLocally : existing)));
      setEmailQueueMessage("Sleep end saved safely on this phone and will sync to the shared timeline automatically.");
    }
    setSaving(false);
  }

  const today = useMemo(() => {
    const start = dateFromKey(localTodayKey);
    start.setHours(0, 0, 0, 0);

    const todaysEvents = events.filter(
      (event) => new Date(event.occurredAt).getTime() >= start.getTime(),
    );
    const feedings = todaysEvents.filter((event) => event.type === "feeding");
    const diapers = todaysEvents.filter((event) => event.type === "diaper");
    const sleepMinutes = todaysEvents
      .filter((event) => event.type === "sleep")
      .reduce((sum, event) => sum + minutesBetween(event.occurredAt, event.endedAt), 0);

    return {
      feedings: feedings.length,
      ounces: feedings.reduce((sum, event) => sum + Number(mlToOunces(event.amountMl) || 0), 0),
      diapers: diapers.length,
      sleep: formatDuration(sleepMinutes),
    };
  }, [events, localTodayKey]);

  const activeSleep = useMemo(
    () => events.find((event) => event.type === "sleep" && !event.endedAt),
    [events],
  );

  const activeFeedSession = events.reduce<TrackerEvent | undefined>((active, event) => {
    if (event.type !== "feeding" || event.feedingStatus !== "in_progress") return active;
    if (!active || new Date(event.occurredAt).getTime() > new Date(active.occurredAt).getTime()) {
      return event;
    }
    return active;
  }, undefined);

  const latestFeedEvent = useMemo(() => {
    const activeFeed = events.reduce<TrackerEvent | undefined>((active, event) => {
      if (event.type !== "feeding" || event.feedingStatus !== "in_progress") return active;
      if (!active || new Date(event.occurredAt).getTime() > new Date(active.occurredAt).getTime()) return event;
      return active;
    }, undefined);
    return activeFeed ?? events.reduce<TrackerEvent | undefined>((latest, event) => {
      if (event.type !== "feeding") return latest;
      if (!latest || new Date(event.occurredAt).getTime() > new Date(latest.occurredAt).getTime()) {
        return event;
      }
      return latest;
    }, undefined);
  }, [events]);

  const visibleFeedReminder = useMemo(() => {
    if (!latestFeedEvent) return null;
    const matchingProfile = profiles.find(
      (profile) => profile.name.toLowerCase() === latestFeedEvent.createdBy?.toLowerCase(),
    ) ?? profiles.find((profile) => profile.id === activeProfileId);
    const fallbackInterval = plannedFeedInterval(new Date(latestFeedEvent.occurredAt), settings);
    const currentReminder = reminderForFeed(
      latestFeedEvent,
      matchingProfile,
      latestFeedEvent.createdBy ?? loggedBy,
      nowMs,
      fallbackInterval,
    );
    const savedReminderMatchesFeed = feedReminder?.eventId === currentReminder.eventId
      && feedReminder.formulaDueAt === currentReminder.formulaDueAt
      && feedReminder.nextFeedDueAt === currentReminder.nextFeedDueAt
      && feedReminder.nextFeedMinutes === currentReminder.nextFeedMinutes;

    // A corrected bottle start must replace both deadlines, not reuse an old
    // device-local countdown from the same feed.
    return savedReminderMatchesFeed ? feedReminder : currentReminder;
  }, [activeProfileId, feedReminder, latestFeedEvent, loggedBy, nowMs, profiles, settings]);

  useEffect(() => {
    if (loading) return;
    if (!visibleFeedReminder) {
      if (feedReminder) {
        const clearTimer = window.setTimeout(() => saveFeedReminder(null), 0);
        return () => window.clearTimeout(clearTimer);
      }
      return;
    }
    if (
      feedReminder?.eventId !== visibleFeedReminder.eventId ||
      feedReminder.nextFeedDueAt !== visibleFeedReminder.nextFeedDueAt ||
      feedReminder.formulaDueAt !== visibleFeedReminder.formulaDueAt
    ) {
      const saveTimer = window.setTimeout(() => saveFeedReminder(visibleFeedReminder), 0);
      return () => window.clearTimeout(saveTimer);
    }
  }, [feedReminder, loading, saveFeedReminder, visibleFeedReminder]);

  const visibleActiveFeedSession = activeFeedSession;

  const predictedFeeds = useMemo(() => {
    const activeFeed = events.reduce<TrackerEvent | undefined>((active, event) => {
      if (event.type !== "feeding" || event.feedingStatus !== "in_progress") return active;
      if (!active || new Date(event.occurredAt).getTime() > new Date(active.occurredAt).getTime()) return event;
      return active;
    }, undefined);
    const lastFeed = activeFeed ?? events
      .filter((event) => event.type === "feeding")
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
    if (!lastFeed) return [] as string[];

    const referenceNow = new Date(nowMs || 0);
    const endOfTomorrow = new Date(referenceNow);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    endOfTomorrow.setHours(23, 59, 59, 999);
    const predicted: string[] = [];
    let cursor = new Date(lastFeed.occurredAt);
    for (let attempts = 0; attempts < 12; attempts += 1) {
      cursor = nextFeedAfter(cursor, settings);
      if (cursor.getTime() > endOfTomorrow.getTime()) break;
      if (cursor.getTime() > referenceNow.getTime()) predicted.push(cursor.toISOString());
    }
    return predicted;
  }, [events, nowMs, settings]);

  const recurringRulesById = useMemo(() => {
    return recurringTasks.reduce<Record<string, RecurringTask>>((rules, task) => {
      rules[task.id] = task;
      return rules;
    }, {});
  }, [recurringTasks]);

  const tasksWithRecurringDetails = useMemo(() => {
    return tasks.map((task) => {
      const ruleId = task.recurringTaskId ?? recurringRuleIdFromOccurrenceId(task.id);
      const rule = ruleId ? recurringRulesById[ruleId] : null;
      return rule
        ? {
          ...task,
          recurringTaskId: rule.id,
          recurrenceLabel: recurringSummary(rule),
        }
        : task;
    });
  }, [recurringRulesById, tasks]);

  const skippedRecurringOccurrences = useMemo(
    () => new Set(recurringTaskSkips),
    [recurringTaskSkips],
  );

  const todayPlan = useMemo(() => {
    const todayKey = localTodayKey;
    const tomorrow = dateFromKey(localTodayKey);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = toDateKey(tomorrow);
    const dateKeys = [todayKey, tomorrowKey];
    const existingTaskIds = new Set(tasksWithRecurringDetails.map((task) => task.id));
    const actual = events
      .filter((event) => dateKeys.includes(dateKeyFromIso(event.occurredAt)))
      .map((event) => ({ kind: "event" as const, at: event.occurredAt, event }));
    const feeds = predictedFeeds.map((at) => ({
      kind: "prediction" as const,
      at,
      dayLabel: dateKeyFromIso(at) === tomorrowKey ? "Tomorrow" : "Today",
    }));
    const recurringExpectedTasks = recurringTasksForDateKeys(recurringTasks, dateKeys, existingTaskIds, skippedRecurringOccurrences);
    const tasksForToday = [...tasksWithRecurringDetails, ...recurringExpectedTasks]
      .filter((task) => dateKeys.includes(dateKeyFromIso(task.scheduledAt)))
      .map((task) => ({
        kind: task.completed ? "completed-task" as const : "task" as const,
        at: task.scheduledAt,
        task,
      }));
    return [...actual, ...feeds, ...tasksForToday].sort((a, b) => {
      const difference = new Date(b.at).getTime() - new Date(a.at).getTime();
      return timelineNewestFirst ? difference : -difference;
    });
  }, [events, localTodayKey, predictedFeeds, recurringTasks, skippedRecurringOccurrences, tasksWithRecurringDetails, timelineNewestFirst]);

  const actualTodayPlan = useMemo(
    () => todayPlan.filter((item) => item.kind === "event" || item.kind === "completed-task"),
    [todayPlan],
  );
  const expectedTodayPlan = useMemo(
    () => {
      const rollingStartMs = (nowMs || 0) - 60_000;
      return todayPlan
        .filter((item) => item.kind === "prediction" || item.kind === "task")
        .filter((item) => new Date(item.at).getTime() >= rollingStartMs)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    },
    [nowMs, todayPlan],
  );
  const expectedEventsLimit = expectedEventsLimitFromSettings(settings);
  const visibleExpectedTodayPlan = useMemo(
    () => expectedTodayPlan.slice(0, expectedEventsLimit).reverse(),
    [expectedEventsLimit, expectedTodayPlan],
  );
  const hiddenExpectedEventCount = Math.max(expectedTodayPlan.length - visibleExpectedTodayPlan.length, 0);

  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, TrackerEvent[]>>((grouped, event) => {
      const key = dateKeyFromIso(event.occurredAt);
      grouped[key] = [...(grouped[key] ?? []), event];
      return grouped;
    }, {});
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    return [...(eventsByDate[selectedDate] ?? [])].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }, [eventsByDate, selectedDate]);

  const selectedDayPredictedFeeds = useMemo(
    () => predictedFeeds.filter((at) => dateKeyFromIso(at) === selectedDate),
    [predictedFeeds, selectedDate],
  );

  const selectedDayTasks = useMemo(
    () => {
      const existingTaskIds = new Set(tasksWithRecurringDetails.map((task) => task.id));
      const generatedTasks = recurringTasksForDateKeys(recurringTasks, [selectedDate], existingTaskIds, skippedRecurringOccurrences);
      return [...tasksWithRecurringDetails, ...generatedTasks]
      .filter((task) => dateKeyFromIso(task.scheduledAt) === selectedDate)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    },
    [recurringTasks, selectedDate, skippedRecurringOccurrences, tasksWithRecurringDetails],
  );

  const selectedDaySchedule = useMemo(() => [
    ...selectedDayEvents.map((event) => ({ kind: "event" as const, at: event.occurredAt, event })),
    ...selectedDayPredictedFeeds.map((at) => ({ kind: "prediction" as const, at })),
    ...selectedDayTasks.map((task) => ({ kind: "task" as const, at: task.scheduledAt, task })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), [selectedDayEvents, selectedDayPredictedFeeds, selectedDayTasks]);

  const selectedDayTotals = useMemo(() => {
    const feedings = selectedDayEvents.filter((event) => event.type === "feeding");
    const diapers = selectedDayEvents.filter((event) => event.type === "diaper");
    const sleepMinutes = selectedDayEvents
      .filter((event) => event.type === "sleep")
      .reduce((sum, event) => sum + minutesBetween(event.occurredAt, event.endedAt), 0);

    return {
      feedings: feedings.length,
      milliliters: feedings.reduce((sum, event) => sum + (event.amountMl ?? 0), 0),
      diapers: diapers.length,
      sleep: formatDuration(sleepMinutes),
    };
  }, [selectedDayEvents]);

  const calendarDays = useMemo(() => {
    const selected = dateFromKey(selectedDate);
    const firstOfMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const firstGridDay = new Date(firstOfMonth);
    firstGridDay.setDate(firstGridDay.getDate() - firstOfMonth.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstGridDay);
      date.setDate(firstGridDay.getDate() + index);
      const key = toDateKey(date);
      const dayEvents = eventsByDate[key] ?? [];
      const existingTaskIds = new Set(tasksWithRecurringDetails.map((task) => task.id));
      const dayRecurringTasks = recurringTasksForDateKeys(recurringTasks, [key], existingTaskIds, skippedRecurringOccurrences);
      const dayTasks = tasksWithRecurringDetails.filter((task) => dateKeyFromIso(task.scheduledAt) === key);
      const dayExpectedFeeds = predictedFeeds.filter((at) => dateKeyFromIso(at) === key);
      const taskCount = dayTasks.length + dayRecurringTasks.length;

      return {
        key,
        date,
        isCurrentMonth: date.getMonth() === selected.getMonth(),
        isToday: key === localTodayKey,
        count: dayEvents.length + taskCount + dayExpectedFeeds.length,
        feeds: dayEvents.filter((event) => event.type === "feeding").length,
        expectedFeeds: dayExpectedFeeds.length,
        pee: dayEvents.filter(
          (event) => event.type === "diaper" && event.detail === "Wet",
        ).length,
        poop: dayEvents.filter(
          (event) => event.type === "diaper" && event.detail === "Dirty",
        ).length,
        sleeps: dayEvents.filter((event) => event.type === "sleep").length,
        tasks: taskCount,
      };
    });
  }, [eventsByDate, localTodayKey, predictedFeeds, recurringTasks, selectedDate, skippedRecurringOccurrences, tasksWithRecurringDetails]);

  function shiftMonth(offset: number) {
    const selected = dateFromKey(selectedDate);
    const next = new Date(selected.getFullYear(), selected.getMonth() + offset, 1);
    setSelectedDate(toDateKey(next));
  }

  if (locked) {
    return (
      <main className={`flex min-h-[100svh] items-center justify-center bg-[#f7f8fc] px-4 py-10 text-[#172033] ${resolvedTheme === "dark" ? "tracker-dark" : ""}`}>
        <section className="w-full max-w-md rounded-[30px] bg-white p-6 shadow-sm ring-1 ring-[#e8ebf2]">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#e8edff] text-[#3559d9]">
            <Baby size={30} />
          </div>
          <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-[#68718a]">
            Private family tracker
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            Enter the family code
          </h1>
          <p className="mt-3 text-base leading-7 text-[#657089]">
            The site link can be opened publicly, but baby records stay hidden until
            someone unlocks this device.
          </p>
          <form className="mt-6 space-y-4" onSubmit={unlockTracker}>
            <label className="field-label">
              Access code
              <input
                autoComplete="one-time-code"
                inputMode="text"
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Family code"
                value={accessCode}
              />
            </label>
            {unlockError ? (
              <p className="rounded-2xl bg-[#fff0ef] px-4 py-3 text-sm font-semibold text-[#9b2d22]">
                {unlockError}
              </p>
            ) : null}
            <button
              className="flex w-full items-center justify-center rounded-2xl bg-[#3559d9] px-5 py-4 text-lg font-bold text-white disabled:opacity-60"
              disabled={saving || !accessCode.trim()}
              type="submit"
            >
              {saving ? "Unlocking..." : "Unlock tracker"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={`min-h-[100svh] bg-[#f7f8fc] pb-24 text-[#172033] ${resolvedTheme === "dark" ? "tracker-dark" : ""}`}>
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8edff] text-[#3559d9]"><Baby size={24} /></div>
            <div><p className="text-sm font-semibold text-[#68718a]">{settings.babyName || "Baby"}</p><h1 className="text-xl font-bold">{babyAge(settings.birthAt)}</h1></div>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label={`Appearance: ${themePreference === "auto" ? "automatic" : themePreference}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#52607a] shadow-sm ring-1 ring-[#e8ebf2]" onClick={() => setThemePreference((current) => current === "auto" ? "dark" : current === "dark" ? "light" : "auto")} title={`Appearance: ${themePreference === "auto" ? "automatic" : themePreference}`} type="button">{resolvedTheme === "dark" ? <Moon size={20} /> : <Sun size={20} />}</button>
            <button aria-label="Baby settings" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#52607a] shadow-sm ring-1 ring-[#e8ebf2]" onClick={() => setSetupOpen((open) => !open)} type="button"><Settings2 size={21} /></button>
          </div>
        </header>

        {setupOpen ? <>
          <form className="mt-5 grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2] sm:grid-cols-2" onSubmit={saveSettings}>
            <label className="field-label">Baby name<input defaultValue={settings.babyName} name="babyName" placeholder="Baby" /></label>
            <label className="field-label">Birth date and time<input defaultValue={settings.birthAt ? toDateTimeLocal(new Date(settings.birthAt)) : ""} name="birthAt" required type="datetime-local" /></label>
            <div className="sm:col-span-2 rounded-xl bg-[#eef3ff] p-3">
              <p className="text-sm font-bold text-[#294b9c]">FEED PLAN</p>
              <p className="mt-1 text-sm font-semibold text-[#53617a]">Used for Today&apos;s upcoming feeds, expected events, and on-screen timers.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="field-label">Daytime starts<select defaultValue={settings.dayStartHour} name="dayStartHour"><option value="6">6 AM</option><option value="7">7 AM</option><option value="8">8 AM</option><option value="9">9 AM</option></select></label>
                <label className="field-label">Nighttime starts<select defaultValue={settings.dayEndHour} name="dayEndHour"><option value="18">6 PM</option><option value="19">7 PM</option><option value="20">8 PM</option><option value="21">9 PM</option><option value="22">10 PM</option></select></label>
                <label className="field-label">Daytime feed spacing<select defaultValue={settings.daytimeFeedMinutes} name="daytimeFeedMinutes"><option value="120">Every 2 hours</option><option value="180">Every 3 hours</option><option value="240">Every 4 hours</option></select></label>
                <label className="field-label">Nighttime feed spacing<select defaultValue={settings.nighttimeFeedMinutes} name="nighttimeFeedMinutes"><option value="180">Every 3 hours</option><option value="240">Every 4 hours</option><option value="300">Every 5 hours</option></select></label>
                <label className="field-label sm:col-span-2">Expected events shown<input defaultValue={settings.expectedEventsLimit || emptySettings.expectedEventsLimit} inputMode="numeric" max="30" min="1" name="expectedEventsLimit" step="1" type="number" /><small>Default is 6. Increase this when you want a longer planning list above the timeline.</small></label>
              </div>
            </div>
            <div className="sm:col-span-2 rounded-xl bg-[#f3f5fa] p-3">
              <label className="field-label">Appearance<select onChange={(event) => setThemePreference(event.target.value as ThemePreference)} value={themePreference}><option value="auto">Automatic: sunrise / sunset</option><option value="light">Always light</option><option value="dark">Always dark</option></select><small>Automatic uses a general sunrise and sunset estimate. This choice is saved on this phone.</small></label>
            </div>
            <button className="self-end rounded-xl bg-[#3559d9] px-5 py-3 font-bold text-white sm:col-span-2" disabled={saving} type="submit">Save baby & feed plan</button>
          </form>
          <form className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2]" onSubmit={saveProfile}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-[#68718a]">PEOPLE & TIMERS</p><h2 className="mt-1 text-xl font-bold">Who is using this phone?</h2></div><button className="rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={addProfileDraft} type="button">Add person</button></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="field-label">Active profile<select onChange={(event) => selectProfile(event.target.value)} value={activeProfileId}><option value="" disabled>Select a person</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><small>This phone will use this person&apos;s defaults.</small></label>
              <label className="field-label">Name<input onChange={(event) => setProfileName(event.target.value)} placeholder="Name" value={profileName} /></label>
              <label className="field-label">Default next feed<select onChange={(event) => setProfileInterval(event.target.value)} value={profileInterval}><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label>
              <div className="grid gap-2 rounded-xl bg-[#f3f5fa] p-3 text-sm font-bold text-[#4d5870] sm:col-span-2"><label className="flex items-center gap-2"><input checked={profileFormulaReminder} onChange={(event) => setProfileFormulaReminder(event.target.checked)} type="checkbox" />Formula discard timer</label><label className="flex items-center gap-2"><input checked={profileNextFeedReminder} onChange={(event) => setProfileNextFeedReminder(event.target.checked)} type="checkbox" />Next feed timer</label><p className="text-xs font-semibold text-[#778197]">These are on-screen/browser timers. Email reminders have been removed.</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="rounded-xl bg-[#3559d9] px-5 py-3 font-bold text-white disabled:opacity-60" disabled={saving || !profileName.trim()} type="submit">Save person&apos;s settings</button>
            </div>
          </form>
          <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2]">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-[#68718a]">RECURRING TASKS</p><h2 className="mt-1 text-xl font-bold">Manage the whole series</h2><p className="mt-1 text-sm font-semibold text-[#778197]">Deleting a task from Today skips only that day. Remove a whole series here.</p></div><button className="rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={() => openRecurringTaskComposer()} type="button"><Plus className="mr-1 inline" size={15} />Add</button></div>
            <div className="mt-4 space-y-2">
              {recurringTasks.map((task) => <div className="flex items-center gap-3 rounded-xl bg-[#fff8fa] p-3" key={task.id}><div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#ffe7ee] text-[#a23456]"><Repeat2 size={17} /></div><div className="min-w-0 flex-1"><p className="font-bold">{task.title}</p><p className="text-xs font-semibold text-[#8d7080]">{recurringSummary(task)} · {formatTime(occurrenceAtForDateKey(task, localTodayKey))}</p></div><button aria-label={`Remove ${task.title} recurring series`} className="flex h-8 w-8 items-center justify-center rounded-full text-[#a0352b]" onClick={() => requestDeleteRecurringTask(task)} title="Remove all future occurrences" type="button"><Trash2 size={15} /></button></div>)}
              {!recurringTasks.length ? <p className="rounded-xl bg-[#f5f6fa] px-3 py-4 text-sm font-semibold text-[#68718a]">No recurring tasks yet.</p> : null}
            </div>
          </section>
          <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2]">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-[#68718a]">MEDICATION FAVORITES</p><h2 className="mt-1 text-xl font-bold">Keep common medicines ready</h2><p className="mt-1 text-sm font-semibold text-[#778197]">Favorites prefill the medication name, strength, and dose. Confirm the dose before every log.</p></div><button className="rounded-xl bg-[#fff0f5] px-3 py-2 text-sm font-bold text-[#a23456]" onClick={() => setMedicationFavoriteComposerOpen(true)} type="button"><Plus className="mr-1 inline" size={15} />Add</button></div>
            <div className="mt-4 flex flex-wrap gap-2">{medicationFavorites.map((favorite) => <span className="inline-flex items-center gap-1 rounded-xl bg-[#fff8fa] py-1.5 pl-3 pr-1 text-sm font-bold text-[#8f3554]" key={favorite.id}>{favorite.medicationName}{favorite.strength ? ` · ${favorite.strength}` : ""}<button aria-label={`Remove ${favorite.medicationName} favorite`} className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[#a0352b]" onClick={() => void deleteMedicationFavorite(favorite.id)} type="button"><Trash2 size={14} /></button></span>)}</div>
          </section>
        </> : null}

        <nav className="sticky top-2 z-10 mt-5 grid grid-cols-3 rounded-2xl bg-[#e9ecf4]/95 p-1 text-sm font-bold shadow-sm backdrop-blur sm:static sm:mt-6 sm:shadow-none" aria-label="Tracker views">
          <ViewButton active={view === "today"} icon={<Clock3 size={17} />} label="Today" onClick={() => setView("today")} />
          <ViewButton active={view === "calendar"} icon={<CalendarDays size={17} />} label="Calendar" onClick={() => setView("calendar")} />
          <ViewButton active={view === "log"} icon={<Table2 size={17} />} label="Log" onClick={() => setView("log")} />
        </nav>

        {view === "today" ? <>
          <section className="mt-7">
            <p className="text-sm font-bold text-[#68718a]">QUICK LOG</p>
            <h2 className="mt-1 text-2xl font-bold">What happened?</h2>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
              {quickActions.map((action) => <button key={action.label} className={`action-card action-${action.label.toLowerCase()}`} onClick={() => openQuickLog(action)} type="button"><ActionIcon label={action.label} /><span>{action.label}</span><small>{action.helper}</small></button>)}
            </div>
          </section>

          {activeSleep ? <section className="mt-4 rounded-2xl bg-[#eeeafd] p-4 text-[#4d2f83]">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide">Sleep in progress</p><p className="mt-1 text-2xl font-black">{formatDuration(minutesBetween(activeSleep.occurredAt, null))}</p><p className="mt-1 text-sm font-semibold">Started {formatTime(activeSleep.occurredAt)}</p></div><button className="rounded-xl bg-[#5a43aa] px-4 py-3 font-bold text-white disabled:opacity-60" disabled={saving} onClick={() => void stopSleep(activeSleep)} type="button">Stop sleep</button></div>
          </section> : null}

          <section className="mt-7">
            <div className="flex items-end justify-between"><div><p className="text-sm font-bold text-[#68718a]">TODAY</p><h2 className="mt-1 text-2xl font-bold">A quick glance</h2></div><span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-[#68718a] shadow-sm">{formatSelectedDay(localTodayKey)}</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
              <Summary icon={<Milk size={19} />} label="Feeds" value={String(today.feedings)} sub={`${today.ounces.toFixed(1)} oz`} tone="blue" />
              <Summary icon={<Droplets size={19} />} label="Diapers" value={String(today.diapers)} sub="wet + dirty" tone="yellow" />
              <Summary icon={<Moon size={19} />} label="Sleep" value={today.sleep} sub="logged" tone="purple" />
            </div>
          </section>

          <FeedReminderPanel
            activeSession={visibleActiveFeedSession}
            babyName={settings.babyName || "Baby"}
            nowMs={nowMs}
            notificationPermission={notificationPermission}
            onDismissFormula={() => visibleFeedReminder && saveFeedReminder({ ...visibleFeedReminder, formulaNotified: true, formulaReminderEnabled: false })}
            onEditStartTime={() => visibleActiveFeedSession && openFeedStartEditor(visibleActiveFeedSession)}
            onEnableNotifications={() => void enableNotifications()}
            onFinishSession={() => visibleActiveFeedSession && openFinishFeedSession(visibleActiveFeedSession)}
            reminder={visibleFeedReminder}
          />

          {emailQueueMessage ? <p className={`mt-3 rounded-xl px-4 py-3 text-sm font-bold ${emailQueueMessage.startsWith("Could") || emailQueueMessage.startsWith("Choose") ? "bg-[#fff0ef] text-[#9b2d22]" : "bg-[#e8f5f1] text-[#167a63]"}`}>{emailQueueMessage}</p> : null}

          <section className="mt-7 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2]">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-[#68718a]">TODAY + TOMORROW</p><h2 className="mt-1 text-xl font-bold">Timeline</h2></div><div className="flex flex-wrap items-center justify-end gap-2"><button aria-label={timelineNewestFirst ? "Show earliest first" : "Show most recent first"} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5f6fa] text-[#5d6a84]" onClick={() => setTimelineNewestFirst((current) => !current)} title={timelineNewestFirst ? "Newest first" : "Earliest first"} type="button"><ArrowDownUp size={18} /></button><button className="flex items-center gap-1 rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={() => openRecurringTaskComposer()} type="button"><Repeat2 size={16} />Recurring</button><button className="flex items-center gap-1 rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={() => openTaskComposer()} type="button"><Plus size={16} />Task</button></div></div>
            <p className="mt-2 text-sm font-semibold text-[#778197]">Expected feeds and planned tasks are grouped above your logged history. You&apos;ll see through tomorrow, and the feed plan resets after every bottle.</p>
            <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${syncStatus === "synced" ? "bg-[#e8f5f1] text-[#167a63]" : "bg-[#fff7df] text-[#896300]"}`}>
              {syncStatus === "synced" ? <Cloud size={15} /> : <CloudOff size={15} />}
              {syncStatus === "synced" ? "Synced across devices" : syncStatus === "syncing" ? "Checking shared timeline…" : pendingChangeCount ? `${pendingChangeCount} change${pendingChangeCount === 1 ? "" : "s"} saved on this phone — waiting to sync` : "Using this phone’s safety copy — reconnecting…"}
            </div>
            <div className="mt-4 space-y-1">
              {expectedTodayPlan.length ? <section className={`expected-events-panel ${expectedEventsOpen ? "is-open" : "is-closed"}`}>
                <button
                  aria-controls="expected-events-list"
                  aria-expanded={expectedEventsOpen}
                  className="expected-events-toggle"
                  onClick={() => setExpectedEventsOpen((current) => !current)}
                  type="button"
                >
                  <span className="expected-events-toggle-icon"><CalendarClock size={18} /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold">Expected events</span>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-black">{visibleExpectedTodayPlan.length}/{expectedTodayPlan.length}</span>
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold">{hiddenExpectedEventCount ? `${hiddenExpectedEventCount} more hidden; increase the limit in Settings` : "Rolling six through tomorrow"}</span>
                  </span>
                  <ChevronDown className={`expected-events-chevron transition-transform ${expectedEventsOpen ? "rotate-180" : ""}`} size={19} />
                </button>
                {expectedEventsOpen ? <div className="expected-events-list" id="expected-events-list">
                  {visibleExpectedTodayPlan.map((item) => item.kind === "prediction" ? <PredictedFeed at={item.at} dayLabel={item.dayLabel} key={`feed-${item.at}`} /> : <PlannerTaskRow expected key={item.task.id} onEdit={openTaskOrRecurringComposer} onToggleComplete={toggleTaskCompleted} task={item.task} />)}
                </div> : null}
              </section> : null}
              {actualTodayPlan.map((item) => item.kind === "event" ? <TimelineEvent event={item.event} key={item.event.id} onEdit={openEditEvent} onEditStartTime={openFeedStartEditor} onFinishFeed={openFinishFeedSession} onStopSleep={stopSleep} /> : <PlannerTaskRow key={`completed-task-${item.task.id}`} onEdit={openTaskOrRecurringComposer} onToggleComplete={toggleTaskCompleted} task={item.task} />)}
              {!loading && !todayPlan.length ? <p className="py-10 text-center text-sm text-[#7c849a]">Log a bottle to start predicted feeds, then add the things you need to fit around them.</p> : null}
            </div>
          </section>
        </> : null}

        {view === "calendar" ? <section className="mt-6 grid gap-4 lg:mt-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
          <div className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#8a6045]">Calendar</p>
                <h2 className="text-xl font-bold">
                  {new Intl.DateTimeFormat(undefined, {
                    month: "long",
                    year: "numeric",
                  }).format(dateFromKey(selectedDate))}
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
                <button
                  className="rounded-xl border border-[#d1bda7] px-2 py-2 text-sm font-semibold"
                  onClick={() => shiftMonth(-1)}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="rounded-xl border border-[#d1bda7] px-2 py-2 text-sm font-semibold"
                  onClick={() => setSelectedDate(localTodayKey)}
                  type="button"
                >
                  Today
                </button>
                <button
                  className="rounded-xl border border-[#d1bda7] px-2 py-2 text-sm font-semibold"
                  onClick={() => shiftMonth(1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-[#8a6045] sm:text-xs">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-1">
              {calendarDays.map((day) => (
                <button
                  className={`min-h-[66px] rounded-xl border p-1.5 text-left transition sm:min-h-20 sm:p-2 ${
                    day.key === selectedDate
                      ? "border-[#2f6f62] bg-[#e9f3ee]"
                      : "border-[#eadfce] bg-[#fffaf3]"
                  } ${day.isCurrentMonth ? "" : "opacity-45"}`}
                  key={day.key}
                  onClick={() => setSelectedDate(day.key)}
                  type="button"
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold sm:h-7 sm:w-7 sm:text-sm ${
                      day.isToday ? "bg-[#27221d] text-white" : ""
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                  {day.count ? (
                    <span className="mt-1.5 flex flex-wrap gap-1 sm:mt-2">
                      {day.feeds ? (
                        <span className="rounded-full bg-[#e8f0fe] px-1 py-0.5 text-[10px] font-bold text-[#174ea6] sm:px-1.5 sm:text-[11px]">
                          F {day.feeds}
                        </span>
                      ) : null}
                      {day.expectedFeeds ? (
                        <span className="rounded-full bg-[#efe9ff] px-1 py-0.5 text-[10px] font-bold text-[#6845bd] sm:px-1.5 sm:text-[11px]">
                          E {day.expectedFeeds}
                        </span>
                      ) : null}
                      {day.pee ? (
                        <span className="rounded-full bg-[#fff7d6] px-1 py-0.5 text-[10px] font-bold text-[#7a5200] sm:px-1.5 sm:text-[11px]">
                          P {day.pee}
                        </span>
                      ) : null}
                      {day.poop ? (
                        <span className="rounded-full bg-[#f3e5d3] px-1 py-0.5 text-[10px] font-bold text-[#5f3a16] sm:px-1.5 sm:text-[11px]">
                          B {day.poop}
                        </span>
                      ) : null}
                      {day.sleeps ? (
                        <span className="rounded-full bg-[#e4e6f3] px-1 py-0.5 text-[10px] font-bold text-[#4d5687] sm:px-1.5 sm:text-[11px]">
                          S {day.sleeps}
                        </span>
                      ) : null}
                      {day.tasks ? (
                        <span className="rounded-full bg-[#e8f5f1] px-1 py-0.5 text-[10px] font-bold text-[#167a63] sm:px-1.5 sm:text-[11px]">
                          T {day.tasks}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-[#dfd2c0] bg-[#fffaf3] p-3 sm:p-4">
            <p className="text-sm font-semibold text-[#8a6045]">Selected day</p>
            <h2 className="text-xl font-bold">{formatSelectedDay(selectedDate)}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat label="Feeds" value={String(selectedDayTotals.feedings)} />
              <MiniStat label="Formula" value={`${selectedDayTotals.milliliters} mL`} />
              <MiniStat label="Diapers" value={String(selectedDayTotals.diapers)} />
              <MiniStat label="Sleep" value={selectedDayTotals.sleep} />
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a6045]">Schedule</p>
              {selectedDaySchedule.map((item) => {
                if (item.kind === "prediction") {
                  const dayLabel = dateKeyFromIso(item.at) === localTodayKey ? "Today" : "Tomorrow";
                  return <PredictedFeed at={item.at} dayLabel={dayLabel} key={`calendar-feed-${item.at}`} />;
                }
                if (item.kind === "task") {
                  return <PlannerTaskRow expected={!item.task.completed} key={`calendar-task-${item.task.id}`} onEdit={openTaskOrRecurringComposer} onToggleComplete={toggleTaskCompleted} task={item.task} />;
                }
                const { event } = item;
                return <article className="grid grid-cols-[52px_1fr] gap-2 sm:grid-cols-[72px_1fr] sm:gap-3" key={event.id}>
                  <p className="pt-2 text-right text-xs font-bold text-[#6b5b4a] sm:text-sm">
                    {formatTime(event.occurredAt)}
                  </p>
                  <div className={`rounded-xl border-l-4 p-3 ${eventStyle(event).block}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${eventStyle(event).dot}`} />
                      <p className="font-bold">{eventStyle(event).label}</p>
                    </div>
                    <p className="mt-1 text-sm font-semibold">
                      {event.detail}
                      {event.type === "feeding" && event.feedingStatus === "in_progress"
                        ? ", bottle in progress"
                        : ""}
                      {event.type === "feeding" && event.feedingStatus !== "in_progress" && event.amountMl
                        ? `, ${event.amountMl} mL (${mlToOunces(event.amountMl)} oz)`
                        : ""}
                      {event.type === "feeding" && event.durationMinutes
                        ? `, ${event.durationMinutes} min`
                        : ""}
                      {event.type === "medication"
                        ? `, ${[event.medicationStrength, [event.medicationDose, event.medicationUnit].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}`
                        : ""}
                      {event.type === "diaper" && event.detail === "Dirty"
                        ? `, ${[event.diaperSize, event.diaperColor, event.diaperLook]
                            .map(diaperCode)
                            .filter(Boolean)
                            .join(" / ")}`
                        : ""}
                      {event.type === "sleep"
                        ? `, ${formatDuration(minutesBetween(event.occurredAt, event.endedAt))}`
                        : ""}
                    </p>
                    {event.note ? <p className="text-sm">{event.note}</p> : null}
                    {event.createdBy ? <p className="mt-1 text-xs font-semibold">Logged by {event.createdBy}</p> : null}
                  </div>
                </article>;
              })}
              {!selectedDaySchedule.length ? (
                <p className="py-6 text-center text-sm text-[#766552]">
                  No schedule items for this day.
                </p>
              ) : null}
            </div>
          </aside>
        </section> : null}

        {view === "log" ? <section className="mt-6 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#e8ebf2] sm:mt-7 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#68718a]">PARENT-TO-NURSE LOG</p>
              <h2 className="mt-1 text-xl font-bold">
                Table view for {formatSelectedDay(selectedDate)}
              </h2>
            </div>
            <button aria-label="Export doctor log to CSV without planning tasks" className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#eef1f8] px-3 text-sm font-bold text-[#4e5d76] disabled:opacity-50" disabled={exporting} onClick={() => void exportHistory()} type="button"><Download size={17} /> {exporting ? "Preparing…" : "Export log"}</button>
          </div>

          <section className="mt-4 overflow-hidden rounded-2xl border border-[#f0c4d2] bg-[#fff9fb]">
            <button aria-expanded={medicationPanelOpen} className="flex w-full items-center gap-3 px-3 py-3 text-left text-[#9a3054]" onClick={() => setMedicationPanelOpen((current) => !current)} type="button">
              <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#ffe7ee]"><Pill size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">Medications</span><span className="mt-0.5 block text-xs font-semibold text-[#9a6a7c]">Quick-log a dose without adding a home-screen button</span></span>
              <ChevronDown className={medicationPanelOpen ? "rotate-180 transition-transform" : "transition-transform"} size={19} />
            </button>
            {medicationPanelOpen ? <div className="border-t border-dashed border-[#f0c4d2] px-3 pb-3 pt-3">
              <div className="flex flex-wrap gap-2">
                {medicationFavorites.map((favorite) => <button className="rounded-xl bg-[#ffe7ee] px-3 py-2 text-sm font-bold text-[#a23456]" key={favorite.id} onClick={() => openMedicationComposer(favorite)} type="button">{favorite.medicationName}</button>)}
                <button className="rounded-xl border border-dashed border-[#e8a7bc] px-3 py-2 text-sm font-bold text-[#a23456]" onClick={() => openMedicationComposer()} type="button"><Plus className="mr-1 inline" size={15} />Custom</button>
              </div>
              {lastMedicationForShare ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5"><p className="text-sm font-bold text-[#6b3d4d]">{lastMedicationForShare.detail} saved to the timeline.</p><button aria-label={`Share ${lastMedicationForShare.detail} medication update`} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0f5] text-[#a23456]" onClick={() => void shareMedication(lastMedicationForShare)} title="Share medication update" type="button"><Share size={20} strokeWidth={2} /></button></div> : null}
            </div> : null}
          </section>

          <div className="mt-4 grid gap-3 md:hidden">
            {selectedDayEvents.map((event) => (
              <LogCard event={event} key={event.id} onEdit={openEditEvent} onEditStartTime={openFeedStartEditor} onFinishFeed={openFinishFeedSession} onStopSleep={stopSleep} />
            ))}
            {!selectedDayEvents.length ? (
              <p className="rounded-2xl bg-[#fffaf3] px-4 py-8 text-center text-sm text-[#766552]">
                No table rows for this day yet.
              </p>
            ) : null}
          </div>

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-[#f5eadb] text-left text-xs uppercase text-[#6b4d35]">
                  <th className="border border-[#d7c4ae] px-3 py-2">Time</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Formula mL</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Minutes</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Wet diaper</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Dirty size</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Dirty color</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Dirty looks</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Sleep</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Medication</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Logged by</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Notes</th>
                  <th className="border border-[#d7c4ae] px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedDayEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="border border-[#eadfce] px-3 py-2 font-bold">
                      {formatTime(event.occurredAt)}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "feeding" ? event.feedingStatus === "in_progress" ? "In progress" : event.amountMl ?? "" : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "feeding" ? event.feedingStatus === "in_progress" ? "Running" : event.durationMinutes ?? "" : ""}
                    </td>
                    <td className="border border-[#eadfce] bg-[#fffdf0] px-3 py-2">
                      {event.type === "diaper" && event.detail === "Wet" ? "Yes" : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "diaper" && event.detail === "Dirty"
                        ? diaperCode(event.diaperSize)
                        : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "diaper" && event.detail === "Dirty"
                        ? diaperCode(event.diaperColor)
                        : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "diaper" && event.detail === "Dirty"
                        ? diaperCode(event.diaperLook)
                        : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "sleep"
                        ? formatDuration(minutesBetween(event.occurredAt, event.endedAt))
                        : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.type === "medication"
                        ? `${event.detail}${event.medicationStrength ? ` (${event.medicationStrength})` : ""} · ${[event.medicationDose, event.medicationUnit].filter(Boolean).join(" ")}`
                        : ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.createdBy ?? ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2">
                      {event.note ?? ""}
                    </td>
                    <td className="border border-[#eadfce] px-3 py-2"><div className="flex gap-2"><button className="rounded-lg bg-[#eef1f8] px-2 py-1 text-xs font-bold text-[#3559d9]" onClick={() => openEditEvent(event)} type="button">Edit</button>{event.type === "sleep" && !event.endedAt ? <button className="rounded-lg bg-[#5a43aa] px-2 py-1 text-xs font-bold text-white" onClick={() => void stopSleep(event)} type="button">Stop</button> : null}</div></td>
                  </tr>
                ))}
                {!selectedDayEvents.length ? (
                  <tr>
                    <td
                      className="border border-[#eadfce] px-3 py-8 text-center text-[#766552]"
                      colSpan={12}
                    >
                      No table rows for this day yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid gap-2 text-xs font-semibold text-[#766552] sm:grid-cols-3">
            <p>Size: T tiny/smear, S small, M medium, L large</p>
            <p>Color: M mec/black, G green, Y yellow, B brown</p>
            <p>Looks: SO soft, SE seedy, LO loose</p>
          </div>
        </section> : null}

        {medicationComposerOpen ? <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
          <form className="max-h-[92svh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={saveMedication}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="composer-icon bg-[#fff0f5] text-[#b33f63]"><Pill size={27} /></div><div><p className="text-sm font-bold text-[#68718a]">{editingMedication ? "EDIT MEDICATION" : "LOG MEDICATION"}</p><h2 className="text-2xl font-bold">{editingMedication ? medicationName : "What was given?"}</h2></div></div><button aria-label="Close medication form" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => { setEditingMedication(null); setMedicationComposerOpen(false); }} type="button"><X size={20} /></button></div>
            <p className="mt-4 rounded-xl bg-[#fff8fa] px-3 py-3 text-sm font-semibold leading-5 text-[#8f3554]">Record the medicine exactly as the label or your clinician instructed. This tracker does not calculate doses.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="field-label sm:col-span-2">Medication<input autoFocus onChange={(event) => setMedicationName(event.target.value)} placeholder="Tylenol, antibiotic…" required value={medicationName} /></label>
              <label className="field-label sm:col-span-2">Strength <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setMedicationStrength(event.target.value)} placeholder="160 mg / 5 mL" value={medicationStrength} /></label>
              <label className="field-label">Dose<input inputMode="decimal" onChange={(event) => setMedicationDose(event.target.value)} placeholder="2.5" required value={medicationDose} /></label>
              <label className="field-label">Unit<select onChange={(event) => setMedicationDoseUnit(event.target.value)} value={medicationDoseUnit}><option>mL</option><option>mg</option><option>tablet</option><option>drop</option><option>puff</option><option>other</option></select></label>
              <label className="field-label sm:col-span-2">When<input onChange={(event) => setMedicationOccurredAt(event.target.value)} required type="datetime-local" value={medicationOccurredAt} /></label>
              <label className="field-label">Logged by<input onChange={(event) => setMedicationLoggedBy(event.target.value)} placeholder="Your name" value={medicationLoggedBy} /></label>
              <label className="field-label">Note <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setMedicationNote(event.target.value)} placeholder="Reason, temperature, etc." value={medicationNote} /></label>
            </div>
            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#a23456] px-5 py-4 text-lg font-bold text-white disabled:opacity-60" disabled={saving || !medicationName.trim() || !medicationDose.trim()} type="submit"><Check size={21} />{saving ? "Saving…" : editingMedication ? "Save medication" : "Log medication"}</button>
            {editingMedication ? <div className="mt-5 flex justify-center border-t border-[#f2d6df] pt-4"><button aria-label={`Delete ${editingMedication.detail} medication record`} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0ef] text-[#a0352b]" onClick={() => requestDeleteEvent(editingMedication)} title="Delete medication record" type="button"><Trash2 size={17} /></button></div> : null}
          </form>
        </div> : null}

        {medicationFavoriteComposerOpen ? <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
          <form className="w-full max-w-lg rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={saveMedicationFavorite}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="composer-icon bg-[#fff0f5] text-[#b33f63]"><Pill size={27} /></div><div><p className="text-sm font-bold text-[#68718a]">MEDICATION FAVORITE</p><h2 className="text-2xl font-bold">Add a favorite</h2></div></div><button aria-label="Close medication favorite form" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => setMedicationFavoriteComposerOpen(false)} type="button"><X size={20} /></button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="field-label sm:col-span-2">Medication<input autoFocus onChange={(event) => setFavoriteName(event.target.value)} placeholder="Medicine name" required value={favoriteName} /></label><label className="field-label sm:col-span-2">Strength <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setFavoriteStrength(event.target.value)} placeholder="160 mg / 5 mL" value={favoriteStrength} /></label><label className="field-label">Typical dose <span className="font-medium text-[#8790a5]">(optional)</span><input inputMode="decimal" onChange={(event) => setFavoriteDose(event.target.value)} placeholder="Leave blank if it varies" value={favoriteDose} /></label><label className="field-label">Unit<select onChange={(event) => setFavoriteDoseUnit(event.target.value)} value={favoriteDoseUnit}><option>mL</option><option>mg</option><option>tablet</option><option>drop</option><option>puff</option><option>other</option></select></label></div>
            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#a23456] px-5 py-4 text-lg font-bold text-white disabled:opacity-60" disabled={saving || !favoriteName.trim()} type="submit"><Check size={21} />{saving ? "Saving…" : "Save favorite"}</button>
          </form>
        </div> : null}

        {composerOpen ? <div className="fixed inset-0 z-20 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
          <form className="max-h-[92svh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={addEvent}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className={`composer-icon action-${selected.label.toLowerCase()}`}><ActionIcon label={selected.label} /></div><div><p className="text-sm font-bold text-[#68718a]">{editingEvent ? "EDIT EVENT" : "LOG EVENT"}</p><h2 className="text-2xl font-bold">{selected.label}</h2></div></div><button aria-label="Close" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => { setEditingEvent(null); setComposerOpen(false); }} type="button"><X size={20} /></button></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="field-label flex-1">{selected.type === "feeding" ? "Feeding started" : "When"}<input onChange={(event) => setOccurredAt(event.target.value)} type="datetime-local" value={occurredAt} /></label>
                  {selected.type === "feeding" ? <button className="mt-6 shrink-0 rounded-xl bg-[#eef1f8] px-3 py-2.5 text-sm font-bold text-[#3559d9]" onClick={() => setOccurredAt(toDateTimeLocal(new Date()))} type="button">Now</button> : null}
                </div>
              </div>
              {selected.type === "feeding" ? <>
                <label className="field-label">Formula taken
                  <div className="mt-1 grid grid-cols-2 rounded-xl bg-[#f3f5fa] p-1 text-sm font-bold">
                    <button className={`rounded-lg px-3 py-2 ${amountUnit === "oz" ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} onClick={() => { setAmountMl(volumeForUnit(volumeToMl(amountMl, amountUnit), "oz")); setAmountUnit("oz"); }} type="button">oz</button>
                    <button className={`rounded-lg px-3 py-2 ${amountUnit === "ml" ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} onClick={() => { setAmountMl(volumeForUnit(volumeToMl(amountMl, amountUnit), "ml")); setAmountUnit("ml"); }} type="button">mL</button>
                  </div>
                  <div className="input-suffix mt-2"><input inputMode="decimal" min="0" onChange={(event) => setAmountMl(event.target.value)} step={amountUnit === "oz" ? "any" : "1"} type="number" value={amountMl} /><span>{amountUnit}</span></div>
                  <small>{amountMl ? `${volumeToMl(amountMl, amountUnit) ?? 0} mL · ${mlToOunces(volumeToMl(amountMl, amountUnit))} oz` : ""}</small>
                </label>
                <label className="field-label">Feed length<div className="input-suffix"><input inputMode="numeric" onChange={(event) => setDurationMinutes(event.target.value)} value={durationMinutes} /><span>min</span></div></label>
                <label className="field-label">Next feed reminder<select onChange={(event) => setNextFeedMinutes(event.target.value)} value={nextFeedMinutes}><option value="120">In 2 hours</option><option value="180">In 3 hours</option><option value="240">In 4 hours</option></select><small>Starts from the recorded feeding time.</small></label>
                <div className="rounded-xl bg-[#fff7d6] px-3 py-3 text-sm font-semibold leading-5 text-[#745000]">Formula timer: discard any formula left in the bottle one hour after feeding begins.</div>
              </> : null}
              {selected.type === "sleep" ? <label className="field-label sm:col-span-2">Wake up time <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setEndedAt(event.target.value)} type="datetime-local" value={endedAt} /></label> : null}
              {selected.type === "diaper" && selected.detail === "Dirty" ? <>
                <label className="field-label">Amount<select onChange={(event) => setDiaperSize(event.target.value)} value={diaperSize}><option>T - Tiny/smear</option><option>S - Small</option><option>M - Medium</option><option>L - Large</option></select></label>
                <label className="field-label">Color<select onChange={(event) => setDiaperColor(event.target.value)} value={diaperColor}><option>M - Mec/black</option><option>G - Green</option><option>Y - Yellow</option><option>B - Brown</option></select></label>
                <label className="field-label sm:col-span-2">Texture<select onChange={(event) => setDiaperLook(event.target.value)} value={diaperLook}><option>SO - Soft</option><option>SE - Seedy</option><option>LO - Loose</option></select></label>
              </> : null}
              <label className="field-label sm:col-span-2">Logged by<input onChange={(event) => setLoggedBy(event.target.value)} placeholder="Your name" value={loggedBy} /></label>
              <label className="field-label sm:col-span-2">Note <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setNote(event.target.value)} placeholder="Anything useful to remember" value={note} /></label>
            </div>
            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3559d9] px-5 py-4 text-lg font-bold text-white disabled:opacity-60" disabled={saving} type="submit"><Check size={21} />{saving ? "Saving..." : editingEvent ? "Save changes" : `Log ${selected.label}`}</button>
            {editingEvent ? <div className="mt-5 flex justify-center border-t border-[#e8ebf2] pt-4"><button aria-label={`Delete ${selected.label} event`} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0ef] text-[#a0352b]" onClick={() => requestDeleteEvent(editingEvent)} title={`Delete ${selected.label} event`} type="button"><Trash2 size={17} /></button></div> : null}
          </form>
        </div> : null}

        {feedStartConfirmOpen ? <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#15203a]/40 p-0 sm:items-center sm:p-6">
          <section aria-labelledby="start-bottle-title" className="w-full max-w-lg rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3"><div className="composer-icon action-bottle"><Milk size={28} strokeWidth={2.2} /></div><div><p className="text-sm font-bold text-[#68718a]">START A BOTTLE</p><h2 className="text-2xl font-bold" id="start-bottle-title">Start formula timer now?</h2></div></div>
              <button aria-label="Close start bottle" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => setFeedStartConfirmOpen(false)} type="button"><X size={20} /></button>
            </div>
            <div className="mt-5 rounded-2xl bg-[#fff7d6] p-4 text-[#745000]"><p className="font-bold">This saves a bottle session immediately.</p><p className="mt-1 text-sm font-semibold leading-5">The one-hour formula discard timer begins now. When baby is finished, tap the active bottle card to add the amount taken.</p></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2"><button className="rounded-2xl bg-[#eef1f8] px-4 py-3.5 font-bold text-[#53617a]" onClick={() => setFeedStartConfirmOpen(false)} type="button">Not yet</button><button className="flex items-center justify-center gap-2 rounded-2xl bg-[#3559d9] px-4 py-3.5 font-bold text-white disabled:opacity-60" disabled={saving} onClick={() => { setFeedStartConfirmOpen(false); void startFeedSession(); }} type="button"><Milk size={19} />{saving ? "Starting…" : "Start bottle"}</button></div>
          </section>
        </div> : null}

        {finishingFeedSession ? <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
          <form className="w-full max-w-lg rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={finishFeedSession}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="composer-icon action-bottle"><Milk size={28} strokeWidth={2.2} /></div>
                <div><p className="text-sm font-bold text-[#68718a]">BOTTLE IN PROGRESS</p><h2 className="text-2xl font-bold">How much was taken?</h2></div>
              </div>
              <button aria-label="Close finish bottle" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => setFinishingFeedSession(null)} type="button"><X size={20} /></button>
            </div>
            <p className="mt-4 rounded-xl bg-[#fff7d6] px-3 py-3 text-sm font-semibold leading-5 text-[#745000]">Started {formatTime(finishingFeedSession.occurredAt)}. This saved session stays easy to find until you complete it.</p>
            <div className="mt-5 grid gap-4">
              <VolumeDialPicker
                onChange={setFinishAmountMl}
                onUnitChange={(nextUnit) => {
                  setFinishAmountMl(volumeForUnit(volumeToMl(finishAmountMl, finishAmountUnit), nextUnit));
                  setFinishAmountUnit(nextUnit);
                }}
                unit={finishAmountUnit}
                value={finishAmountMl}
              />
              <label className="field-label">Logged by<input onChange={(event) => setFinishLoggedBy(event.target.value)} placeholder="Your name" value={finishLoggedBy} /></label>
              <label className="field-label">Note <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setFinishNote(event.target.value)} placeholder="Anything useful to remember" value={finishNote} /></label>
            </div>
            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3559d9] px-5 py-4 text-lg font-bold text-white disabled:opacity-60" disabled={saving || (volumeToMl(finishAmountMl, finishAmountUnit) ?? 0) <= 0} type="submit"><Check size={21} />{saving ? "Saving..." : "Complete & save bottle"}</button>
          </form>
        </div> : null}

        {editingFeedStartSession ? <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
          <form className="w-full max-w-lg rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={saveFeedStartTime}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
            <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="composer-icon action-bottle"><Milk size={28} strokeWidth={2.2} /></div><div><p className="text-sm font-bold text-[#68718a]">BOTTLE IN PROGRESS</p><h2 className="text-2xl font-bold">Correct start time</h2></div></div><button aria-label="Close start time editor" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => setEditingFeedStartSession(null)} type="button"><X size={20} /></button></div>
            <p className="mt-4 rounded-xl bg-[#fff7d6] px-3 py-3 text-sm font-semibold leading-5 text-[#745000]">This keeps the bottle open. Saving adjusts both the one-hour formula timer and the next-feed time.</p>
            <label className="field-label mt-5">Bottle started<input autoFocus max={toDateTimeLocal(new Date())} onChange={(event) => setEditedFeedStartedAt(event.target.value)} required type="datetime-local" value={editedFeedStartedAt} /></label>
            <div className="mt-5 grid grid-cols-2 gap-2"><button className="rounded-2xl bg-[#eef1f8] px-4 py-3.5 font-bold text-[#53617a]" onClick={() => setEditingFeedStartSession(null)} type="button">Cancel</button><button className="flex items-center justify-center gap-2 rounded-2xl bg-[#3559d9] px-4 py-3.5 font-bold text-white disabled:opacity-60" disabled={saving} type="submit"><Check size={19} />{saving ? "Saving…" : "Update timers"}</button></div>
          </form>
        </div> : null}

        {taskComposerOpen ? (
          <div className="fixed inset-0 z-20 flex items-end justify-center bg-[#15203a]/35 p-0 sm:items-center sm:p-6">
            <form className="max-h-[92svh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-2xl sm:rounded-[28px] sm:p-5" onSubmit={saveTask}>
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d9deea] sm:hidden" />
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-[#68718a]">DAY PLAN</p>
                  <h2 className="text-2xl font-bold">{editingRecurringTask ? "Edit recurring task" : editingTask ? "Edit task" : taskRepeats ? "Add recurring task" : "Add a task"}</h2>
                </div>
                <button aria-label="Close" className="rounded-full bg-[#eef1f8] p-2 text-[#53617a]" onClick={() => setTaskComposerOpen(false)} type="button"><X size={20} /></button>
              </div>
              <div className="mt-6 grid gap-4">
                <label className="field-label">What needs doing?<input autoFocus onChange={(event) => setTaskTitle(event.target.value)} placeholder="Shower, cook dinner, rest…" value={taskTitle} /></label>
                <div className="rounded-2xl bg-[#f5f6fa] p-1">
                  <div className="grid grid-cols-2 gap-1">
                    <button className={`rounded-xl px-3 py-2 text-sm font-black ${!taskRepeats ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} disabled={Boolean(editingRecurringTask)} onClick={() => setTaskRepeats(false)} type="button">One time</button>
                    <button className={`rounded-xl px-3 py-2 text-sm font-black ${taskRepeats ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} disabled={Boolean(editingTask)} onClick={() => setTaskRepeats(true)} type="button">Repeats</button>
                  </div>
                </div>
                {taskRepeats ? (
                  <>
                    <label className="field-label">Time<input onChange={(event) => setTaskTimeOfDay(event.target.value)} type="time" value={taskTimeOfDay} /></label>
                    <div>
                      <p className="field-label">Repeats on</p>
                      <div className="mt-2 grid grid-cols-7 gap-1.5">
                        {weekdays.map((weekday) => {
                          const selectedDay = taskWeekdays.includes(weekday.value);
                          return (
                            <button
                              aria-pressed={selectedDay}
                              className={`weekday-chip ${selectedDay ? "is-selected" : ""}`}
                              key={weekday.value}
                              onClick={() => setTaskWeekdays((current) => {
                                const next = current.includes(weekday.value)
                                  ? current.filter((day) => day !== weekday.value)
                                  : [...current, weekday.value];
                                return normalizeWeekdaySelection(next);
                              })}
                              title={weekday.label}
                              type="button"
                            >
                              {weekday.short.slice(0, 1)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="check-row"><input checked={taskRecurringActive} onChange={(event) => setTaskRecurringActive(event.target.checked)} type="checkbox" />Show this recurring task in expected events</label>
                  </>
                ) : (
                  <label className="field-label">When<input onChange={(event) => {
                    setTaskScheduledAt(event.target.value);
                    setTaskTimeOfDay(timeOfDayFromDate(new Date(event.target.value)));
                    setTaskWeekdays([new Date(event.target.value).getDay()]);
                  }} type="datetime-local" value={taskScheduledAt} /></label>
                )}
                <label className="field-label">How long?<select onChange={(event) => setTaskDuration(event.target.value)} value={taskDuration}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1½ hours</option><option value="120">2 hours</option></select></label>
                <label className="field-label">Note <span className="font-medium text-[#8790a5]">(optional)</span><input onChange={(event) => setTaskNote(event.target.value)} placeholder="Who&apos;s handling it or anything helpful" value={taskNote} /></label>
                {taskRepeats ? <p className="rounded-xl bg-[#eef3ff] px-3 py-2 text-sm font-bold text-[#3559d9]">This will show as an expected event on {taskWeekdays.length ? recurringSummary({ id: "draft", title: taskTitle, timeOfDay: taskTimeOfDay, weekdays: taskWeekdays, durationMinutes: Number(taskDuration) || 30, note: null, createdBy: null, active: true, createdAt: "", updatedAt: "" }).toLowerCase() : "the selected days"}.</p> : null}
              </div>
              <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3559d9] px-5 py-4 text-lg font-bold text-white disabled:opacity-60" disabled={saving || !taskTitle.trim() || (taskRepeats && !taskWeekdays.length)} type="submit"><Check size={21} />{saving ? "Saving..." : editingRecurringTask ? "Save recurring task" : editingTask ? "Save task" : taskRepeats ? "Add recurring task" : "Add to today"}</button>
              {editingTask ? <div className="mt-5 flex justify-center border-t border-[#e8ebf2] pt-4"><button aria-label={`Delete ${editingTask.title} task`} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0ef] text-[#a0352b]" onClick={() => requestDeleteTaskOrRecurring(editingTask)} title={`Delete ${editingTask.title} task`} type="button"><Trash2 size={17} /></button></div> : null}
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ActionIcon({ label }: { label: string }) {
  if (label === "Bottle") return <Milk size={28} strokeWidth={2.2} />;
  if (label === "Medication") return <Pill size={27} strokeWidth={2.2} />;
  if (label === "Wet") return <Droplets size={28} strokeWidth={2.2} />;
  if (label === "Dirty") return <Droplets size={28} strokeWidth={2.2} />;
  return <Moon size={28} strokeWidth={2.2} />;
}

function ViewButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2.5 ${active ? "bg-white text-[#2f50c9] shadow-sm" : "text-[#69738a]"}`} onClick={onClick} type="button">{icon}{label}</button>;
}

function FeedReminderPanel({
  activeSession,
  babyName,
  nowMs,
  notificationPermission,
  onDismissFormula,
  onEditStartTime,
  onEnableNotifications,
  onFinishSession,
  reminder,
}: {
  activeSession: TrackerEvent | undefined;
  babyName: string;
  nowMs: number;
  notificationPermission: NotificationPermission | "unsupported";
  onDismissFormula: () => void;
  onEditStartTime: () => void;
  onEnableNotifications: () => void;
  onFinishSession: () => void;
  reminder: FeedReminder | null;
}) {
  if (!reminder) {
    return (
      <section className="mt-7 rounded-2xl bg-[#eef3ff] p-4 text-[#294b9c]">
        <div className="flex items-center gap-2"><Bell size={19} /><p className="text-sm font-bold uppercase tracking-wide">Feed reminders</p></div>
        <p className="mt-2 font-bold">Start a bottle to save the session and begin the formula timer.</p>
        {notificationPermission === "default" ? <button className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-bold text-[#294b9c] shadow-sm" onClick={onEnableNotifications} type="button">Enable phone alerts</button> : null}
      </section>
    );
  }

  const feedStartedMs = new Date(reminder.feedStartedAt).getTime();
  const safeFeedStartedMs = Number.isFinite(feedStartedMs) && nowMs > 0
    ? Math.min(feedStartedMs, nowMs)
    : feedStartedMs;
  const storedFormulaDueMs = new Date(reminder.formulaDueAt).getTime();
  const safeFormulaDueMs = Number.isFinite(safeFeedStartedMs)
    ? safeFeedStartedMs + formulaWindowMs
    : storedFormulaDueMs;
  const formulaDueMs = Number.isFinite(storedFormulaDueMs)
    ? Math.min(storedFormulaDueMs, safeFormulaDueMs)
    : safeFormulaDueMs;
  const formulaMs = formulaDueMs - nowMs;
  const nextFeedMs = new Date(reminder.nextFeedDueAt).getTime() - nowMs;
  const formulaDue = reminder.formulaReminderEnabled && formulaMs <= 0;
  const nextFeedDue = nextFeedMs <= 0;
  const visibleFormulaStart = Number.isFinite(safeFeedStartedMs)
    ? new Date(safeFeedStartedMs).toISOString()
    : reminder.feedStartedAt;

  return (
    <section className="mt-7 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#e8ebf2]">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-bold text-[#68718a]">ACTIVE TIMERS</p><h2 className="mt-1 text-xl font-bold">{activeSession ? "Bottle in progress" : "This bottle"}</h2></div>
        {activeSession ? <span className="rounded-full bg-[#e8f5f1] px-2.5 py-1 text-xs font-black text-[#167a63]">Saved</span> : null}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {reminder.formulaReminderEnabled ? <article className={`rounded-2xl p-3 ${formulaDue ? "bg-[#fff0ef] text-[#9b2d22]" : "bg-[#fff7d6] text-[#745000]"}`}>
          <p className="text-xs font-bold uppercase tracking-wide">Formula</p>
          <p className="mt-1 text-xl font-black">{formulaDue ? "Discard now" : `Discard in ${formatCountdown(formulaMs)}`}</p>
          <p className="mt-1 text-sm font-semibold">Started {formatTime(visibleFormulaStart)}</p>
          {activeSession ? <button className="mt-2 flex min-h-11 items-center gap-1.5 rounded-xl bg-white/80 px-3 py-2 text-sm font-bold shadow-sm" onClick={onEditStartTime} type="button"><Pencil size={16} />Edit start time</button> : null}
          {formulaDue ? <button className="mt-3 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs font-bold" onClick={onDismissFormula} type="button">Dismiss discard reminder</button> : null}
        </article> : null}
        <article className={`rounded-2xl p-3 ${nextFeedDue ? "bg-[#e8efff] text-[#174ea6]" : "bg-[#eef3ff] text-[#294b9c]"}`}>
          <p className="text-xs font-bold uppercase tracking-wide">Next feed</p>
          <p className="mt-1 text-xl font-black">{nextFeedDue ? "Time to feed" : `In ${formatCountdown(nextFeedMs)}`}</p>
          <p className="mt-1 text-sm font-semibold">{babyName} · {formatTime(reminder.nextFeedDueAt)}</p>
        </article>
      </div>
      {activeSession ? <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3559d9] px-3 py-3.5 text-sm font-bold text-white shadow-sm" onClick={onFinishSession} type="button"><Check size={18} />Complete bottle · add volume</button> : null}
      {notificationPermission === "default" ? <button className="mt-3 flex items-center gap-2 rounded-xl bg-[#3559d9] px-3 py-2.5 text-sm font-bold text-white" onClick={onEnableNotifications} type="button"><BellRing size={17} />Enable phone alerts</button> : null}
      {notificationPermission === "denied" || notificationPermission === "unsupported" ? <p className="mt-3 text-xs font-semibold text-[#7b8499]">Browser alerts need the page open. Keep Active Timers visible, or use your phone Clock/Reminders app when you need a background alarm.</p> : null}
    </section>
  );
}

function formatCountdown(milliseconds: number) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  return formatDuration(minutes);
}

function Summary({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub: string; tone: string }) {
  return <article className={`summary-card summary-${tone}`}><span className="summary-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{sub}</small></article>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl bg-white p-3 shadow-sm"><p className="text-xs font-semibold text-[#68718a]">{label}</p><p className="text-lg font-bold">{value}</p></article>;
}

function VolumeDialPicker({
  onChange,
  onUnitChange,
  unit,
  value,
}: {
  onChange: (value: string) => void;
  onUnitChange: (unit: VolumeUnit) => void;
  unit: VolumeUnit;
  value: string;
}) {
  const numericValue = Number(value);
  const hasValue = Number.isFinite(numericValue) && numericValue > 0;
  const values = unit === "oz" ? ounceDialValues : milliliterDialValues;
  const step = unit === "oz" ? 0.25 : 5;
  const selectedDisplay = hasValue ? (unit === "oz" ? trimVolume(numericValue, 2) : String(Math.round(numericValue))) : "--";
  const selectedAmountMl = hasValue ? volumeToMl(value, unit) : null;
  const selectedValue = unit === "oz" ? Number(trimVolume(numericValue, 2)) : Math.round(numericValue);
  const selectedIsListed = values.some((amount) => Math.abs(selectedValue - amount) < 0.01);

  function setAmount(nextValue: number) {
    const bounded = Math.min(values.at(-1) ?? nextValue, Math.max(0, nextValue));
    onChange(unit === "oz" ? trimVolume(bounded, 2) : String(Math.round(bounded)));
  }

  return (
    <section aria-label="Amount taken" className="rounded-2xl bg-[#f7f9ff] p-3 ring-1 ring-[#e1e7f4]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-[#68718a]">Amount taken</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-black text-[#15203a] tabular-nums">{selectedDisplay}</span>
            <span className="pb-1 text-lg font-black text-[#3559d9]">{unit}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 rounded-xl bg-[#eef1f8] p-1 text-sm font-black">
          <button className={`rounded-lg px-3 py-2 ${unit === "oz" ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} onClick={() => onUnitChange("oz")} type="button">oz</button>
          <button className={`rounded-lg px-3 py-2 ${unit === "ml" ? "bg-white text-[#3559d9] shadow-sm" : "text-[#68718a]"}`} onClick={() => onUnitChange("ml")} type="button">mL</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[48px_minmax(0,1fr)_48px] items-center gap-2">
        <button aria-label={`Decrease by ${step} ${unit}`} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[#3559d9] shadow-sm ring-1 ring-[#dfe5f1] disabled:opacity-40" disabled={!hasValue} onClick={() => setAmount((hasValue ? numericValue : step) - step)} type="button"><Minus size={20} /></button>
        <label className="sr-only" htmlFor="finish-feed-amount">Amount taken in {unit}</label>
        <select
          className="h-12 min-w-0 appearance-none rounded-xl border border-[#dfe5f1] bg-white px-3 text-center text-base font-black text-[#15203a] shadow-sm outline-none focus:border-[#5573de] focus:ring-2 focus:ring-[#e3eaff]"
          id="finish-feed-amount"
          onChange={(event) => onChange(event.target.value)}
          value={hasValue ? (unit === "oz" ? trimVolume(numericValue, 2) : String(Math.round(numericValue))) : ""}
        >
          <option value="">Choose amount</option>
          {hasValue && !selectedIsListed ? <option value={selectedDisplay}>{selectedDisplay} {unit}</option> : null}
          {values.map((amount) => {
            const optionValue = unit === "oz" ? trimVolume(amount, 2) : String(amount);
            return <option key={`${unit}-${amount}`} value={optionValue}>{optionValue} {unit}</option>;
          })}
        </select>
        <button aria-label={`Increase by ${step} ${unit}`} className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#3559d9] text-white shadow-sm disabled:opacity-40" disabled={selectedValue >= (values.at(-1) ?? 0)} onClick={() => setAmount((hasValue ? numericValue : 0) + step)} type="button"><Plus size={20} /></button>
      </div>
      <p className="mt-2 text-center text-xs font-semibold text-[#68718a]">Tap the amount to use your iPhone&apos;s picker.</p>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-[#68718a] ring-1 ring-[#e4e9f3]">
        <span>{selectedAmountMl ? `${selectedAmountMl} mL` : "Pick an amount"}</span>
        <span>{selectedAmountMl ? `${mlToOunces(selectedAmountMl)} oz` : "Ounces first"}</span>
      </div>
    </section>
  );
}

function LogCard({
  event,
  onEdit,
  onEditStartTime,
  onFinishFeed,
  onStopSleep,
}: {
  event: TrackerEvent;
  onEdit: (event: TrackerEvent) => void;
  onEditStartTime: (event: TrackerEvent) => void;
  onFinishFeed: (event: TrackerEvent) => void;
  onStopSleep: (event: TrackerEvent) => void;
}) {
  const isFeed = event.type === "feeding";
  const isWet = event.type === "diaper" && event.detail === "Wet";
  const isDirty = event.type === "diaper" && event.detail === "Dirty";
  const isSleep = event.type === "sleep";
  const isMedication = event.type === "medication";

  return (
    <article className="rounded-2xl border border-[#eadfce] bg-[#fffaf3] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a6045]">
            {formatTime(event.occurredAt)}
          </p>
          <h3 className="mt-1 text-lg font-black text-[#2a221b]">
            {eventStyle(event).label}
          </h3>
        </div>
        <span className={`event-icon ${eventStyle(event).label.toLowerCase()}`}>
          <ActionIcon
            label={
              isFeed
                ? "Bottle"
                : isMedication
                  ? "Medication"
                : isDirty
                  ? "Dirty"
                  : isSleep
                    ? "Sleep"
                    : "Wet"
            }
          />
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        {isFeed ? (
          <>
            <LogFact label="Formula" value={event.feedingStatus === "in_progress" ? "In progress" : `${event.amountMl ?? ""} mL`} />
            <LogFact label="Minutes" value={event.feedingStatus === "in_progress" ? "Running" : String(event.durationMinutes ?? "")} />
          </>
        ) : null}
        {isWet ? <LogFact label="Wet diaper" value="Yes" /> : null}
        {isDirty ? (
          <>
            <LogFact label="Size" value={diaperCode(event.diaperSize)} />
            <LogFact label="Color" value={diaperCode(event.diaperColor)} />
            <LogFact label="Looks" value={diaperCode(event.diaperLook)} />
          </>
        ) : null}
        {isSleep ? (
          <LogFact
            label="Sleep"
            value={formatDuration(minutesBetween(event.occurredAt, event.endedAt))}
          />
        ) : null}
        {isMedication ? (
          <>
            <LogFact label="Medication" value={event.detail} />
            <LogFact label="Dose" value={[event.medicationDose, event.medicationUnit].filter(Boolean).join(" ")} />
            {event.medicationStrength ? <LogFact label="Strength" value={event.medicationStrength} /> : null}
          </>
        ) : null}
        {event.createdBy ? <LogFact label="Logged by" value={event.createdBy} /> : null}
      </dl>
      {event.note ? (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#6b5b4a]">
          {event.note}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#eadfce] pt-3">{isFeed && event.feedingStatus === "in_progress" ? <><button className="flex items-center gap-1 rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={() => onEditStartTime(event)} type="button"><Pencil size={15} />Edit time</button><button className="rounded-xl bg-[#3559d9] px-3 py-2 text-sm font-bold text-white" onClick={() => onFinishFeed(event)} type="button">Finish bottle</button></> : <button className="flex items-center gap-1 rounded-xl bg-[#eef1f8] px-3 py-2 text-sm font-bold text-[#3559d9]" onClick={() => onEdit(event)} type="button"><Pencil size={15} />Edit</button>}{isSleep && !event.endedAt ? <button className="rounded-xl bg-[#5a43aa] px-3 py-2 text-sm font-bold text-white" onClick={() => onStopSleep(event)} type="button">Stop sleep</button> : null}</div>
    </article>
  );
}

function LogFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[#8a6045]">
        {label}
      </dt>
      <dd className="mt-0.5 font-black text-[#2a221b]">{value || "—"}</dd>
    </div>
  );
}

function TimelineEvent({
  event,
  onEdit,
  onEditStartTime,
  onFinishFeed,
  onStopSleep,
}: {
  event: TrackerEvent;
  onEdit: (event: TrackerEvent) => void;
  onEditStartTime: (event: TrackerEvent) => void;
  onFinishFeed: (event: TrackerEvent) => void;
  onStopSleep: (event: TrackerEvent) => void;
}) {
  const style = eventStyle(event);
  const summary = event.type === "feeding" ? event.feedingStatus === "in_progress" ? "Bottle in progress" : `${event.amountMl ?? 0} mL${event.durationMinutes ? ` · ${event.durationMinutes} min` : ""}` : event.type === "medication" ? [event.detail, event.medicationStrength, [event.medicationDose, event.medicationUnit].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : event.type === "sleep" ? formatDuration(minutesBetween(event.occurredAt, event.endedAt)) : event.detail === "Dirty" ? [event.diaperSize, event.diaperColor, event.diaperLook].map(diaperCode).filter(Boolean).join(" · ") : "Wet diaper";
  const isActiveBottle = event.type === "feeding" && event.feedingStatus === "in_progress";
  const action = isActiveBottle
    ? <div className="flex items-center gap-1"><button aria-label="Edit bottle start time" className="flex min-h-11 items-center gap-1 rounded-xl bg-[#eef1f8] px-2.5 py-2 text-xs font-bold text-[#3559d9]" onClick={(clickEvent) => { clickEvent.preventDefault(); clickEvent.stopPropagation(); onEditStartTime(event); }} type="button"><Pencil size={15} />Edit time</button><button aria-label="Finish bottle" className="min-h-11 rounded-xl bg-[#3559d9] px-2.5 py-2 text-xs font-bold text-white" onClick={() => onFinishFeed(event)} type="button">Finish</button></div>
    : event.type === "sleep" && !event.endedAt
      ? <button aria-label="Stop sleep" className="rounded-lg bg-[#5a43aa] px-2.5 py-1.5 text-xs font-bold text-white" onClick={() => onStopSleep(event)} type="button">Stop</button>
      : <button aria-label={`Edit ${style.label} event`} className="-mr-1 flex h-11 w-11 items-center justify-center rounded-xl text-[#657089]" onClick={(clickEvent) => { clickEvent.preventDefault(); clickEvent.stopPropagation(); onEdit(event); }} title={`Edit ${style.label} event`} type="button"><Pencil size={18} /></button>;
  return <article className="group py-3"><div className="flex items-center gap-3"><div className={`event-icon ${style.label.toLowerCase()}`}><ActionIcon label={event.type === "feeding" ? "Bottle" : event.type === "medication" ? "Medication" : event.detail === "Dirty" ? "Dirty" : event.type === "sleep" ? "Sleep" : "Wet"} /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{style.label}</p><div className="flex flex-none items-center gap-1"><time className="text-sm font-semibold text-[#798299]">{formatTime(event.occurredAt)}</time>{action}</div></div><p className="truncate text-sm text-[#68718a]">{summary}{event.note ? ` · ${event.note}` : ""}</p>{event.createdBy ? <p className="mt-0.5 text-xs font-semibold text-[#8a93a7]">Logged by {event.createdBy}</p> : null}</div></div></article>;
}

function PredictedFeed({ at, dayLabel }: { at: string; dayLabel: "Today" | "Tomorrow" }) {
  const isTomorrow = dayLabel === "Tomorrow";
  const shell = isTomorrow
    ? "border-[#d8cafb] bg-[#faf7ff]"
    : "border-[#b8ccfb] bg-[#f7faff]";
  const icon = isTomorrow ? "bg-[#efe9ff] text-[#6845bd]" : "bg-[#e8efff] text-[#2453cc]";
  const title = isTomorrow ? "text-[#6845bd]" : "text-[#2453cc]";
  const helper = isTomorrow ? "text-[#7e67bd]" : "text-[#5270b6]";
  const badge = isTomorrow ? "bg-[#efe9ff] text-[#6845bd]" : "bg-[#e8efff] text-[#2453cc]";

  return (
    <article className={`flex items-center gap-3 rounded-2xl border border-dashed px-3 py-3 ${shell}`}>
      <div className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px] ${icon}`}>
        <Milk size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className={`font-bold ${title}`}>Expected feed</p>
          <time className={`text-sm font-semibold ${title}`}>{formatTime(at)}</time>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${badge}`}>
            {dayLabel}
          </span>
          <p className={`text-sm font-semibold ${helper}`}>Based on your feed plan</p>
        </div>
      </div>
    </article>
  );
}

function PlannerTaskRow({
  task,
  onEdit,
  onToggleComplete,
  expected = false,
}: {
  task: PlannerTask;
  onEdit: (task: PlannerTask) => void;
  onToggleComplete: (task: PlannerTask) => void;
  expected?: boolean;
}) {
  const completed = task.completed;
  const iconClass = completed
    ? "completed-task-icon"
    : expected
      ? "expected-task-icon"
      : "bg-[#e8f5f1] text-[#167a63]";
  const titleClass = expected && !completed ? "expected-task-title" : "";
  const timeClass = expected && !completed ? "expected-task-time" : "text-[#798299]";
  const detailClass = expected && !completed ? "expected-task-detail" : "text-[#68718a]";
  const actions = (
    <div className={`flex flex-none items-center gap-1 ${expected ? "expected-task-actions" : ""}`}>
      <button
        aria-label={completed ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        className={`task-done-button ${completed ? "is-complete" : ""}`}
        onClick={() => onToggleComplete(task)}
        type="button"
      >
        <Check size={15} />
        <span>{completed ? "Undo" : "Done"}</span>
      </button>
      <button aria-label={`Edit ${task.title}`} className="rounded-full p-2 text-[#657089]" onClick={() => onEdit(task)} type="button"><Pencil size={16} /></button>
    </div>
  );

  if (expected) {
    return (
      <article className={`planner-task-row expected-task-row ${completed ? "completed-task-row" : ""}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px] ${iconClass}`}>
            {completed ? <Check size={20} /> : <CalendarClock size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className={`min-w-0 font-bold ${titleClass}`}>{task.title}</p>
              <time className={`flex-none whitespace-nowrap text-sm font-semibold ${timeClass}`}>{formatTime(task.scheduledAt)}</time>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="expected-task-badge">Expected</span>
              <p className={`text-sm font-semibold ${detailClass}`}>{formatDuration(task.durationMinutes)}{task.note ? ` · ${task.note}` : ""}</p>
              {task.recurrenceLabel ? <span className="recurring-task-badge"><Repeat2 size={11} />{task.recurrenceLabel}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pl-[54px] pt-2">
          {task.createdBy ? <p className="min-w-0 truncate text-xs font-semibold text-[#8a93a7]">Planned by {task.createdBy}</p> : <span />}
          {actions}
        </div>
      </article>
    );
  }

  return (
    <article className={`group planner-task-row flex items-center gap-3 py-3 ${completed ? "completed-task-row" : ""}`}>
      <div className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px] ${iconClass}`}>
        {completed ? <Check size={20} /> : expected ? <CalendarClock size={20} /> : <Check size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className={`font-bold ${titleClass}`}>{task.title}</p>
          <time className={`text-sm font-semibold ${timeClass}`}>{formatTime(task.scheduledAt)}</time>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className={`truncate text-sm ${detailClass}`}>{formatDuration(task.durationMinutes)}{task.note ? ` · ${task.note}` : ""}</p>
          {completed ? <span className="completed-task-badge">Done</span> : expected ? <span className="expected-task-badge">Expected</span> : null}
          {task.recurrenceLabel ? <span className="recurring-task-badge"><Repeat2 size={11} />{task.recurrenceLabel}</span> : null}
        </div>
        {task.createdBy ? <p className="mt-0.5 text-xs font-semibold text-[#8a93a7]">Planned by {task.createdBy}</p> : null}
      </div>
      {actions}
    </article>
  );
}
