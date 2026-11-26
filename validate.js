// validate.js - the rules that decide whether a form may be written to disk.
//
// Two kinds of feedback:
//   errors   - the save is refused (the data would be structurally broken)
//   warnings - the save is allowed, but something probably needs attention
//              (for example a section naming a professor who has no file yet)
//
// Structural problems are blocked because CSVs are the source of truth;
// dangling references are only warned about so you can create things in any order.

import { DAYS, parseHhmm, splitDays } from "./data.js";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

function isCount(value) {
  return isBlank(value) || /^\d+$/.test(String(value).trim());
}

function checkId(id, label, { existingIds, originalId, errors }) {
  if (isBlank(id)) {
    errors.push(`${label} is required — it is also the file name.`);
    return;
  }
  if (!ID_PATTERN.test(id)) {
    errors.push(`${label} may only contain letters, numbers, dashes and underscores.`);
    return;
  }
  if (id !== originalId && existingIds.has(id)) {
    errors.push(`A file for ${id} already exists.`);
  }
}

/** Both times blank, or both valid and in order. */
function checkWindow(start, end, label, errors) {
  const from = isBlank(start) ? null : parseHhmm(start);
  const to = isBlank(end) ? null : parseHhmm(end);

  if (from === null && to === null) return;
  if (from === null || to === null) {
    errors.push(`${label}: fill in both times, or leave both blank.`);
    return;
  }
  if (from >= to) errors.push(`${label}: the start must be earlier than the end.`);
}

export function validateProfessor(values, { data, originalId }) {
  const errors = [];
  const warnings = [];
  const id = String(values.professor_id ?? "").trim();
  const name = String(values.name ?? "").trim();

  const existingIds = new Set(data.professorList.map((professor) => professor.id));
  checkId(id, "Professor id", { existingIds, originalId, errors });

  if (!name) {
    errors.push("Name is required — sections match their professor by this name.");
  } else {
    const clash = data.professorList.find(
      (professor) => professor.name === name && professor.id !== originalId
    );
    if (clash) errors.push(`Another professor is already named "${name}".`);
  }

  const days = Array.isArray(values.preferred_days) ? values.preferred_days : splitDays(values.preferred_days);
  const badDays = days.filter((day) => !DAYS.includes(day));
  if (badDays.length > 0) errors.push(`Unknown day(s): ${badDays.join(", ")}.`);

  checkWindow(values.preferred_start, values.preferred_end, "Preferred hours", errors);
  checkWindow(values.availability_start, values.availability_end, "Availability", errors);

  if (!isCount(values.max_sections)) {
    errors.push("Max sections must be a whole number (or blank for no limit).");
  }

  if (originalId) {
    const previous = data.professorList.find((professor) => professor.id === originalId);
    if (previous && previous.name !== name && data.sections.some((section) => section.instructor === previous.name)) {
      warnings.push(
        `Sections still say "${previous.name}". Update them to "${name}" or they will not use this professor's availability.`
      );
    }
  }

  return { errors, warnings };
}

export function validateSubject(values, { data, originalId }) {
  const errors = [];
  const warnings = [];
  const id = String(values.subject_id ?? "").trim();

  const existingIds = new Set(data.subjectList.map((subject) => subject.id));
  checkId(id, "Subject id", { existingIds, originalId, errors });

  if (isBlank(values.course_name)) {
    warnings.push("No course name — the timetable will show the subject id only.");
  }
  if (!isCount(values.default_duration_minutes)) {
    errors.push("Default duration must be a whole number of minutes (or blank).");
  }
  if (!isCount(values.default_capacity)) {
    errors.push("Default capacity must be a whole number (or blank).");
  }

  if (!originalId) {
    const used = data.sections.filter((section) => section.course_id === id).length;
    if (used === 0) warnings.push(`No sections use ${id} yet.`);
  }

  return { errors, warnings };
}

export function validateSection(values, { data, originalId }) {
  const errors = [];
  const warnings = [];
  const id = String(values.section_id ?? "").trim();

  const existingIds = new Set(data.sections.map((section) => section.section_id));
  checkId(id, "Section id", { existingIds, originalId, errors });

  if (isBlank(values.course_id)) {
    errors.push("Course id is required — it links the section to its subject file.");
  }
  if (!isCount(values.capacity_needed)) {
    errors.push("Capacity needed must be a whole number (or blank for any room).");
  }
  if (!isCount(values.duration_minutes)) {
    errors.push("Duration must be a whole number of minutes (or blank for the subject default).");
  }

  const days = Array.isArray(values.allowed_days) ? values.allowed_days : splitDays(values.allowed_days);
  const badDays = days.filter((day) => !DAYS.includes(day));
  if (badDays.length > 0) errors.push(`Unknown day(s): ${badDays.join(", ")}.`);

  if (!isBlank(values.course_id) && !data.subjects.has(String(values.course_id).trim())) {
    warnings.push(`No subject file for ${values.course_id} — no duration or capacity defaults are applied.`);
  }
  if (!isBlank(values.instructor) && !data.professors.has(String(values.instructor).trim())) {
    warnings.push(`No professor file named "${values.instructor}" — availability and preferences are skipped.`);
  }
  if (isBlank(values.duration_minutes)) {
    const subject = data.subjects.get(String(values.course_id).trim());
    if (!subject || !subject.default_duration_minutes) {
      warnings.push("No duration and no subject default, so this section cannot be placed.");
    }
  }

  return { errors, warnings };
}

export function validateRoom(values, { data, originalId }) {
  const errors = [];
  const warnings = [];
  const id = String(values.room_id ?? "").trim();

  const existingIds = new Set(data.rooms.map((room) => room.id));
  checkId(id, "Room id", { existingIds, originalId, errors });

  if (!isCount(values.capacity) || Number(values.capacity) <= 0) {
    errors.push("Capacity must be a whole number greater than 0.");
  }
  if (isBlank(values.room_name)) {
    warnings.push("No room name — the timetable will show the room id only.");
  }

  return { errors, warnings };
}

export function validateGrid(values) {
  const errors = [];
  const warnings = [];

  const first = DAYS.indexOf(String(values.first_day ?? "").trim());
  const last = DAYS.indexOf(String(values.last_day ?? "").trim());
  if (first < 0 || last < 0) errors.push("First and last day must be real days of the week.");
  else if (first > last) errors.push("The first day must not come after the last day.");

  const start = parseHhmm(values.start);
  const end = parseHhmm(values.end);
  if (start === null || end === null) {
    errors.push("Start and end must look like 07:00 and 21:00.");
  } else if (start >= end) {
    errors.push("The end time must be after the start time.");
  }

  const slot = Number(String(values.slot_minutes ?? "").trim());
  if (!Number.isInteger(slot) || slot <= 0) {
    errors.push("Slot length must be a whole number of minutes greater than 0.");
  } else if (start !== null && end !== null && (end - start) % slot !== 0) {
    errors.push("The slot length must divide the teaching day exactly (for example 30 or 60).");
  }

  return { errors, warnings };
}
