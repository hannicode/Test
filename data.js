// data.js - loading the college data from disk and turning CSV text into the
// plain JavaScript objects that the solver and the pages work with.
//
// The CSV files are the source of truth: every page reads them fresh, and
// every save writes them back. Nothing is cached, so what you see on disk is
// always what the app will use.

import fs from "node:fs";
import path from "node:path";
import { readCsvFile, readCsvDirectory, writeCsvFile } from "./csv.js";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const SECTION_HEADERS = [
  "section_id", "course_id", "course_name", "instructor",
  "capacity_needed", "duration_minutes", "allowed_days",
];
export const ROOM_HEADERS = ["room_id", "room_name", "building", "capacity"];
export const GRID_HEADERS = ["first_day", "last_day", "start", "end", "slot_minutes"];
export const PROFESSOR_HEADERS = [
  "professor_id", "name", "preferred_days", "preferred_start", "preferred_end",
  "availability_start", "availability_end", "max_sections",
];
export const SUBJECT_HEADERS = [
  "subject_id", "course_name", "default_duration_minutes", "default_capacity",
];
export const SCHEDULE_HEADERS = [
  "section_id", "course_id", "course_name", "instructor",
  "room_id", "room_name", "day", "start", "end",
];
export const SETTINGS_HEADERS = ["school_name", "term_label", "term_start", "term_end"];
export const LOCK_HEADERS = ["section_id", "room_id", "day", "start"];
export const VERSION_HEADERS = ["name", "file", "created_at", "placed", "unplaced", "current"];

/** Shown on the published timetable; blank values simply disappear from it. */
export const DEFAULT_SETTINGS = {
  school_name: "",
  term_label: "",
  term_start: "",
  term_end: "",
};

/** "08:30" -> 510 minutes since midnight. Anything invalid -> null. */
export function parseHhmm(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 510 -> "08:30". */
export function formatHhmm(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Parse an integer, falling back when the cell is blank or not a number. */
export function toInt(text, fallback = 0) {
  const value = Number.parseInt(String(text ?? "").trim(), 10);
  return Number.isFinite(value) ? value : fallback;
}

/** "Mon,Wed,Fri" -> ["Mon", "Wed", "Fri"]. */
export function splitDays(text) {
  return String(text ?? "")
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);
}

/** Read data/grid.csv, with sensible fallbacks if a cell is missing. */
function readGrid(file) {
  const [row = {}] = readCsvFile(file);
  const firstWanted = DAYS.indexOf(String(row.first_day ?? "").trim());
  const lastWanted = DAYS.indexOf(String(row.last_day ?? "").trim());
  const first = firstWanted >= 0 ? firstWanted : 0;
  let last = lastWanted >= 0 ? lastWanted : DAYS.length - 1;
  if (last < first) last = first;

  const start = parseHhmm(row.start) ?? 7 * 60;
  const end = parseHhmm(row.end) ?? 21 * 60;
  const slot = toInt(row.slot_minutes, 30);

  return {
    first,
    last,
    start,
    end,
    slot_minutes: slot > 0 ? slot : 30,
    days: DAYS.slice(first, last + 1),
  };
}

/** Read settings.csv, falling back to blanks if it does not exist yet. */
function readSettings(file) {
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
  const [row = {}] = readCsvFile(file);
  return {
    school_name: String(row.school_name ?? "").trim(),
    term_label: String(row.term_label ?? "").trim(),
    term_start: String(row.term_start ?? "").trim(),
    term_end: String(row.term_end ?? "").trim(),
  };
}

/**
 * Load every CSV file and turn it into objects.
 *
 * `dataDir` is the folder holding grid.csv, rooms.csv, sections.csv,
 * professors/ and subjects/ - the things you edit. `outDir` is where the
 * schedule and the exported page are written; normally that is the project
 * root, but `--data` sends them inside the alternate folder so a demo run can
 * never overwrite real results.
 */
export function loadData({ dataDir, outDir }) {
  const paths = {
    grid: path.join(dataDir, "grid.csv"),
    rooms: path.join(dataDir, "rooms.csv"),
    sections: path.join(dataDir, "sections.csv"),
    settings: path.join(dataDir, "settings.csv"),
    professors: path.join(dataDir, "professors"),
    subjects: path.join(dataDir, "subjects"),
    drafts: path.join(dataDir, "drafts"),
    schedules: path.join(dataDir, "schedules"),
    imports: path.join(dataDir, "imports"),
    draft: path.join(dataDir, "drafts", "current.csv"),
    locks: path.join(dataDir, "drafts", "locks.csv"),
    versions: path.join(dataDir, "schedules", "index.csv"),
    schedule: path.join(outDir, "schedule.csv"),
    export: path.join(outDir, "schedule.html"),
  };

  const grid = readGrid(paths.grid);
  const settings = readSettings(paths.settings);

  const rooms = readCsvFile(paths.rooms)
    .map((row) => ({
      id: String(row.room_id ?? "").trim(),
      name: String(row.room_name ?? "").trim(),
      building: String(row.building ?? "").trim(),
      capacity: toInt(row.capacity, 0),
    }))
    .filter((room) => room.id !== "");

  const sections = readCsvFile(paths.sections)
    .map((row) => ({
      section_id: String(row.section_id ?? "").trim(),
      course_id: String(row.course_id ?? "").trim(),
      course_name: String(row.course_name ?? "").trim(),
      instructor: String(row.instructor ?? "").trim(),
      capacity_needed: toInt(row.capacity_needed, 0),
      duration_minutes: toInt(row.duration_minutes, 0),
      allowed_days: splitDays(row.allowed_days),
    }))
    .filter((section) => section.section_id !== "");

  const professors = new Map();
  const professorList = [];
  for (const entry of readCsvDirectory(paths.professors)) {
    const name = String(entry.values.name ?? "").trim();
    if (!name) continue;
    const professor = {
      id: String(entry.values.professor_id ?? entry.name).trim(),
      name,
      preferred_days: splitDays(entry.values.preferred_days),
      preferred_start: parseHhmm(entry.values.preferred_start) ?? 0,
      preferred_end: parseHhmm(entry.values.preferred_end) ?? 0,
      availability_start: parseHhmm(entry.values.availability_start) ?? 0,
      availability_end: parseHhmm(entry.values.availability_end) ?? 0,
      max_sections: toInt(entry.values.max_sections, 0),
      file: entry.file,
    };
    professors.set(professor.name, professor);
    professorList.push(professor);
  }

  const subjects = new Map();
  const subjectList = [];
  for (const entry of readCsvDirectory(paths.subjects)) {
    const id = String(entry.values.subject_id ?? entry.name).trim();
    if (!id) continue;
    const subject = {
      id,
      course_name: String(entry.values.course_name ?? entry.values.name ?? "").trim(),
      default_duration_minutes: toInt(entry.values.default_duration_minutes, 0),
      default_capacity: toInt(entry.values.default_capacity, 0),
      file: entry.file,
    };
    subjects.set(id, subject);
    subjectList.push(subject);
  }

  const files = [
    paths.grid,
    paths.rooms,
    paths.sections,
    paths.settings,
    ...professorList.map((professor) => professor.file),
    ...subjectList.map((subject) => subject.file),
  ];

  return {
    dataDir,
    outDir,
    paths,
    grid,
    settings,
    rooms,
    sections,
    professors,
    professorList,
    subjects,
    subjectList,
    files,
  };
}

/** Fill blank durations/capacities from the matching subject file. */
export function applySubjectDefaults(sections, subjects) {
  return sections.map((section) => {
    const subject = subjects.get(section.course_id);
    return {
      ...section,
      duration_minutes: section.duration_minutes || subject?.default_duration_minutes || 0,
      capacity_needed: section.capacity_needed || subject?.default_capacity || 0,
    };
  });
}

/** The days a section may be placed on (blank allowed_days = any grid day). */
export function sectionDays(section, grid) {
  if (section.allowed_days.length === 0) return grid.days;
  return grid.days.filter((day) => section.allowed_days.includes(day));
}

/** Read a schedule-shaped CSV (one row per placed section). */
function readPlacements(file) {
  return readCsvFile(file)
    .map((row) => ({
      section_id: row.section_id,
      course_id: row.course_id,
      course_name: row.course_name,
      instructor: row.instructor,
      room_id: row.room_id,
      room_name: row.room_name,
      day: row.day,
      start: parseHhmm(row.start) ?? 0,
      end: parseHhmm(row.end) ?? 0,
    }))
    .filter((placement) => placement.section_id !== "");
}

/** Read the published schedule.csv from `dir`, or null when nothing is published. */
export function readSavedSchedule(dir) {
  const file = path.join(dir, "schedule.csv");
  if (!fs.existsSync(file)) return null;
  return { placements: readPlacements(file), savedAt: fs.statSync(file).mtime };
}

/** The working schedule. Private until it is published. */
export function readDraft(data) {
  if (!fs.existsSync(data.paths.draft)) return null;
  return {
    placements: readPlacements(data.paths.draft),
    savedAt: fs.statSync(data.paths.draft).mtime,
  };
}

/** The sections the planner has pinned in place. */
export function readLocks(data) {
  return readCsvFile(data.paths.locks)
    .map((row) => ({
      section_id: String(row.section_id ?? "").trim(),
      room_id: String(row.room_id ?? "").trim(),
      day: String(row.day ?? "").trim(),
      start: parseHhmm(row.start) ?? -1,
    }))
    .filter((lock) => lock.section_id !== "" && lock.room_id !== "");
}

/** Published versions, newest last, exactly one of them marked current. */
export function readVersions(data) {
  return readCsvFile(data.paths.versions).map((row) => ({
    name: String(row.name ?? "").trim(),
    file: String(row.file ?? "").trim(),
    created_at: String(row.created_at ?? "").trim(),
    placed: toInt(row.placed, 0),
    unplaced: toInt(row.unplaced, 0),
    current: String(row.current ?? "").trim() === "yes",
  }));
}

/** One saved version by its index row, or null when the file is gone. */
export function readVersion(data, version) {
  const file = path.join(data.paths.schedules, path.basename(version.file));
  if (!fs.existsSync(file)) return null;
  return { placements: readPlacements(file), savedAt: fs.statSync(file).mtime };
}

/** Turn a display name into a file name that is safe on every OS. */
function versionSlug(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "version";
}

/** Save a named snapshot and add it to the index. */
export function saveVersion(data, { name, placements, unplaced = 0 }) {
  const versions = readVersions(data);
  const base = versionSlug(name);
  let file = `${base}.csv`;
  let suffix = 2;
  while (
    versions.some((version) => version.file === file) ||
    fs.existsSync(path.join(data.paths.schedules, file))
  ) {
    file = `${base}-${suffix}.csv`;
    suffix += 1;
  }

  writePlacements(path.join(data.paths.schedules, file), placements);

  const version = {
    name,
    file,
    created_at: new Date().toISOString(),
    placed: placements.length,
    unplaced,
    current: false,
  };
  saveVersions(data, [...versions, version]);
  return version;
}

/** Remove a version and its file. */
export function deleteVersion(data, file) {
  const safe = path.basename(file);
  const target = path.join(data.paths.schedules, safe);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  saveVersions(data, readVersions(data).filter((version) => version.file !== safe));
}

/** Mark exactly one version as the one currently published. */
export function setCurrentVersion(data, file) {
  saveVersions(
    data,
    readVersions(data).map((version) => ({ ...version, current: version.file === file }))
  );
}

/** The newest modification time among the data files. */
export function newestDataTime(data) {
  let newest = 0;
  for (const file of data.files) {
    if (fs.existsSync(file)) newest = Math.max(newest, fs.statSync(file).mtimeMs);
  }
  return newest;
}

/** True when a data file changed after the schedule was saved. */
export function isStale(data, saved) {
  return Boolean(saved) && newestDataTime(data) > saved.savedAt.getTime();
}

// ---------------------------------------------------------------------------
// Writers. Each one takes the objects the pages edit and writes the CSV back.
// ---------------------------------------------------------------------------

export function saveSections(data, sections) {
  writeCsvFile(
    data.paths.sections,
    SECTION_HEADERS,
    sections.map((section) => ({
      section_id: section.section_id,
      course_id: section.course_id,
      course_name: section.course_name,
      instructor: section.instructor,
      // Blank means "use the subject default", so write 0 back as an empty cell.
      capacity_needed: section.capacity_needed || "",
      duration_minutes: section.duration_minutes || "",
      allowed_days: section.allowed_days.join(","),
    }))
  );
}

export function saveRooms(data, rooms) {
  writeCsvFile(
    data.paths.rooms,
    ROOM_HEADERS,
    rooms.map((room) => ({
      room_id: room.id,
      room_name: room.name,
      building: room.building,
      capacity: room.capacity,
    }))
  );
}

export function saveGrid(data, grid) {
  writeCsvFile(
    data.paths.grid,
    GRID_HEADERS,
    [{
      first_day: DAYS[grid.first],
      last_day: DAYS[grid.last],
      start: formatHhmm(grid.start),
      end: formatHhmm(grid.end),
      slot_minutes: grid.slot_minutes,
    }]
  );
}

/** Save one professor file. `values` are the raw strings from the form. */
export function saveProfessorFile(file, values) {
  writeCsvFile(
    file,
    PROFESSOR_HEADERS,
    [{
      professor_id: String(values.professor_id ?? "").trim(),
      name: String(values.name ?? "").trim(),
      preferred_days: values.preferred_days.join(","),
      preferred_start: String(values.preferred_start ?? "").trim(),
      preferred_end: String(values.preferred_end ?? "").trim(),
      availability_start: String(values.availability_start ?? "").trim(),
      availability_end: String(values.availability_end ?? "").trim(),
      max_sections: String(values.max_sections ?? "").trim(),
    }]
  );
}

/** Save one subject file. `values` are the raw strings from the form. */
export function saveSubjectFile(file, values) {
  writeCsvFile(
    file,
    SUBJECT_HEADERS,
    [{
      subject_id: String(values.subject_id ?? "").trim(),
      course_name: String(values.course_name ?? "").trim(),
      default_duration_minutes: String(values.default_duration_minutes ?? "").trim(),
      default_capacity: String(values.default_capacity ?? "").trim(),
    }]
  );
}

/** Save the school name and term shown on the published timetable. */
export function saveSettings(data, settings) {
  writeCsvFile(
    data.paths.settings,
    SETTINGS_HEADERS,
    [{
      school_name: String(settings.school_name ?? "").trim(),
      term_label: String(settings.term_label ?? "").trim(),
      term_start: String(settings.term_start ?? "").trim(),
      term_end: String(settings.term_end ?? "").trim(),
    }]
  );
}

/** Accept either a solver placement (nested) or an already-flat row. */
function placementRows(placements) {
  return placements.map((placement) => {
    const flat = placement.section
      ? {
          section_id: placement.section.section_id,
          course_id: placement.section.course_id,
          course_name: placement.section.course_name,
          instructor: placement.section.instructor,
          room_id: placement.room.id,
          room_name: placement.room.name,
          day: placement.day,
          start: placement.start,
          end: placement.end,
        }
      : placement;

    return {
      section_id: flat.section_id,
      course_id: flat.course_id,
      course_name: flat.course_name,
      instructor: flat.instructor,
      room_id: flat.room_id,
      room_name: flat.room_name,
      day: flat.day,
      start: formatHhmm(flat.start),
      end: formatHhmm(flat.end),
    };
  });
}

/** Write a schedule-shaped CSV. */
export function writePlacements(file, placements) {
  writeCsvFile(file, SCHEDULE_HEADERS, placementRows(placements));
}

/** Write the published schedule.csv. */
export function saveSchedule(data, placements) {
  writePlacements(data.paths.schedule, placements);
}

/** Write the private working schedule. */
export function saveDraft(data, placements) {
  writePlacements(data.paths.draft, placements);
}

export function saveLocks(data, locks) {
  writeCsvFile(
    data.paths.locks,
    LOCK_HEADERS,
    locks.map((lock) => ({
      section_id: lock.section_id,
      room_id: lock.room_id,
      day: lock.day,
      start: formatHhmm(lock.start),
    }))
  );
}

export function saveVersions(data, versions) {
  writeCsvFile(
    data.paths.versions,
    VERSION_HEADERS,
    versions.map((version) => ({
      name: version.name,
      file: version.file,
      created_at: version.created_at,
      placed: version.placed,
      unplaced: version.unplaced,
      current: version.current ? "yes" : "no",
    }))
  );
}
