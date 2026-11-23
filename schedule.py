#!/usr/bin/env python3
"""Automatic class scheduler for the college.

Places course sections into rooms and time slots (course/section timetabling).

Usage:
    python schedule.py [--sections data/sections.csv] [--rooms data/rooms.csv]
                       [--grid data/grid.csv] [--out schedule.csv]

How it works (greedy + local search):
  * greedy: place the largest sections first, each into the first feasible
    (room, day, start) slot;
  * local search: repeatedly move a section to an alternative slot when that
    reduces the number of hard-constraint violations;
  * a handful of randomized restarts; the best schedule is kept.

Hard constraints (always hold):
  * room capacity: a section's `capacity_needed` must fit the room's `capacity`;
  * room conflict: no two placed sections in the same room on the same day
    overlap in time;
  * instructor conflict: no two placed sections with the same non-blank
    instructor overlap in time on the same day;
  * same-course overlap: no two placed sections of the same course overlap in
    time on the same day.

Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import csv
import random
from dataclasses import dataclass
from pathlib import Path

# Day names, in order, for the whole week.
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def parse_hhmm(text: str) -> int:
    """Parse 'HH:MM' into minutes since midnight (e.g. '07:00' -> 420)."""
    hour, minute = text.strip().split(":")
    return int(hour) * 60 + int(minute)


def format_hhmm(minutes: int) -> str:
    """Format minutes since midnight back to 'HH:MM' (e.g. 420 -> '07:00')."""
    hours, minute = divmod(minutes, 60)
    return f"{hours:02d}:{minute:02d}"


@dataclass
class Grid:
    """The global time grid: days of the week, a start/end bound, slot length."""

    first_day: int       # index into DAYS
    last_day: int        # index into DAYS, inclusive
    start: int           # first allowed start time, minutes since midnight
    end: int             # last allowed end bound, minutes since midnight
    slot_minutes: int    # starts are placed on multiples of this since `start`

    def allowed_days(self) -> list[str]:
        return DAYS[self.first_day: self.last_day + 1]


@dataclass
class Room:
    room_id: str
    room_name: str
    building: str
    capacity: int


@dataclass
class Section:
    section_id: str
    course_id: str
    course_name: str
    instructor: str
    capacity_needed: int
    duration_minutes: int
    allowed_days: list[str]  # day names; blank input = any grid day


@dataclass
class Placement:
    section: Section
    room: Room
    day: str    # day name
    start: int  # minutes since midnight
    end: int    # start + duration


def _to_int(text, default: int) -> int:
    """Parse an integer from a CSV cell; blank cells fall back to `default`."""
    text = (text or "").strip()
    if not text:
        return default
    return int(text)


def _day_index(text, path: Path) -> int:
    try:
        return DAYS.index(text.strip())
    except (ValueError, AttributeError):
        raise ValueError(f"{path}: days must be one of {', '.join(DAYS)} (got {text!r})")


def read_grid(path: Path) -> Grid:
    with path.open(newline="", encoding="utf-8") as f:
        rows = [row for row in csv.DictReader(f) if any((v or "").strip() for v in row.values())]
    if not rows:
        raise ValueError(f"{path}: expected one row with first_day, last_day, start, end, slot_minutes")
    row = rows[0]
    first_day = _day_index(row.get("first_day"), path)
    last_day = _day_index(row.get("last_day"), path)
    if first_day > last_day:
        raise ValueError(f"{path}: first_day must not be after last_day")
    try:
        start = parse_hhmm(row.get("start") or "")
        end = parse_hhmm(row.get("end") or "")
    except ValueError:
        raise ValueError(f"{path}: start and end must be 'HH:MM' strings (e.g. '07:00', '21:00')")
    slot_minutes = _to_int(row.get("slot_minutes"), 30)
    if slot_minutes <= 0 or end <= start or (end - start) % slot_minutes != 0:
        raise ValueError(f"{path}: end must be after start and end - start must be a multiple of slot_minutes")
    return Grid(first_day=first_day, last_day=last_day, start=start, end=end, slot_minutes=slot_minutes)


def read_rooms(path: Path) -> list[Room]:
    rooms = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not (row.get("room_id") or "").strip():
                continue
            rooms.append(Room(
                room_id=(row.get("room_id") or "").strip(),
                room_name=(row.get("room_name") or "").strip(),
                building=(row.get("building") or "").strip(),
                capacity=_to_int(row.get("capacity"), 0),
            ))
    return rooms


def read_sections(path: Path) -> list[Section]:
    sections = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not (row.get("section_id") or "").strip():
                continue
            allowed = [d.strip() for d in (row.get("allowed_days") or "").split(",") if d.strip()]
            sections.append(Section(
                section_id=(row.get("section_id") or "").strip(),
                course_id=(row.get("course_id") or "").strip(),
                course_name=(row.get("course_name") or "").strip(),
                instructor=(row.get("instructor") or "").strip(),
                capacity_needed=_to_int(row.get("capacity_needed"), 0),
                duration_minutes=_to_int(row.get("duration_minutes"), 0),
                allowed_days=allowed,
            ))
    return sections


def section_days(section: Section, grid: Grid) -> list[str]:
    """The days the section can be placed on: allowed_days, else every grid day."""
    if not section.allowed_days:
        return grid.allowed_days()
    wanted = set(section.allowed_days)
    return [d for d in grid.allowed_days() if d in wanted]


def candidate_placements(section: Section, grid: Grid, rooms: list[Room]) -> list[Placement]:
    """Every feasible (room, day, start) placement for the section."""
    cands = []
    for day in section_days(section, grid):
        for k in range((grid.end - grid.start) // grid.slot_minutes + 1):
            start = grid.start + k * grid.slot_minutes
            if start + section.duration_minutes > grid.end:
                break
            for room in rooms:
                if room.capacity >= section.capacity_needed:
                    cands.append(Placement(section, room, day, start, start + section.duration_minutes))
    return cands


def overlaps(a: Placement, b: Placement) -> bool:
    """Two placements overlap: same day and intersecting [start, end) intervals."""
    return a.day == b.day and a.start < b.end and b.start < a.end


def conflicts_pair(a: Placement, b: Placement) -> bool:
    """Do the two placements violate a hard constraint?

    They must overlap in time on the same day and share a room, or a non-blank
    instructor, or a course.
    """
    if not overlaps(a, b):
        return False
    shares_room = a.room.room_id == b.room.room_id
    shares_instructor = bool(a.section.instructor) and a.section.instructor == b.section.instructor
    shares_course = a.section.course_id == b.section.course_id
    return shares_room or shares_instructor or shares_course


def count_violations(placed: list[Placement]) -> int:
    """Number of conflicting pairs among the placed sections."""
    n = 0
    for i, a in enumerate(placed):
        for b in placed[i + 1:]:
            if conflicts_pair(a, b):
                n += 1
    return n


def placement_has_conflicts(candidate: Placement, placed: list[Placement], skip_section_id: str) -> int:
    """Violations placing `candidate` on top of `placed`, ignoring `skip_section_id`."""
    n = 0
    for other in placed:
        if other.section.section_id == skip_section_id:
            continue
        if conflicts_pair(candidate, other):
            n += 1
    return n


def greedy_schedule(sections, rooms, grid, rng) -> list[Placement]:
    """Place the largest sections first, each into the first feasible slot."""
    ordered = sorted(sections, key=lambda s: (-s.capacity_needed, -s.duration_minutes, s.section_id))
    placed: list[Placement] = []
    for section in ordered:
        cands = candidate_placements(section, grid, rooms)
        # Smallest fitting room, earliest day, earliest start; random tie-break.
        cands.sort(key=lambda p: (p.room.capacity, DAYS.index(p.day), p.start, rng.random()))
        for cand in cands:
            if placement_has_conflicts(cand, placed, section.section_id) == 0:
                placed.append(cand)
                break
    return placed


def local_search(placed, candidate_map, max_passes: int = 50) -> list[Placement]:
    """Repeatedly move a section to an alternative slot while it reduces violations."""
    current = list(placed)
    current_viol = count_violations(current)
    for _ in range(max_passes):
        best_move = None  # (violations, section_id, candidate)
        for placement in current:
            sid = placement.section.section_id
            for cand in candidate_map.get(sid, []):
                if cand.room.room_id == placement.room.room_id and cand.day == placement.day and cand.start == placement.start:
                    continue
                trial = [p for p in current if p.section.section_id != sid]
                trial.append(cand)
                viol = count_violations(trial)
                if best_move is None or viol < best_move[0]:
                    best_move = (viol, sid, cand)
        if best_move is None or best_move[0] >= current_viol:
            break
        current_viol = best_move[0]
        current = [p for p in current if p.section.section_id != best_move[1]]
        current.append(best_move[2])
    return current


def solve(sections, rooms, grid, restarts: int = 5, seed: int = 0) -> list[Placement]:
    """Run greedy + local search a few times, keep the best schedule."""
    rng = random.Random(seed)
    candidate_map = {s.section_id: candidate_placements(s, grid, rooms) for s in sections}
    best = None
    best_key = None
    for _ in range(restarts):
        placed = greedy_schedule(sections, rooms, grid, rng)
        placed = local_search(placed, candidate_map)
        key = (count_violations(placed), -len(placed))
        if best_key is None or key < best_key:
            best, best_key = placed, key
    return best


def write_schedule(placed, out_path: Path) -> None:
    """Write the schedule as CSV: one row per placed section."""
    placed_sorted = sorted(placed, key=lambda p: (DAYS.index(p.day), p.start, p.section.section_id))
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["section_id", "course_id", "course_name", "instructor",
                         "room_id", "room_name", "day", "start", "end"])
        for p in placed_sorted:
            s = p.section
            writer.writerow([s.section_id, s.course_id, s.course_name, s.instructor,
                             p.room.room_id, p.room.room_name, p.day,
                             format_hhmm(p.start), format_hhmm(p.end)])


def main() -> int:
    parser = argparse.ArgumentParser(description="Place course sections into rooms and time slots automatically.")
    parser.add_argument("--sections", default="data/sections.csv", help="sections CSV (default: data/sections.csv)")
    parser.add_argument("--rooms", default="data/rooms.csv", help="rooms CSV (default: data/rooms.csv)")
    parser.add_argument("--grid", default="data/grid.csv", help="time grid CSV (default: data/grid.csv)")
    parser.add_argument("--out", default="schedule.csv", help="output schedule CSV (default: schedule.csv)")
    args = parser.parse_args()

    grid = read_grid(Path(args.grid))
    rooms = read_rooms(Path(args.rooms))
    sections = read_sections(Path(args.sections))

    placed = solve(sections, rooms, grid)
    write_schedule(placed, Path(args.out))

    print(f"Placed {len(placed)}/{len(sections)} sections ({len(sections) - len(placed)} unplaced).")
    print(f"Schedule written to {args.out}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
