// frontend/schedule.ts - TypeScript source of the class-scheduler front end.
//
// schedule.py embeds the solved schedule and grid as the globals GRID and
// PLACEMENTS in schedule.html; this file draws the page: a timetable grid
// (main view) plus a table of the placed sections (below it).

interface Placement {
  section_id: string;
  course_id: string;
  course_name: string;
  instructor: string;
  room_id: string;
  room_name: string;
  day: string;
  start: number;  // minutes since midnight
  end: number;    // minutes since midnight
}

interface Grid {
  first_day: string;
  last_day: string;
  start: number;  // minutes since midnight
  end: number;
  slot_minutes: number;
}

declare const GRID: Grid;
declare const PLACEMENTS: Placement[];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// One color per course, in order of first appearance in PLACEMENTS.
const PALETTE = [
  "#4A90E2", "#50E3C2", "#B86CE3", "#F5A623", "#7ED321",
  "#D0021B", "#9013FE", "#417505", "#F8E71C", "#8B572A",
  "#00D1FF", "#FF9F1C",
];

function dayIndex(day: string): number {
  const idx = DAYS.indexOf(day);
  return idx === -1 ? 0 : idx;
}

function slotIndex(minutes: number): number {
  return Math.round((minutes - GRID.start) / GRID.slot_minutes);
}

function slotLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colorsFor(): Map<string, string> {
  const color = new Map<string, string>();
  let idx = 0;
  for (const p of PLACEMENTS) {
    if (!color.has(p.course_id)) {
      color.set(p.course_id, PALETTE[idx % PALETTE.length]);
      idx++;
    }
  }
  return color;
}

function attachTooltip(block: HTMLElement, p: Placement): void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.innerHTML =
    `<strong>${escapeHtml(p.section_id)}</strong> - ${escapeHtml(p.course_name)}` +
    ` (room: ${escapeHtml(p.room_name)})` +
    `<br>${escapeHtml(p.instructor)}` +
    `<br>${slotLabel(p.start)} - ${slotLabel(p.end)}`;
  tip.style.display = "none";
  document.body.appendChild(tip);
  block.addEventListener("mouseenter", () => {
    tip.style.display = "block";
    const r = block.getBoundingClientRect();
    tip.style.left = `${Math.min(r.right + 6, window.innerWidth - 160)}px`;
    tip.style.top = `${r.bottom + 6}px`;
  });
  block.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

function drawTimetable(): void {
  const colDays = DAYS.slice(DAYS.indexOf(GRID.first_day), DAYS.indexOf(GRID.last_day) + 1);
  const nDays = colDays.length;
  const nSlots = Math.max(1, Math.round((GRID.end - GRID.start) / GRID.slot_minutes));

  const timet = document.createElement("div");
  timet.className = "timetable";
  timet.style.display = "grid";
  timet.style.gridTemplateColumns = `60px repeat(${nDays}, 1fr)`;
  timet.style.gridTemplateRows = `40px repeat(${nSlots}, 1fr)`;
  timet.style.gap = "2px";

  const header = document.createElement("div");
  header.className = "row header";
  const corner = document.createElement("div");
  corner.className = "cell time";
  header.appendChild(corner);
  colDays.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "cell day";
    cell.textContent = day;
    header.appendChild(cell);
  });
  timet.appendChild(header);

  for (let k = 0; k < nSlots; k++) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("div");
    label.className = "cell time";
    label.textContent = slotLabel(GRID.start + k * GRID.slot_minutes);
    row.appendChild(label);
    for (let c = 0; c < nDays; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      row.appendChild(cell);
    }
    timet.appendChild(row);
  }

  const colors = colorsFor();
  PLACEMENTS.forEach((p) => {
    const block = document.createElement("div");
    block.className = "block";
    block.textContent = p.course_id;
    block.style.background = colors.get(p.course_id) || "#888888";
    block.style.gridColumn = `${2 + dayIndex(p.day)}`;
    block.style.gridRow = `${2 + slotIndex(p.start)} / ${2 + slotIndex(p.end)}`;
    timet.appendChild(block);
    attachTooltip(block, p);
  });

  document.body.appendChild(timet);
}

function drawTable(): void {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Section", "Course", "Instructor", "Room", "Day", "Start", "End"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sorted = [...PLACEMENTS].sort((a, b) =>
    (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) ||
    (a.start - b.start) ||
    a.section_id.localeCompare(b.section_id)
  );
  sorted.forEach((p) => {
    const tr = document.createElement("tr");
    [p.section_id, p.course_name, p.instructor, p.room_name, p.day,
     slotLabel(p.start), slotLabel(p.end)].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  document.body.appendChild(table);
}

drawTimetable();
drawTable();
