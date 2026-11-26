// solver.js - the scheduler itself.
//
// Two phases, repeated a few times with different random tie-breaks:
//   1. greedy: place the hardest sections first (biggest capacity, longest
//      duration) into the cheapest feasible slot;
//   2. local search: move sections to other slots while that removes conflicts.
//
// Compared with a naive version this prunes rooms to the few smallest that
// fit (rooms only differ by capacity) and counts conflicts directly instead of
// rebuilding the whole schedule for every candidate, so 150 sections stay fast.
// A time budget keeps the UI responsive: whatever is best when the budget runs
// out is returned.

import { DAYS, sectionDays } from "./data.js";

const ROOM_CHOICES = 4; // rooms are interchangeable apart from capacity
const MAX_PASSES = 50;

function makePlacement(section, room, day, start) {
  return { section, room, day, start, end: start + section.duration_minutes };
}

/** Every feasible (room, day, start) for a section. */
export function candidatesFor(section, grid, rooms, professors) {
  if (section.duration_minutes <= 0) return [];

  const professor = section.instructor ? professors.get(section.instructor) : null;
  const fitting = rooms
    .filter((room) => room.capacity >= section.capacity_needed)
    .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id))
    .slice(0, ROOM_CHOICES);
  if (fitting.length === 0) return [];
  if (sectionDays(section, grid).length === 0) return [];

  const candidates = [];
  for (const day of sectionDays(section, grid)) {
    for (
      let start = grid.start;
      start + section.duration_minutes <= grid.end;
      start += grid.slot_minutes
    ) {
      // Availability is a hard constraint.
      if (professor && professor.availability_start && professor.availability_end) {
        if (
          start < professor.availability_start ||
          start + section.duration_minutes > professor.availability_end
        ) {
          continue;
        }
      }
      for (const room of fitting) {
        candidates.push(makePlacement(section, room, day, start));
      }
    }
  }
  return candidates;
}

/** Soft preference score: 0 inside the professor's preferred window. */
export function placementPenalty(placement, professors) {
  const professor = placement.section.instructor
    ? professors.get(placement.section.instructor)
    : null;
  if (!professor) return 0;

  let penalty = 0;
  if (professor.preferred_days.length > 0 && !professor.preferred_days.includes(placement.day)) {
    penalty += 60;
  }
  if (professor.preferred_start && professor.preferred_end) {
    if (
      placement.start < professor.preferred_start ||
      placement.end > professor.preferred_end
    ) {
      penalty +=
        Math.max(professor.preferred_start - placement.start, 0) +
        Math.max(placement.end - professor.preferred_end, 0);
    }
  }
  return Math.min(penalty, 120);
}

function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/** Do two placements break a hard constraint? */
function conflictsPair(a, b) {
  if (!overlaps(a, b)) return false;
  const sameRoom = a.room.id === b.room.id;
  const sameInstructor =
    a.section.instructor !== "" && a.section.instructor === b.section.instructor;
  const sameCourse = a.section.course_id === b.section.course_id;
  return sameRoom || sameInstructor || sameCourse;
}

function violations(placed) {
  let count = 0;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (conflictsPair(placed[i], placed[j])) count += 1;
    }
  }
  return count;
}

/** Conflicts a candidate would add against already placed sections. */
function conflictsWith(candidate, placed, skipSectionId) {
  let count = 0;
  for (const other of placed) {
    if (other.section.section_id === skipSectionId) continue;
    if (conflictsPair(candidate, other)) count += 1;
  }
  return count;
}

function greedy(sections, professors, candidatesBySection) {
  const ordered = [...sections].sort(
    (a, b) =>
      b.capacity_needed - a.capacity_needed ||
      b.duration_minutes - a.duration_minutes ||
      a.section_id.localeCompare(b.section_id)
  );

  const placed = [];
  const perProfessor = new Map();

  for (const section of ordered) {
    const professor = section.instructor ? professors.get(section.instructor) : null;

    // Professor cap is a hard constraint.
    if (professor && professor.max_sections) {
      const teaching = perProfessor.get(professor.name) ?? 0;
      if (teaching >= professor.max_sections) continue;
    }

    // Cheapest feasible slot first, with a random tie-break so restarts differ.
    const options = (candidatesBySection.get(section.section_id) ?? []).map((candidate) => ({
      candidate,
      tie: Math.random(),
    }));
    options.sort(
      (a, b) =>
        placementPenalty(a.candidate, professors) - placementPenalty(b.candidate, professors) ||
        a.candidate.room.capacity - b.candidate.room.capacity ||
        DAYS.indexOf(a.candidate.day) - DAYS.indexOf(b.candidate.day) ||
        a.candidate.start - b.candidate.start ||
        a.tie - b.tie
    );

    for (const { candidate } of options) {
      if (conflictsWith(candidate, placed, section.section_id) === 0) {
        placed.push(candidate);
        if (professor) perProfessor.set(professor.name, (perProfessor.get(professor.name) ?? 0) + 1);
        break;
      }
    }
  }

  return placed;
}

/**
 * Move one section at a time to whichever alternative slot reduces the number
 * of conflicting pairs. Stops when no move helps or the time budget runs out.
 */
function localSearch(placed, candidatesBySection, deadline) {
  let currentViolations = violations(placed);

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (Date.now() > deadline) break;

    let best = null;
    for (const placement of placed) {
      const sectionId = placement.section.section_id;
      const others = placed.filter((item) => item.section.section_id !== sectionId);
      const base = violations(others);

      for (const candidate of candidatesBySection.get(sectionId) ?? []) {
        if (
          candidate.room.id === placement.room.id &&
          candidate.day === placement.day &&
          candidate.start === placement.start
        ) {
          continue;
        }
        const total = base + conflictsWith(candidate, others, sectionId);
        if (best === null || total < best.total) {
          best = { total, candidate, sectionId };
        }
      }
    }

    if (best === null || best.total >= currentViolations) break;
    currentViolations = best.total;
    const index = placed.findIndex((item) => item.section.section_id === best.sectionId);
    placed.splice(index, 1, best.candidate);
  }
}

/**
 * Solve the whole timetable.
 * Returns only the placements; unplaced sections are explained separately by
 * explainUnplaced().
 */
export function solve({ sections, rooms, grid, professors, budgetMs = 5000, restarts = 5 }) {
  const deadline = Date.now() + budgetMs;
  const candidatesBySection = new Map(
    sections.map((section) => [section.section_id, candidatesFor(section, grid, rooms, professors)])
  );

  let best = [];
  let bestKey = null;

  for (let run = 0; run < restarts; run += 1) {
    const placed = greedy(sections, professors, candidatesBySection);
    localSearch(placed, candidatesBySection, deadline);

    const key = [violations(placed), -placed.length];
    const better =
      bestKey === null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && key[1] < bestKey[1]);
    if (better) {
      best = placed;
      bestKey = key;
    }

    if (Date.now() >= deadline) break;
  }

  return best;
}

/** The instructor of a solver placement or a saved-schedule row. */
function instructorOf(placement) {
  return placement.section ? placement.section.instructor : placement.instructor;
}

/** Why could this section not be placed? Returns a short human sentence. */
export function explainUnplaced(section, { grid, rooms, professors, placed }) {
  if (section.duration_minutes <= 0) {
    return "No duration — set one on the section or its subject.";
  }
  if (section.duration_minutes > grid.end - grid.start) {
    return "Longer than the teaching day in the grid.";
  }

  const fitting = rooms.filter((room) => room.capacity >= section.capacity_needed);
  if (fitting.length === 0) {
    return `No room has ${section.capacity_needed} seats.`;
  }

  const professor = section.instructor ? professors.get(section.instructor) : null;
  if (professor && professor.max_sections) {
    const teaching = placed.filter(
      (placement) => instructorOf(placement) === professor.name
    ).length;
    if (teaching >= professor.max_sections) {
      return `The professor already teaches ${professor.max_sections} sections (the limit).`;
    }
  }

  const days = sectionDays(section, grid);
  if (days.length === 0) {
    return "None of its allowed days are inside the teaching grid.";
  }

  let hasStart = false;
  for (const day of days) {
    for (
      let start = grid.start;
      start + section.duration_minutes <= grid.end;
      start += grid.slot_minutes
    ) {
      if (professor && professor.availability_start && professor.availability_end) {
        if (
          start < professor.availability_start ||
          start + section.duration_minutes > professor.availability_end
        ) {
          continue;
        }
      }
      hasStart = true;
      break;
    }
    if (hasStart) break;
  }
  if (!hasStart) {
    return "No start time fits the professor's availability window.";
  }

  return "Every remaining slot clashes with a room, instructor or course already scheduled.";
}
