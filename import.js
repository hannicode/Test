// import.js - turning a pasted or uploaded CSV into a change you can inspect
// before it touches the disk.
//
// The important rule: nothing is written until you have seen the diff and
// confirmed. An import is therefore two steps -
//   prepareImport()  parse, merge with what exists, validate, describe changes
//   applyImport()    write the rows in the mode you chose
//
// A file may contain only some columns ("just the section ids and teachers,
// please"). Missing columns keep their current value on a merge, which is why
// the merge happens before validation: a row that changes only the instructor
// still has to keep a valid course id from the existing row.

import fs from "node:fs";
import path from "node:path";

import { parseCsv } from "./csv.js";
import {
  SECTION_HEADERS,
  ROOM_HEADERS,
  PROFESSOR_HEADERS,
  SUBJECT_HEADERS,
  splitDays,
  toInt,
  formatHhmm,
  saveSections,
  saveRooms,
  saveProfessorFile,
  saveSubjectFile,
} from "./data.js";
import {
  validateSection,
  validateProfessor,
  validateSubject,
  validateRoom,
} from "./validate.js";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// --- existing rows, converted back to the strings a CSV would hold ----------

function rowFromSection(section) {
  return {
    section_id: section.section_id,
    course_id: section.course_id,
    course_name: section.course_name,
    instructor: section.instructor,
    capacity_needed: section.capacity_needed ? String(section.capacity_needed) : "",
    duration_minutes: section.duration_minutes ? String(section.duration_minutes) : "",
    allowed_days: section.allowed_days.join(","),
  };
}

function rowFromRoom(room) {
  return {
    room_id: room.id,
    room_name: room.name,
    building: room.building,
    capacity: String(room.capacity),
  };
}

function rowFromProfessor(professor) {
  return {
    professor_id: professor.id,
    name: professor.name,
    preferred_days: professor.preferred_days.join(","),
    preferred_start: professor.preferred_start ? formatHhmm(professor.preferred_start) : "",
    preferred_end: professor.preferred_end ? formatHhmm(professor.preferred_end) : "",
    availability_start: professor.availability_start ? formatHhmm(professor.availability_start) : "",
    availability_end: professor.availability_end ? formatHhmm(professor.availability_end) : "",
    max_sections: professor.max_sections ? String(professor.max_sections) : "",
  };
}

function rowFromSubject(subject) {
  return {
    subject_id: subject.id,
    course_name: subject.course_name,
    default_duration_minutes: subject.default_duration_minutes ? String(subject.default_duration_minutes) : "",
    default_capacity: subject.default_capacity ? String(subject.default_capacity) : "",
  };
}

// --- rows to records, ready for the existing savers -------------------------

function sectionFromRow(row) {
  return {
    section_id: row.section_id,
    course_id: row.course_id ?? "",
    course_name: row.course_name ?? "",
    instructor: row.instructor ?? "",
    capacity_needed: toInt(row.capacity_needed, 0),
    duration_minutes: toInt(row.duration_minutes, 0),
    allowed_days: splitDays(row.allowed_days),
  };
}

function roomFromRow(row) {
  return {
    id: row.room_id,
    name: row.room_name ?? "",
    building: row.building ?? "",
    capacity: toInt(row.capacity, 0),
  };
}

// --- the four things a school can import -----------------------------------

const KINDS = {
  sections: {
    label: "Sections",
    columns: SECTION_HEADERS,
    idColumn: "section_id",
    existingRows: (data) => data.sections.map(rowFromSection),
    values: (row) => ({
      section_id: row.section_id ?? "",
      course_id: row.course_id ?? "",
      course_name: row.course_name ?? "",
      instructor: row.instructor ?? "",
      capacity_needed: row.capacity_needed ?? "",
      duration_minutes: row.duration_minutes ?? "",
      allowed_days: splitDays(row.allowed_days),
    }),
    validate: (values, context) => validateSection(values, context),
    save: (data, rows) => saveSections(data, rows.map(sectionFromRow)),
  },

  professors: {
    label: "Professors",
    columns: PROFESSOR_HEADERS,
    idColumn: "professor_id",
    existingRows: (data) => data.professorList.map(rowFromProfessor),
    values: (row) => ({
      professor_id: row.professor_id ?? "",
      name: row.name ?? "",
      preferred_days: splitDays(row.preferred_days),
      preferred_start: row.preferred_start ?? "",
      preferred_end: row.preferred_end ?? "",
      availability_start: row.availability_start ?? "",
      availability_end: row.availability_end ?? "",
      max_sections: row.max_sections ?? "",
    }),
    validate: (values, context) => validateProfessor(values, context),
    save: (data, rows) => {
      for (const row of rows) {
        saveProfessorFile(path.join(data.paths.professors, `${row.professor_id}.csv`), {
          professor_id: row.professor_id,
          name: row.name ?? "",
          preferred_days: splitDays(row.preferred_days),
          preferred_start: row.preferred_start ?? "",
          preferred_end: row.preferred_end ?? "",
          availability_start: row.availability_start ?? "",
          availability_end: row.availability_end ?? "",
          max_sections: row.max_sections ?? "",
        });
      }
    },
    // One file per professor, so a replace has to delete the leftovers.
    existingIds: (data) => data.professorList.map((professor) => professor.id),
    remove: (data, id) => {
      const professor = data.professorList.find((item) => item.id === id);
      if (professor) fs.unlinkSync(professor.file);
    },
  },

  subjects: {
    label: "Subjects",
    columns: SUBJECT_HEADERS,
    idColumn: "subject_id",
    existingRows: (data) => data.subjectList.map(rowFromSubject),
    values: (row) => ({
      subject_id: row.subject_id ?? "",
      course_name: row.course_name ?? "",
      default_duration_minutes: row.default_duration_minutes ?? "",
      default_capacity: row.default_capacity ?? "",
    }),
    validate: (values, context) => validateSubject(values, context),
    save: (data, rows) => {
      for (const row of rows) {
        saveSubjectFile(path.join(data.paths.subjects, `${row.subject_id}.csv`), {
          subject_id: row.subject_id,
          course_name: row.course_name ?? "",
          default_duration_minutes: row.default_duration_minutes ?? "",
          default_capacity: row.default_capacity ?? "",
        });
      }
    },
    existingIds: (data) => data.subjectList.map((subject) => subject.id),
    remove: (data, id) => {
      const subject = data.subjectList.find((item) => item.id === id);
      if (subject) fs.unlinkSync(subject.file);
    },
  },

  rooms: {
    label: "Rooms",
    columns: ROOM_HEADERS,
    idColumn: "room_id",
    existingRows: (data) => data.rooms.map(rowFromRoom),
    values: (row) => ({
      room_id: row.room_id ?? "",
      room_name: row.room_name ?? "",
      building: row.building ?? "",
      capacity: row.capacity ?? "",
    }),
    validate: (values, context) => validateRoom(values, context),
    save: (data, rows) => saveRooms(data, rows.map(roomFromRow)),
  },
};

/** What the import page offers in its dropdown. */
export function importKinds() {
  return Object.entries(KINDS).map(([value, spec]) => ({ value, label: spec.label }));
}

export function importKindLabel(kind) {
  return KINDS[kind]?.label ?? kind;
}

/** The header a blank file of this kind would have, for the help text. */
export function importColumns(kind) {
  return KINDS[kind]?.columns ?? [];
}

// ---------------------------------------------------------------------------
// Step 1: prepare
// ---------------------------------------------------------------------------

export function prepareImport(kindName, text, data) {
  const spec = KINDS[kindName];
  if (!spec) {
    return { errors: [`Unknown import type "${kindName}".`], warnings: [] };
  }

  const table = parseCsv(String(text ?? ""));
  const warnings = [];

  if (table.length === 0) {
    return { kind: kindName, label: spec.label, errors: ["Nothing to import - the text is empty."], warnings };
  }

  const headers = table[0].map((header) => header.trim());
  const presentColumns = spec.columns.filter((column) => headers.includes(column));
  const ignoredColumns = [...new Set(headers.filter((header) => header !== "" && !spec.columns.includes(header)))];
  const missingColumns = spec.columns.filter((column) => !headers.includes(column));

  const prepared = {
    kind: kindName,
    label: spec.label,
    idColumn: spec.idColumn,
    presentColumns,
    ignoredColumns,
    missingColumns,
    rows: [],
    merged: [],
    diff: { added: [], changed: [], unchanged: [], missing: [] },
    errors: [],
    warnings,
  };

  if (!headers.includes(spec.idColumn)) {
    prepared.errors.push(
      `The file needs a "${spec.idColumn}" column. It has: ${headers.filter(Boolean).join(", ") || "no columns"}.`
    );
    return prepared;
  }

  if (ignoredColumns.length > 0) {
    warnings.push(`Ignored unrecognised column(s): ${ignoredColumns.join(", ")}.`);
  }

  // Read the rows we recognise. Blank lines are not data.
  table.slice(1).forEach((cells, index) => {
    const row = {};
    headers.forEach((header, column) => {
      if (spec.columns.includes(header)) row[header] = (cells[column] ?? "").trim();
    });
    if (Object.values(row).every((value) => value === "")) return;
    prepared.rows.push({ line: index + 2, row });
  });

  if (prepared.rows.length === 0) {
    prepared.errors.push("The file has a header row but no data rows.");
    return prepared;
  }

  // Ids: present, well formed, unique inside the file.
  const seenIds = new Map();
  for (const { line, row } of prepared.rows) {
    const id = row[spec.idColumn] ?? "";
    if (id === "") {
      prepared.errors.push(`Line ${line}: ${spec.idColumn} is blank.`);
      continue;
    }
    if (!ID_PATTERN.test(id)) {
      prepared.errors.push(`Line ${line}: "${id}" may only contain letters, numbers, dashes and underscores.`);
    }
    if (seenIds.has(id)) {
      prepared.errors.push(`Line ${line}: ${id} appears twice (first on line ${seenIds.get(id)}).`);
    } else {
      seenIds.set(id, line);
    }
  }

  // Two professors with the same name would make "who teaches this" ambiguous.
  if (kindName === "professors") {
    const seenNames = new Map();
    for (const { line, row } of prepared.rows) {
      const name = String(row.name ?? "").trim();
      if (name === "") continue;
      if (seenNames.has(name)) {
        prepared.errors.push(`Line ${line}: the name "${name}" appears twice (first on line ${seenNames.get(name)}).`);
      } else {
        seenNames.set(name, line);
      }
    }
  }

  // Merge: imported values win, everything else in the existing row stays.
  const existing = new Map(spec.existingRows(data).map((row) => [row[spec.idColumn], row]));
  const merged = new Map(existing);
  const incomingIds = new Set();
  for (const { row } of prepared.rows) {
    const id = row[spec.idColumn];
    if (!id) continue;
    incomingIds.add(id);
    merged.set(id, { ...(existing.get(id) ?? {}), ...row });
  }
  prepared.merged = [...merged.values()];

  // Validate the merged result, so a partial row is judged together with the
  // values it is keeping.
  for (const id of incomingIds) {
    const raw = merged.get(id);
    if (!raw) continue;
    const originalId = existing.has(id) ? id : "";
    const result = spec.validate(spec.values(raw), { data, originalId });
    for (const error of result.errors) prepared.errors.push(`${id}: ${error}`);
    for (const warning of result.warnings) prepared.warnings.push(`${id}: ${warning}`);
  }

  // The diff, in the words the preview page uses.
  const changedColumns = (row, before) =>
    presentColumns.filter(
      (column) => String(row[column] ?? "").trim() !== String(before[column] ?? "").trim()
    );

  for (const { row } of prepared.rows) {
    const id = row[spec.idColumn];
    if (!id) continue;

    const before = existing.get(id);
    if (!before) {
      prepared.diff.added.push({ id, row });
      continue;
    }

    const changes = changedColumns(row, before).map((column) => ({
      column,
      from: before[column] ?? "",
      to: row[column] ?? "",
    }));

    if (changes.length === 0) prepared.diff.unchanged.push(id);
    else prepared.diff.changed.push({ id, row, changes });
  }

  for (const [id, row] of existing) {
    if (!incomingIds.has(id)) prepared.diff.missing.push({ id, row });
  }

  return prepared;
}

/** A one-line summary for the flash message after an import. */
export function describeDiff(diff) {
  return `${diff.added.length} new, ${diff.changed.length} changed, ${diff.unchanged.length} unchanged`;
}

// ---------------------------------------------------------------------------
// Step 2: apply
// ---------------------------------------------------------------------------

/**
 * Write a prepared import.
 *   mode "merge"   - update what was in the file, keep everything else
 *   mode "replace" - the file becomes the whole list
 */
export function applyImport(kindName, prepared, mode, data) {
  const spec = KINDS[kindName];
  if (!spec) throw new Error(`Unknown import type "${kindName}".`);

  const rows = mode === "replace" ? prepared.rows.map(({ row }) => row) : prepared.merged;

  if (mode === "replace" && spec.existingIds) {
    const keep = new Set(rows.map((row) => row[spec.idColumn]));
    for (const id of spec.existingIds(data)) {
      if (!keep.has(id)) spec.remove(data, id);
    }
  }

  spec.save(data, rows);
  return rows.length;
}
