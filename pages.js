// pages.js - every page is a string of HTML built here.
//
// server.js decides *which* page to show and supplies the data; this module
// decides what it looks like. Keeping the HTML in one place makes it easy to
// find and change a label or a layout.

import { DAYS, formatHhmm } from "./data.js";
import { placementPenalty } from "./solver.js";

const PALETTE = [
  "#BBDEFB", "#D1C4E9", "#C8E6C9", "#FFF3E0", "#FCE4EC",
  "#E0F7FA", "#FFF9C4", "#E8EAF6", "#B2DFDB", "#F0F4C3",
];

// Styles shared by the app and the exported schedule.html.
const TIMETABLE_CSS = `
:root { --line: #e4e4e7; --muted: #71717a; }
.timetable { display: grid; gap: 2px; margin: 4px 0 22px; }
.timetable .cell { background: #fff; border: 1px solid var(--line); border-radius: 4px; font-size: 11px; }
.timetable .cell.day { background: #f4f5f7; color: #3f3f46; font-weight: 700; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; display: grid; place-items: center; }
.timetable .cell.time { background: #f8f9fb; color: var(--muted); font-weight: 600; display: flex; align-items: flex-start; justify-content: flex-end; padding: 3px 6px 0 0; }
.timetable .cell.corner { background: #f4f5f7; }
.band { border-radius: 6px; pointer-events: none; z-index: 1; }
.band-availability { background: rgba(16, 185, 129, .13); border: 1px dashed rgba(5, 150, 105, .4); }
.band-preferred { background: rgba(59, 130, 246, .13); border: 1px dashed rgba(37, 99, 235, .4); }
.unit { position: relative; z-index: 2; min-width: 0; }
.block { position: absolute; inset: 0; border-radius: 8px; border: 1px solid rgba(0, 0, 0, .06); box-shadow: 0 1px 3px rgba(16, 24, 40, .16), 0 1px 2px rgba(16, 24, 40, .08); display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; overflow: hidden; line-height: 1.25; }
.block-course { display: block; font-size: 12px; font-weight: 800; }
.block-meta { display: block; font-size: 10px; color: #3f3f46; }
.block-short { justify-content: center; }
.block-short .block-meta { display: none; }
.block-warn { outline: 2px solid #f59e0b; outline-offset: -2px; }
.lock-form { position: absolute; inset: 0; margin: 0; }
.block-button { width: 100%; height: 100%; font: inherit; text-align: left; cursor: pointer; }
.block-button:hover { filter: brightness(.95); }
.block-locked { outline: 2px solid #18181b; outline-offset: -2px; }
.block-locked::after { content: "LOCKED"; position: absolute; top: 4px; right: 5px; font-size: 8px; font-weight: 800; letter-spacing: .08em; color: #3f3f46; }
.tip { display: none; position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 60; width: max-content; max-width: 280px; background: #18181b; color: #fff; border-radius: 8px; padding: 8px 10px; font-size: 11px; line-height: 1.35; white-space: pre-line; box-shadow: 0 10px 30px rgba(0, 0, 0, .3); font-weight: 500; }
.unit:hover { z-index: 50; }
.unit:hover .tip { display: block; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; }
.swatch-availability { background: rgba(16, 185, 129, .25); border: 1px dashed rgba(5, 150, 105, .6); }
.swatch-preferred { background: rgba(59, 130, 246, .25); border: 1px dashed rgba(37, 99, 235, .6); }
.swatch-warn { background: #fff; outline: 2px solid #f59e0b; outline-offset: -2px; }
`;

const EXPORT_CSS = `
${TIMETABLE_CSS}
body { margin: 0; background: #f5f6f8; color: #18181b; font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; }
main.export { max-width: 1400px; margin: 0 auto; padding: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 18px; }
.table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.table th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: #fafafb; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.table td { padding: 9px 12px; border-bottom: 1px solid var(--line); }
.table tr:last-child td { border-bottom: none; }
`;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Normalise a solver placement or a saved-schedule row to the flat shape. */
function flat(placement) {
  if (!placement.section) return placement;
  return {
    section_id: placement.section.section_id,
    course_id: placement.section.course_id,
    course_name: placement.section.course_name,
    instructor: placement.section.instructor,
    room_id: placement.room.id,
    room_name: placement.room.name,
    day: placement.day,
    start: placement.start,
    end: placement.end,
  };
}

export function colorMap(placements) {
  const colors = new Map();
  let index = 0;
  for (const placement of placements) {
    if (!colors.has(placement.course_id)) {
      colors.set(placement.course_id, PALETTE[index % PALETTE.length]);
      index += 1;
    }
  }
  return colors;
}

function stat(value, label) {
  return `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

function pageHead(title, subtitle, actions = "") {
  return `<header class="page-head">
    <div><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p></div>
    <div class="actions">${actions}</div>
  </header>`;
}

function emptyState(title, text, href, label) {
  return `<div class="empty">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(text)}</p>
    ${href ? `<a class="btn btn-primary" href="${href}">${escapeHtml(label)}</a>` : ""}
  </div>`;
}

function messages(errors = [], warnings = []) {
  let html = "";
  if (errors.length > 0) {
    html += `<div class="banner banner-err"><strong>Could not save:</strong><ul>${errors
      .map((error) => `<li>${escapeHtml(error)}</li>`)
      .join("")}</ul></div>`;
  }
  if (warnings.length > 0) {
    html += `<div class="banner banner-warn"><strong>Heads up:</strong><ul>${warnings
      .map((warning) => `<li>${escapeHtml(warning)}</li>`)
      .join("")}</ul></div>`;
  }
  return html;
}

function textField(name, label, value, options = {}) {
  const { type = "text", hint, placeholder, readonly = false, required = false, min } = options;
  return `<div class="field">
    <label for="f-${name}">${escapeHtml(label)}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""}
      ${readonly ? "readonly" : ""}${required ? " required" : ""}
      ${min !== undefined ? `min="${min}"` : ""}${type === "number" ? ' step="1"' : ""}>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}
  </div>`;
}

function selectField(name, label, options, selected, hint) {
  return `<div class="field">
    <label for="f-${name}">${escapeHtml(label)}</label>
    <select id="f-${name}" name="${name}">
      ${options
        .map(([value, text]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`)
        .join("")}
    </select>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}
  </div>`;
}

function dayPicker(name, selected) {
  return `<div class="day-row">${DAYS.map((day) => `<label class="day-check">
      <input type="checkbox" name="${name}" value="${day}"${selected.includes(day) ? " checked" : ""}> ${day}
    </label>`).join("")}</div>`;
}

function formatWindow(start, end) {
  if (!start || !end) return "—";
  return `${formatHhmm(start)}–${formatHhmm(end)}`;
}

function dateLabel(date) {
  return date ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

// ---------------------------------------------------------------------------
// The app shell (sidebar + main area)
// ---------------------------------------------------------------------------

function navItem(href, label, key, active, chip) {
  return `<a class="nav-item${key === active ? " active" : ""}" href="${href}">
    <span>${escapeHtml(label)}</span>${chip ?? ""}
  </a>`;
}

function navChips(data) {
  const missingDuration = data.sections.filter(
    (section) => !section.duration_minutes && !(data.subjects.get(section.course_id)?.default_duration_minutes)
  ).length;
  const unknownInstructor = data.sections.filter(
    (section) => section.instructor && !data.professors.has(section.instructor)
  ).length;
  const problems = missingDuration + unknownInstructor;

  return {
    sections: problems > 0
      ? `<span class="chip chip-warn">${data.sections.length} · ${problems}!</span>`
      : `<span class="chip">${data.sections.length}</span>`,
    professors: `<span class="chip">${data.professorList.length}</span>`,
    subjects: `<span class="chip">${data.subjectList.length}</span>`,
    rooms: `<span class="chip">${data.rooms.length}</span>`,
    generate:
      data.sections.length > 0 && data.rooms.length > 0
        ? `<span class="chip chip-ok">ready</span>`
        : `<span class="chip chip-warn">needs data</span>`,
  };
}

function shell(ctx, body) {
  const { data, saved, draft, active, title, msg, err, preview, exportExists } = ctx;
  const chips = navChips(data);
  const timetableChip = draft
    ? `<span class="chip chip-warn">draft</span>`
    : saved
      ? `<span class="chip chip-ok">published</span>`
      : `<span class="chip">none</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Class Scheduler</title>
<link rel="stylesheet" href="/web/app.css">
<style>${TIMETABLE_CSS}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">CS</div>
      <div>
        <div class="brand-title">Class Scheduler</div>
        <div class="brand-sub">local timetable builder</div>
      </div>
    </div>

    <nav class="nav">
      <div class="nav-step"><span class="step-num">1</span>Data</div>
      ${navItem("/sections", "Sections", "sections", active, chips.sections)}
      ${navItem("/professors", "Professors", "professors", active, chips.professors)}
      ${navItem("/subjects", "Subjects", "subjects", active, chips.subjects)}
      ${navItem("/rooms", "Rooms & grid", "rooms", active, chips.rooms)}
      ${navItem("/import", "Import & backup", "import", active, "")}

      <div class="nav-step"><span class="step-num">2</span>Generate</div>
      ${navItem("/generate", "Generate", "generate", active, chips.generate)}

      <div class="nav-step"><span class="step-num">3</span>Review</div>
      ${navItem("/timetable", "Timetable", "timetable", active, timetableChip)}
      ${navItem("/versions", "Versions", "versions", active, `<span class="chip">${ctx.versions?.length ?? 0}</span>`)}
      ${navItem("/schedules", "Professor schedules", "schedules", active, "")}

      <div class="nav-step"><span class="step-num">4</span>Export</div>
      ${navItem("/export", "Export", "export", active, exportExists ? `<span class="chip chip-ok">ready</span>` : `<span class="chip">none</span>`)}

      <div class="nav-step"><span class="step-num">?</span>Help</div>
      ${navItem("/help", "How to use this", "help", active, "")}
    </nav>

    <div class="sidebar-foot">
      ${draft
        ? `Draft saved<br><strong>${escapeHtml(dateLabel(draft.savedAt))}</strong>${saved ? `<br><span class="muted">published ${escapeHtml(dateLabel(saved.savedAt))}</span>` : ""}`
        : saved
          ? `Published schedule<br><strong>${escapeHtml(dateLabel(saved.savedAt))}</strong>`
          : "No schedule yet"}
    </div>
  </aside>

  <main class="main">
    ${preview ? `<a class="banner banner-warn" href="/preview">You have an unsaved preview — review it →</a>` : ""}
    ${msg ? `<div class="banner banner-ok">${escapeHtml(msg)}</div>` : ""}
    ${err ? `<div class="banner banner-err">${escapeHtml(err)}</div>` : ""}
    ${body}
  </main>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Timetable rendering
// ---------------------------------------------------------------------------

export function timetableHtml(grid, placements, options = {}) {
  const days = grid.days;
  const slots = Math.max(1, Math.round((grid.end - grid.start) / grid.slot_minutes));
  const lineFor = (minutes) => 2 + Math.round((minutes - grid.start) / grid.slot_minutes);
  const colors = options.colors ?? colorMap(placements);
  const parts = [];

  parts.push(
    `<div class="timetable" style="grid-template-columns:68px repeat(${days.length}, minmax(0, 1fr)); grid-template-rows:44px repeat(${slots}, 44px);">`
  );
  parts.push(`<div class="cell corner"></div>`);
  days.forEach((day, index) => {
    parts.push(`<div class="cell day" style="grid-column:${index + 2}; grid-row:1;">${escapeHtml(day)}</div>`);
  });

  for (let slot = 0; slot < slots; slot += 1) {
    const row = slot + 2;
    parts.push(
      `<div class="cell time" style="grid-column:1; grid-row:${row};">${formatHhmm(grid.start + slot * grid.slot_minutes)}</div>`
    );
    for (let column = 0; column < days.length; column += 1) {
      parts.push(`<div class="cell" style="grid-column:${column + 2}; grid-row:${row};"></div>`);
    }
  }

  for (const band of options.bands ?? []) {
    const column = days.indexOf(band.day);
    if (column < 0) continue;
    const from = lineFor(band.start);
    const to = lineFor(band.end);
    if (to <= from) continue;
    parts.push(
      `<div class="band band-${band.kind}" style="grid-column:${column + 2}; grid-row:${from} / ${to};"></div>`
    );
  }

  for (const placement of placements) {
    const column = days.indexOf(placement.day);
    if (column < 0) continue;
    const from = lineFor(placement.start);
    const to = lineFor(placement.end);
    if (to <= from) continue;

    const short = placement.end - placement.start <= grid.slot_minutes;
    const lock = options.lockable?.(placement) ?? null;
    const classes = [
      "block",
      short ? "block-short" : "",
      options.warn?.(placement) ? "block-warn" : "",
      lock?.locked ? "block-locked" : "",
      lock ? "block-button" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const tip = [
      `${placement.section_id} · ${placement.course_name}`,
      placement.instructor || "No instructor",
      placement.room_name || placement.room_id,
      `${placement.day} ${formatHhmm(placement.start)}–${formatHhmm(placement.end)}`,
      lock ? (lock.locked ? "Locked — click to unlock" : "Click to lock this class") : "",
    ]
      .filter(Boolean)
      .join("\n");

    const content =
      `<span class="block-course">${escapeHtml(placement.course_id)}</span>` +
      (short
        ? ""
        : `<span class="block-meta">${formatHhmm(placement.start)}–${formatHhmm(placement.end)} · ${escapeHtml(placement.room_id)}</span>` +
          `<span class="block-meta">${escapeHtml(placement.instructor || "—")}</span>`);

    const background = colors.get(placement.course_id) ?? "#e4e4e7";

    const inner = lock
      ? `<form class="lock-form" method="post" action="/lock">
          <input type="hidden" name="section_id" value="${escapeHtml(placement.section_id)}">
          <input type="hidden" name="room_id" value="${escapeHtml(placement.room_id)}">
          <input type="hidden" name="day" value="${escapeHtml(placement.day)}">
          <input type="hidden" name="start" value="${placement.start}">
          <input type="hidden" name="next" value="${escapeHtml(lock.next)}">
          <button class="${classes}" style="background:${background};">${content}</button>
        </form>`
      : `<div class="${classes}" style="background:${background};">${content}</div>`;

    parts.push(
      `<div class="unit" style="grid-column:${column + 2}; grid-row:${from} / ${to};">` +
        inner +
        `<span class="tip">${escapeHtml(tip)}</span>` +
      `</div>`
    );
  }

  parts.push(`</div>`);
  return parts.join("");
}

function lockForm(row, options) {
  const locked = options.locks?.some((lock) => lock.section_id === row.section_id);
  const next = options.lockable(row).next;
  return `<form method="post" action="/lock">
    <input type="hidden" name="section_id" value="${escapeHtml(row.section_id)}">
    <input type="hidden" name="room_id" value="${escapeHtml(row.room_id)}">
    <input type="hidden" name="day" value="${escapeHtml(row.day)}">
    <input type="hidden" name="start" value="${row.start}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <button class="btn btn-sm${locked ? " btn-primary" : ""}">${locked ? "Unlock" : "Lock"}</button>
  </form>`;
}

export function scheduleTable(placements, options = {}) {
  const rows = placements.map(flat).sort(
    (a, b) =>
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
      a.start - b.start ||
      a.section_id.localeCompare(b.section_id)
  );
  if (rows.length === 0) return "";

  const showLock = Boolean(options.lockable);

  return `<table class="table">
    <thead><tr>
      <th>Section</th><th>Course</th><th>Instructor</th><th>Room</th><th>Day</th><th>Start</th><th>End</th>${showLock ? "<th></th>" : ""}
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.section_id)}</td>
            <td>${escapeHtml(row.course_name || row.course_id)}</td>
            <td>${escapeHtml(row.instructor || "—")}</td>
            <td>${escapeHtml(row.room_name || row.room_id)}</td>
            <td>${escapeHtml(row.day)}</td>
            <td>${formatHhmm(row.start)}</td>
            <td>${formatHhmm(row.end)}</td>
            ${showLock ? `<td class="row-actions">${lockForm(row, options)}</td>` : ""}
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function unplacedTable(unplaced) {
  if (unplaced.length === 0) return "";
  return `<table class="table">
    <thead><tr><th>Section</th><th>Course</th><th>Instructor</th><th>Minutes</th><th>Why it was left out</th></tr></thead>
    <tbody>
      ${unplaced
        .map(
          ({ section, reason }) => `<tr>
            <td>${escapeHtml(section.section_id)}</td>
            <td>${escapeHtml(section.course_name || section.course_id)}</td>
            <td>${escapeHtml(section.instructor || "—")}</td>
            <td>${escapeHtml(section.duration_minutes)}</td>
            <td>${escapeHtml(reason)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function timetablePage(ctx) {
  const { data, saved, draft, stale, draftStale, draftDiffers, locks, lockCheck } = ctx;
  const current = draft ?? saved;
  const isDraft = Boolean(draft);
  const placements = current ? current.placements.map(flat) : [];
  const lockedIds = new Set((locks ?? []).map((lock) => lock.section_id));

  const actions = [
    `<form method="post" action="/generate"><button class="btn btn-primary">Generate schedule</button></form>`,
    isDraft ? `<a class="btn" href="/publish">Publish draft</a>` : "",
    current ? `<a class="btn" href="/versions">Versions</a>` : "",
    saved ? `<form method="post" action="/export"><button class="btn">Export schedule.html</button></form>` : "",
  ]
    .filter(Boolean)
    .join("");

  let body = pageHead(
    isDraft ? "Draft timetable" : saved ? "Published timetable" : "Class timetable",
    isDraft
      ? "Your working copy. Click a class to lock it, then generate again around the locks."
      : saved
        ? "The published schedule, by day and time."
        : "Nothing has been published yet.",
    actions
  );

  if (!current) {
    body += emptyState(
      "No schedule yet",
      "Fill in rooms, professors, subjects and sections, then press Generate. The result becomes a draft you can review before publishing.",
      "/sections",
      "Start with sections"
    );
    return shell({ ...ctx, title: "Timetable", active: "timetable" }, body);
  }

  if (isDraft) {
    body += `<div class="banner banner-warn"><strong>Draft — not published.</strong> ${
      saved
        ? draftDiffers
          ? `The published timetable (${escapeHtml(dateLabel(saved.savedAt))}) is different. Publish when you are happy with this one.`
          : "It matches the published timetable."
        : "Nothing is published yet, so nobody else can see a timetable."
    }</div>`;
  }

  if (isDraft ? draftStale : stale) {
    body += `<div class="banner banner-warn">Your data changed after this schedule was saved. Generate again to refresh it.</div>`;
  }

  const unplaced = data.sections.filter(
    (section) => !placements.some((placement) => placement.section_id === section.section_id)
  );
  if (unplaced.length > 0) {
    body += `<div class="banner banner-warn">${unplaced.length} section(s) in your data are not in this ${
      isDraft ? "draft" : "published schedule"
    }. <a href="/generate">Generate</a> to try placing them.</div>`;
  }

  if (isDraft) {
    body +=
      locks.length > 0
        ? `<div class="banner banner-ok"><strong>${locks.length} class(es) locked.</strong> They stay in place when you generate again.
            <form method="post" action="/unlock-all" style="display:inline"><button class="btn btn-sm">Unlock all</button></form></div>`
        : `<div class="banner">No classes locked. Click any class below or on the grid to pin it before regenerating.</div>`;

    if (lockCheck?.dropped?.length > 0) {
      body += messages(
        [],
        lockCheck.dropped.map((lock) => `${lock.section_id}: lock ignored — ${lock.reason}.`)
      );
    }
  }

  const roomsUsed = new Set(placements.map((placement) => placement.room_id)).size;
  const teachers = new Set(placements.map((placement) => placement.instructor).filter(Boolean)).size;

  body += `<div class="stat-row">
    ${stat(placements.length, "sections placed")}
    ${stat(roomsUsed, "rooms used")}
    ${stat(teachers, "teachers")}
    ${stat(dateLabel(current.savedAt), isDraft ? "draft saved" : "published")}
  </div>`;

  const lockable = isDraft
    ? (placement) => ({ locked: lockedIds.has(placement.section_id), next: "/timetable" })
    : null;

  body += timetableHtml(data.grid, placements, lockable ? { lockable } : {});
  body += `<h2 class="section-title">All placed sections</h2>`;
  body += scheduleTable(placements, lockable ? { lockable, locks } : {});

  return shell({ ...ctx, title: "Timetable", active: "timetable" }, body);
}

export function generatePage(ctx) {
  const { data, budgetMs, locks, lockCheck } = ctx;
  const warnings = [];

  if (data.sections.length === 0) warnings.push("There are no sections yet.");
  if (data.rooms.length === 0) warnings.push("There are no rooms yet.");

  const missingDuration = data.sections.filter(
    (section) => !section.duration_minutes && !(data.subjects.get(section.course_id)?.default_duration_minutes)
  );
  if (missingDuration.length > 0) {
    warnings.push(`${missingDuration.length} section(s) have no duration and no subject default, so they cannot be placed.`);
  }

  const unknownInstructor = data.sections.filter(
    (section) => section.instructor && !data.professors.has(section.instructor)
  );
  if (unknownInstructor.length > 0) {
    warnings.push(`${unknownInstructor.length} section(s) name an instructor with no professor file — availability and preferences are skipped for them.`);
  }

  const noSubject = data.sections.filter(
    (section) => section.course_id && !data.subjects.has(section.course_id)
  );
  if (noSubject.length > 0) {
    warnings.push(`${noSubject.length} section(s) use a course with no subject file — no defaults are applied.`);
  }

  for (const lock of lockCheck?.dropped ?? []) {
    warnings.push(`Lock on ${lock.section_id} will be ignored — ${lock.reason}.`);
  }

  let body = pageHead(
    "Generate schedule",
    `The solver runs right here and stops after about ${Math.round((budgetMs ?? 5000) / 1000)} seconds.`,
    ""
  );
  body += `<div class="stat-row">
    ${stat(data.sections.length, "sections")}
    ${stat(data.rooms.length, "rooms")}
    ${stat(data.professorList.length, "professors")}
    ${stat((locks ?? []).length, "locked")}
  </div>`;
  body += messages([], warnings);
  body += `<div class="panel">
    <h2>What happens when you press generate</h2>
    <ol class="steps-list">
      <li>The solver tries many placements and keeps the best one.</li>
      <li>Classes you locked stay exactly where they are; everything else is rebuilt around them.</li>
      <li>You see a preview with any sections it could not place and the reason for each.</li>
      <li>Nothing is written to disk until you save the preview as a draft.</li>
    </ol>
    <form method="post" action="/generate"><button class="btn btn-primary btn-lg">Generate schedule</button></form>
  </div>`;

  if ((locks ?? []).length > 0) {
    body += `<div class="panel">
      <h2>Locked classes</h2>
      <table class="table">
        <thead><tr><th>Section</th><th>Room</th><th>Day</th><th>Start</th></tr></thead>
        <tbody>
          ${locks
            .map(
              (lock) => `<tr>
                <td>${escapeHtml(lock.section_id)}</td>
                <td>${escapeHtml(lock.room_id)}</td>
                <td>${escapeHtml(lock.day)}</td>
                <td>${lock.start >= 0 ? formatHhmm(lock.start) : "—"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  }

  return shell({ ...ctx, title: "Generate", active: "generate" }, body);
}

export function previewPage(ctx) {
  const { data, preview, draft } = ctx;
  const placements = preview.placements.map(flat);
  const roomsUsed = new Set(placements.map((placement) => placement.room_id)).size;
  const locked = preview.locks?.length ?? 0;

  const actions = `
    <form method="post" action="/save"><button class="btn btn-primary">Save as draft</button></form>
    <form method="post" action="/discard"><button class="btn btn-ghost">Discard</button></form>`;

  let body = pageHead(
    "Preview — not saved",
    `Generated at ${dateLabel(preview.createdAt)}. Nothing on disk has changed yet.`,
    actions
  );
  body += `<div class="stat-row">
    ${stat(placements.length, "placed")}
    ${stat(preview.unplaced.length, "unplaced")}
    ${stat(locked, "locked")}
    ${stat(roomsUsed, "rooms used")}
  </div>`;
  body += `<div class="banner banner-warn">This preview lives in the server's memory. Save it as the draft to review and publish, or discard it to keep the current draft.</div>`;

  if (draft) {
    body += `<div class="banner banner-warn">Saving replaces the current draft (${escapeHtml(dateLabel(draft.savedAt))}). <a href="/versions">Save a version first</a> if you want a checkpoint.</div>`;
  }

  if (preview.droppedLocks?.length > 0) {
    body += messages(
      [],
      preview.droppedLocks.map((lock) => `Lock on ${lock.section_id} was ignored — ${lock.reason}.`)
    );
  }

  body += timetableHtml(data.grid, placements);

  body += `<h2 class="section-title">Not placed${preview.unplaced.length ? ` (${preview.unplaced.length})` : ""}</h2>`;
  body += preview.unplaced.length > 0
    ? unplacedTable(preview.unplaced)
    : `<div class="banner banner-ok">Every section was placed.</div>`;

  body += `<h2 class="section-title">All placed sections</h2>`;
  body += scheduleTable(placements);

  return shell({ ...ctx, title: "Preview", active: "generate" }, body);
}

export function exportPage(ctx) {
  const { saved, draft, draftDiffers, exportExists } = ctx;
  const actions = saved
    ? `<form method="post" action="/export"><button class="btn btn-primary">Write schedule.html</button></form>`
    : "";

  let body = pageHead(
    "Export",
    "A single self-contained HTML file you can double-click or share.",
    actions
  );

  body += `<div class="panel">
    <h2>What gets written</h2>
    <p><code>schedule.html</code> in the project folder. It has the styles inline, so it works without the server — double-click it, email it, or publish it with GitHub Pages.</p>
    <p class="muted">It is generated from the <strong>published</strong> schedule (<code>schedule.csv</code>), not from a draft or an unsaved preview.</p>
  </div>`;

  if (draft && draftDiffers) {
    body += `<div class="banner banner-warn">You have a draft that is not published yet. <a href="/publish">Publish it</a> before exporting to include those changes.</div>`;
  }

  if (!saved) {
    body += emptyState(
      "No published schedule to export",
      "Generate a schedule, save it as a draft, then publish it first.",
      "/generate",
      "Go to Generate"
    );
  } else {
    body += `<div class="stat-row">
      ${stat(saved.placements.length, "sections")}
      ${stat(dateLabel(saved.savedAt), "published")}
    </div>`;
    body += `<div class="banner ${exportExists ? "banner-ok" : "banner-warn"}">
      ${exportExists ? "schedule.html exists. Writing again replaces it." : "schedule.html has not been written yet."}
    </div>`;
  }

  return shell({ ...ctx, title: "Export", active: "export" }, body);
}

// --- versions --------------------------------------------------------------

export function versionsPage(ctx) {
  const { data, draft, saved, versions } = ctx;
  const source = draft ?? saved;
  const sourceLabel = draft ? "draft" : "published schedule";

  let body = pageHead(
    "Versions",
    "Named snapshots of the timetable. Restore one into the draft to keep working from it.",
    `<a class="btn" href="/timetable">Back to timetable</a>`
  );

  body += `<div class="panel">
    <h2>Save the current ${escapeHtml(sourceLabel)} as a version</h2>
    ${
      source
        ? `<form method="post" action="/versions" class="inline-form">
            <input type="text" name="name" placeholder="e.g. Before the room closure" aria-label="Version name">
            <button class="btn btn-primary">Save version</button>
          </form>
          <p class="muted">Leave the name blank to use the term and the current date.</p>`
        : `<p class="muted">Generate a schedule first.</p>`
    }
  </div>`;

  if (versions.length === 0) {
    body += emptyState(
      "No versions yet",
      "Publishing creates one automatically. You can also save a version whenever you want a checkpoint.",
      source ? "/timetable" : "/generate",
      source ? "Back to timetable" : "Go to Generate"
    );
    return shell({ ...ctx, title: "Versions", active: "versions" }, body);
  }

  body += `<table class="table">
    <thead><tr><th>Name</th><th>Created</th><th>Placed</th><th>Unplaced</th><th></th></tr></thead>
    <tbody>
      ${[...versions]
        .reverse()
        .map(
          (version) => `<tr>
            <td>${escapeHtml(version.name)}${version.current ? ` <span class="chip chip-ok">published</span>` : ""}</td>
            <td>${escapeHtml(formatWhen(version.created_at))}</td>
            <td>${version.placed}</td>
            <td>${version.unplaced}</td>
            <td class="row-actions">
              <a class="btn btn-sm" href="/versions/restore/${encodeURIComponent(version.file)}">Restore</a>
              <a class="btn btn-sm btn-danger" href="/versions/delete/${encodeURIComponent(version.file)}">Delete</a>
            </td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Versions", active: "versions" }, body);
}

export function versionRestorePage(ctx) {
  const { version, versionPlacements } = ctx;
  const detail = `<p><strong>${escapeHtml(version.name)}</strong> — ${versionPlacements.length} placed section(s), saved ${escapeHtml(formatWhen(version.created_at))}.</p>
    <p>Restoring replaces the current draft with this snapshot and clears all locks. The published timetable is not touched.</p>`;
  return confirmPage(ctx, {
    title: "Restore version",
    subtitle: "This becomes your working draft.",
    detail,
    action: "/versions/restore",
    cancelHref: "/versions",
    file: version.file,
    label: "Restore",
    buttonClass: "btn-primary",
  });
}

export function versionDeletePage(ctx) {
  const { version } = ctx;
  const detail = `<p>Delete <strong>${escapeHtml(version.name)}</strong>, saved ${escapeHtml(formatWhen(version.created_at))}?</p>
    <p>The snapshot file is removed. The draft and the published timetable are not touched.</p>`;
  return confirmPage(ctx, {
    title: "Delete version",
    subtitle: "This cannot be undone.",
    detail,
    action: "/versions/delete",
    cancelHref: "/versions",
    file: version.file,
  });
}

export function publishPage(ctx) {
  const { data, draft, saved, draftDiffers } = ctx;
  const placedIds = new Set(draft.placements.map((placement) => placement.section_id));
  const unplaced = data.sections.filter((section) => !placedIds.has(section.section_id));

  const detail = `<p>Publish <strong>${draft.placements.length}</strong> section(s) from the draft${
    data.settings.term_label ? ` for <strong>${escapeHtml(data.settings.term_label)}</strong>` : ""
  }.</p>
  <p>This replaces <code>schedule.csv</code> and saves a named snapshot you can restore later.${
    unplaced.length > 0
      ? ` <strong>${unplaced.length} section(s) are not in the draft</strong> and will not appear in the published timetable.`
      : ""
  }</p>
  ${
    saved
      ? `<p class="muted">The current published timetable is from ${escapeHtml(dateLabel(saved.savedAt))}${
          draftDiffers ? " and is different from this draft." : " and already matches this draft."
        }</p>`
      : `<p class="muted">Nothing is published yet.</p>`
  }
  <p class="muted">After publishing, use Export to write <code>schedule.html</code>.</p>`;

  return confirmPage(ctx, {
    title: "Publish draft",
    subtitle: "Make this timetable the published one.",
    detail,
    action: "/publish",
    cancelHref: "/timetable",
    label: "Publish",
    buttonClass: "btn-primary",
  });
}

// --- sections --------------------------------------------------------------

export function sectionsPage(ctx) {
  const { data } = ctx;
  const actions = `<a class="btn btn-primary" href="/sections/new">Add section</a>`;

  let body = pageHead("Sections", "One row per class meeting. Durations and capacities can come from the subject file.", actions);

  if (data.sections.length === 0) {
    body += emptyState("No sections yet", "Add a section to start building the timetable.", "/sections/new", "Add section");
    return shell({ ...ctx, title: "Sections", active: "sections" }, body);
  }

  body += `<table class="table">
    <thead><tr>
      <th>Section</th><th>Course</th><th>Instructor</th><th>Students</th><th>Minutes</th><th>Allowed days</th><th></th>
    </tr></thead>
    <tbody>
      ${data.sections
        .map((section) => {
          const subject = data.subjects.get(section.course_id);
          const duration = section.duration_minutes || subject?.default_duration_minutes || 0;
          const durationLabel = section.duration_minutes
            ? String(section.duration_minutes)
            : duration
              ? `${duration} (default)`
              : "—";
          const capacity = section.capacity_needed || subject?.default_capacity || 0;
          const capacityLabel = section.capacity_needed
            ? String(section.capacity_needed)
            : capacity
              ? `${capacity} (default)`
              : "—";
          const id = encodeURIComponent(section.section_id);
          return `<tr>
            <td><strong>${escapeHtml(section.section_id)}</strong></td>
            <td>${escapeHtml(section.course_name || section.course_id)}</td>
            <td>${escapeHtml(section.instructor || "—")}</td>
            <td>${escapeHtml(capacityLabel)}</td>
            <td>${escapeHtml(durationLabel)}</td>
            <td>${section.allowed_days.length ? escapeHtml(section.allowed_days.join(", ")) : "Any"}</td>
            <td class="row-actions">
              <a class="btn btn-sm" href="/sections/${id}/edit">Edit</a>
              <a class="btn btn-sm btn-danger" href="/sections/${id}/delete">Delete</a>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Sections", active: "sections" }, body);
}

export function sectionFormPage(ctx) {
  const { data, values, isNew, errors = [], warnings = [] } = ctx;
  const title = isNew ? "Add section" : `Edit ${values.section_id}`;

  const body =
    pageHead(title, "A section is one class meeting: a course, a group of students, a teacher and a length.", "") +
    messages(errors, warnings) +
    `<form class="form" method="post" action="/sections/save">
      <input type="hidden" name="original_id" value="${escapeHtml(isNew ? "" : values.section_id)}">
      <div class="grid2">
        ${textField("section_id", "Section id", values.section_id, { hint: "Unique, for example S101-L1.", required: true })}
        ${textField("course_id", "Course id", values.course_id, { hint: "Matches a subject file, for example CS101.", required: true })}
        ${textField("course_name", "Course name", values.course_name, { hint: "Shown on the timetable." })}
        ${textField("instructor", "Instructor", values.instructor, { hint: "Must match a professor's name exactly." })}
        ${textField("capacity_needed", "Students", values.capacity_needed, { type: "number", min: 0, hint: "Blank = any room." })}
        ${textField("duration_minutes", "Duration (minutes)", values.duration_minutes, { type: "number", min: 0, hint: "Blank = the subject's default." })}
      </div>
      <div class="field">
        <label>Allowed days</label>
        ${dayPicker("days", values.allowed_days)}
        <div class="hint">Leave all unchecked to allow any day in the grid.</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary">${isNew ? "Add section" : "Save section"}</button>
        <a class="btn btn-ghost" href="/sections">Cancel</a>
      </div>
    </form>
    <div class="panel muted-panel">
      Subjects available: ${data.subjectList.length
        ? data.subjectList.map((subject) => `<code>${escapeHtml(subject.id)}</code>`).join(" ")
        : "none yet"}
    </div>`;

  return shell({ ...ctx, title, active: "sections" }, body);
}

// --- professors ------------------------------------------------------------

export function professorsPage(ctx) {
  const { data } = ctx;
  const actions = `<a class="btn btn-primary" href="/professors/new">Add professor</a>`;

  let body = pageHead("Professors", "Availability is a hard limit; preferred hours are a soft preference.", actions);

  if (data.professorList.length === 0) {
    body += emptyState("No professors yet", "Add the people who teach your sections.", "/professors/new", "Add professor");
    return shell({ ...ctx, title: "Professors", active: "professors" }, body);
  }

  body += `<table class="table">
    <thead><tr>
      <th>Id</th><th>Name</th><th>Preferred days</th><th>Preferred hours</th><th>Available</th><th>Max</th><th></th>
    </tr></thead>
    <tbody>
      ${data.professorList
        .map((professor) => {
          const id = encodeURIComponent(professor.id);
          return `<tr>
            <td>${escapeHtml(professor.id)}</td>
            <td><strong>${escapeHtml(professor.name)}</strong></td>
            <td>${professor.preferred_days.length ? escapeHtml(professor.preferred_days.join(", ")) : "Any"}</td>
            <td>${escapeHtml(formatWindow(professor.preferred_start, professor.preferred_end))}</td>
            <td>${escapeHtml(formatWindow(professor.availability_start, professor.availability_end))}</td>
            <td>${professor.max_sections || "—"}</td>
            <td class="row-actions">
              <a class="btn btn-sm" href="/professors/${id}">Schedule</a>
              <a class="btn btn-sm" href="/professors/${id}/edit">Edit</a>
              <a class="btn btn-sm btn-danger" href="/professors/${id}/delete">Delete</a>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Professors", active: "professors" }, body);
}

export function professorFormPage(ctx) {
  const { values, isNew, errors = [], warnings = [] } = ctx;
  const title = isNew ? "Add professor" : `Edit ${values.name}`;

  const body =
    pageHead(title, "Times are optional. Leave them blank to mean “no limit”.", "") +
    messages(errors, warnings) +
    `<form class="form" method="post" action="/professors/save">
      <input type="hidden" name="original_id" value="${escapeHtml(isNew ? "" : values.professor_id)}">
      <div class="grid2">
        ${textField("professor_id", "Professor id", values.professor_id, { readonly: !isNew, hint: "Also the file name, for example P101." })}
        ${textField("name", "Name", values.name, { required: true, hint: "Sections match on this exact name." })}
      </div>
      <div class="field">
        <label>Preferred days</label>
        ${dayPicker("days", values.preferred_days)}
        <div class="hint">Days they would rather teach. Leave all unchecked for no preference.</div>
      </div>
      <div class="grid2">
        ${textField("preferred_start", "Preferred from", values.preferred_start, { type: "time" })}
        ${textField("preferred_end", "Preferred until", values.preferred_end, { type: "time" })}
        ${textField("availability_start", "Available from", values.availability_start, { type: "time", hint: "Hard limit." })}
        ${textField("availability_end", "Available until", values.availability_end, { type: "time", hint: "Hard limit." })}
      </div>
      ${textField("max_sections", "Max sections", values.max_sections, { type: "number", min: 0, hint: "Blank = no limit." })}
      <div class="form-actions">
        <button class="btn btn-primary">${isNew ? "Add professor" : "Save professor"}</button>
        <a class="btn btn-ghost" href="/professors">Cancel</a>
      </div>
    </form>`;

  return shell({ ...ctx, title, active: "professors" }, body);
}

export function schedulesPage(ctx, rows) {
  let body = pageHead(
    "Professor schedules",
    "Pick a professor to see their classes, their windows, and anything that did not fit.",
    ""
  );

  if (rows.length === 0) {
    body += emptyState("No professors yet", "Add professors before reviewing their schedules.", "/professors/new", "Add professor");
    return shell({ ...ctx, title: "Professor schedules", active: "schedules" }, body);
  }

  body += `<table class="table">
    <thead><tr><th>Professor</th><th>Sections placed</th><th>Hours / week</th><th>Inside preferred hours</th><th></th></tr></thead>
    <tbody>
      ${rows
        .map(({ professor, count, hours, inside, outside }) => `<tr>
          <td><strong>${escapeHtml(professor.name)}</strong><div class="hint">${escapeHtml(professor.id)}</div></td>
          <td>${count}</td>
          <td>${hours.toFixed(1)}</td>
          <td>${inside} / ${count}${outside > 0 ? ` <span class="chip chip-warn">${outside} outside</span>` : ""}</td>
          <td class="row-actions"><a class="btn btn-sm" href="/professors/${encodeURIComponent(professor.id)}">View schedule</a></td>
        </tr>`)
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Professor schedules", active: "schedules" }, body);
}

export function professorDetailPage(ctx) {
  const { data, professor, placements, unplaced, sourceLabel } = ctx;
  const all = placements.map(flat);
  const own = all.filter((placement) => placement.instructor === professor.name);
  const colors = colorMap(all);
  const hours = own.reduce((total, placement) => total + (placement.end - placement.start), 0) / 60;

  const isOutside = (placement) =>
    placementPenalty(
      { section: { instructor: placement.instructor }, day: placement.day, start: placement.start, end: placement.end },
      data.professors
    ) > 0;
  const outside = own.filter(isOutside);

  const bands = [];
  if (professor.availability_start && professor.availability_end) {
    for (const day of data.grid.days) {
      bands.push({ day, start: professor.availability_start, end: professor.availability_end, kind: "availability" });
    }
  }
  if (professor.preferred_start && professor.preferred_end) {
    const days = professor.preferred_days.length
      ? professor.preferred_days.filter((day) => data.grid.days.includes(day))
      : data.grid.days;
    for (const day of days) {
      bands.push({ day, start: professor.preferred_start, end: professor.preferred_end, kind: "preferred" });
    }
  }

  const actions = `<a class="btn" href="/professors/${encodeURIComponent(professor.id)}/edit">Edit professor</a>`;
  let body = pageHead(professor.name, `${professor.id} · showing the ${sourceLabel} schedule`, actions);

  body += `<div class="stat-row">
    ${stat(own.length, "sections")}
    ${stat(hours.toFixed(1), "hours / week")}
    ${stat(professor.max_sections || "∞", "max sections")}
    ${stat(`${own.length - outside.length} / ${own.length}`, "inside preferred hours")}
  </div>`;

  body += `<div class="legend">
    <span class="legend-item"><span class="swatch swatch-availability"></span> available ${formatWindow(professor.availability_start, professor.availability_end)}</span>
    <span class="legend-item"><span class="swatch swatch-preferred"></span> preferred ${formatWindow(professor.preferred_start, professor.preferred_end)}</span>
    <span class="legend-item"><span class="swatch swatch-warn"></span> outside preferred hours</span>
  </div>`;

  body += own.length > 0
    ? timetableHtml(data.grid, own, { colors, bands, warn: isOutside })
    : emptyState("No classes placed", `Nothing in the ${sourceLabel} schedule belongs to ${professor.name}.`, "/generate", "Generate schedule");

  if (outside.length > 0) {
    body += `<div class="banner banner-warn">
      <strong>${outside.length} class(es) fall outside the preferred hours:</strong>
      ${outside.map((placement) => `${escapeHtml(placement.section_id)} (${escapeHtml(placement.day)} ${formatHhmm(placement.start)}–${formatHhmm(placement.end)})`).join(", ")}
    </div>`;
  }

  if (unplaced.length > 0) {
    body += `<h2 class="section-title">Not placed (${unplaced.length})</h2>`;
    body += unplacedTable(unplaced);
  }

  return shell({ ...ctx, title: `${professor.name} schedule`, active: "schedules" }, body);
}

// --- subjects --------------------------------------------------------------

export function subjectsPage(ctx) {
  const { data } = ctx;
  const actions = `<a class="btn btn-primary" href="/subjects/new">Add subject</a>`;

  let body = pageHead("Subjects", "Default length and class size, used when a section leaves those blank.", actions);

  if (data.subjectList.length === 0) {
    body += emptyState("No subjects yet", "Add a subject so sections can inherit a default duration and capacity.", "/subjects/new", "Add subject");
    return shell({ ...ctx, title: "Subjects", active: "subjects" }, body);
  }

  body += `<table class="table">
    <thead><tr><th>Id</th><th>Name</th><th>Default minutes</th><th>Default capacity</th><th>Sections</th><th></th></tr></thead>
    <tbody>
      ${data.subjectList
        .map((subject) => {
          const id = encodeURIComponent(subject.id);
          const used = data.sections.filter((section) => section.course_id === subject.id).length;
          return `<tr>
            <td><strong>${escapeHtml(subject.id)}</strong></td>
            <td>${escapeHtml(subject.course_name || "—")}</td>
            <td>${subject.default_duration_minutes || "—"}</td>
            <td>${subject.default_capacity || "—"}</td>
            <td>${used}</td>
            <td class="row-actions">
              <a class="btn btn-sm" href="/subjects/${id}/edit">Edit</a>
              <a class="btn btn-sm btn-danger" href="/subjects/${id}/delete">Delete</a>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Subjects", active: "subjects" }, body);
}

export function subjectFormPage(ctx) {
  const { values, isNew, errors = [], warnings = [] } = ctx;
  const title = isNew ? "Add subject" : `Edit ${values.subject_id}`;

  const body =
    pageHead(title, "These defaults are applied when a section leaves duration or capacity blank.", "") +
    messages(errors, warnings) +
    `<form class="form" method="post" action="/subjects/save">
      <input type="hidden" name="original_id" value="${escapeHtml(isNew ? "" : values.subject_id)}">
      <div class="grid2">
        ${textField("subject_id", "Subject id", values.subject_id, { readonly: !isNew, hint: "Matches a section's course id, for example CS101." })}
        ${textField("course_name", "Subject name", values.course_name, { hint: "Shown on the timetable." })}
        ${textField("default_duration_minutes", "Default duration (minutes)", values.default_duration_minutes, { type: "number", min: 0 })}
        ${textField("default_capacity", "Default capacity", values.default_capacity, { type: "number", min: 0 })}
      </div>
      <div class="form-actions">
        <button class="btn btn-primary">${isNew ? "Add subject" : "Save subject"}</button>
        <a class="btn btn-ghost" href="/subjects">Cancel</a>
      </div>
    </form>`;

  return shell({ ...ctx, title, active: "subjects" }, body);
}

// --- rooms and grid --------------------------------------------------------

export function roomsPage(ctx) {
  const { data } = ctx;
  const actions = `<a class="btn btn-primary" href="/rooms/new">Add room</a>`;
  const { grid } = data;

  let body = pageHead("Rooms & grid", "Rooms only differ by capacity; the grid sets the days and hours available.", actions);
  body += `<div class="panel">
    <strong>Teaching grid:</strong>
    ${escapeHtml(DAYS[grid.first])}–${escapeHtml(DAYS[grid.last])},
    ${formatHhmm(grid.start)}–${formatHhmm(grid.end)},
    ${grid.slot_minutes}-minute slots
    · <a href="/grid">Change grid</a>
  </div>`;

  if (data.rooms.length === 0) {
    body += emptyState("No rooms yet", "Add at least one room before generating.", "/rooms/new", "Add room");
    return shell({ ...ctx, title: "Rooms & grid", active: "rooms" }, body);
  }

  body += `<table class="table">
    <thead><tr><th>Id</th><th>Name</th><th>Building</th><th>Capacity</th><th></th></tr></thead>
    <tbody>
      ${data.rooms
        .map((room) => {
          const id = encodeURIComponent(room.id);
          return `<tr>
            <td><strong>${escapeHtml(room.id)}</strong></td>
            <td>${escapeHtml(room.name || "—")}</td>
            <td>${escapeHtml(room.building || "—")}</td>
            <td>${room.capacity}</td>
            <td class="row-actions">
              <a class="btn btn-sm" href="/rooms/${id}/edit">Edit</a>
              <a class="btn btn-sm btn-danger" href="/rooms/${id}/delete">Delete</a>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;

  return shell({ ...ctx, title: "Rooms & grid", active: "rooms" }, body);
}

export function roomFormPage(ctx) {
  const { values, isNew, errors = [], warnings = [] } = ctx;
  const title = isNew ? "Add room" : `Edit ${values.room_id}`;

  const body =
    pageHead(title, "Capacity is a hard constraint: a section only fits in a room with at least as many seats.", "") +
    messages(errors, warnings) +
    `<form class="form" method="post" action="/rooms/save">
      <input type="hidden" name="original_id" value="${escapeHtml(isNew ? "" : values.room_id)}">
      <div class="grid2">
        ${textField("room_id", "Room id", values.room_id, { required: true, hint: "For example R101." })}
        ${textField("room_name", "Room name", values.room_name, { hint: "Shown on the timetable." })}
        ${textField("building", "Building", values.building, {})}
        ${textField("capacity", "Capacity", values.capacity, { type: "number", min: 1, required: true })}
      </div>
      <div class="form-actions">
        <button class="btn btn-primary">${isNew ? "Add room" : "Save room"}</button>
        <a class="btn btn-ghost" href="/rooms">Cancel</a>
      </div>
    </form>`;

  return shell({ ...ctx, title, active: "rooms" }, body);
}

export function gridPage(ctx) {
  const { values, errors = [], warnings = [] } = ctx;
  const dayOptions = DAYS.map((day) => [day, day]);

  const body =
    pageHead("Teaching grid", "The days and hours the solver may use. Slots control how finely classes can start.", "") +
    messages(errors, warnings) +
    `<form class="form" method="post" action="/grid">
      <div class="grid2">
        ${selectField("first_day", "First day", dayOptions, values.first_day)}
        ${selectField("last_day", "Last day", dayOptions, values.last_day)}
        ${textField("start", "Teaching day starts", values.start, { type: "time" })}
        ${textField("end", "Teaching day ends", values.end, { type: "time" })}
      </div>
      ${textField("slot_minutes", "Slot length (minutes)", values.slot_minutes, { type: "number", min: 1, hint: "30 is typical. Must divide the teaching day exactly." })}
      <div class="form-actions">
        <button class="btn btn-primary">Save grid</button>
        <a class="btn btn-ghost" href="/rooms">Cancel</a>
      </div>
    </form>`;

  return shell({ ...ctx, title: "Teaching grid", active: "rooms" }, body);
}

// --- import and backup -----------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function importPage(ctx) {
  const { kinds = [], kind, err, msg } = ctx;
  const chosen = kinds.find((entry) => entry.value === kind) ?? kinds[0];
  if (!chosen) return emptyState("Nothing to import", "This build has no import types.", "/timetable", "Back");

  const body =
    pageHead(
      "Import & backup",
      "Paste or upload a CSV. You will see exactly what changes before anything is saved.",
      ""
    ) +
    (err ? `<div class="banner banner-err">${escapeHtml(err)}</div>` : "") +
    (msg ? `<div class="banner banner-ok">${escapeHtml(msg)}</div>` : "") +
    `<form class="form" method="post" action="/import/preview" enctype="multipart/form-data">
      <div class="grid2">
        ${selectField("kind", "What are you importing?", kinds.map((entry) => [entry.value, entry.label]), chosen.value)}
        <div class="field">
          <label for="f-file">CSV file</label>
          <input id="f-file" type="file" name="file" accept=".csv,text/csv,text/plain">
          <div class="hint">In Excel: File → Save as → CSV.</div>
        </div>
      </div>
      <div class="field">
        <label for="f-text">…or paste it</label>
        <textarea id="f-text" name="text" rows="8" spellcheck="false" placeholder="${escapeHtml(
          "section_id,course_id,course_name,instructor,capacity_needed,duration_minutes,allowed_days"
        )}"></textarea>
        <div class="hint">If you do both, the uploaded file wins.</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary">Preview import</button>
        <a class="btn btn-ghost" href="/sections">Cancel</a>
      </div>
    </form>
    <div class="panel">
      <h2>What <strong>${escapeHtml(chosen.label.toLowerCase())}</strong> need</h2>
      ${kinds
        .map(
          (entry) => `<p><strong>${escapeHtml(entry.label)}</strong><br><code>${escapeHtml(entry.columns.join(","))}</code></p>`
        )
        .join("")}
      <p class="muted">Only <code>${escapeHtml(chosen.columns[0])}</code> is required. Columns you leave out keep their current values when merging, so a file with just ids and teachers works.</p>
    </div>
    <div class="panel">
      <h2>Backups</h2>
      <p>Every data file in one download, and the way back.</p>
      <a class="btn" href="/backup">Open backups →</a>
    </div>`;

  return shell({ ...ctx, title: "Import & backup", active: "import" }, body);
}

function addedTable(columns, rows) {
  return `<div class="scroll-x"><table class="table">
    <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows
        .map(
          ({ row }) =>
            `<tr>${columns
              .map((column) => `<td>${row[column] === "" || row[column] === undefined ? '<span class="muted">—</span>' : escapeHtml(row[column])}</td>`)
              .join("")}</tr>`
        )
        .join("")}
    </tbody>
  </table></div>`;
}

function changedTable(changed) {
  return `<table class="table">
    <thead><tr><th>Id</th><th>What changes</th></tr></thead>
    <tbody>
      ${changed
        .map(
          ({ id, changes }) => `<tr>
            <td><strong>${escapeHtml(id)}</strong></td>
            <td>${changes
              .map(
                (change) =>
                  `<div class="change"><code>${escapeHtml(change.column)}</code> ${
                    change.from === "" ? "<em>(blank)</em>" : escapeHtml(change.from)
                  } <span class="arrow">→</span> ${
                    change.to === "" ? "<em>(blank)</em>" : escapeHtml(change.to)
                  }</div>`
              )
              .join("")}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

export function importPreviewPage(ctx) {
  const { prepared } = ctx;
  const { label, errors, warnings, diff, presentColumns, missingColumns } = prepared;
  const blocked = errors.length > 0;

  const actions = blocked
    ? `<form method="post" action="/import/cancel"><button class="btn btn-ghost">Cancel</button></form>`
    : `<form method="post" action="/import/apply"><input type="hidden" name="mode" value="merge"><button class="btn btn-primary">Merge into existing</button></form>
       <form method="post" action="/import/apply"><input type="hidden" name="mode" value="replace"><button class="btn btn-danger">Replace everything</button></form>
       <form method="post" action="/import/cancel"><button class="btn btn-ghost">Cancel</button></form>`;

  let body = pageHead(
    blocked ? `Import blocked — ${label.toLowerCase()}` : `Import preview — ${label.toLowerCase()}`,
    blocked
      ? "Nothing has been written. Fix the problems below and preview again."
      : "Nothing has been written yet. Choose merge or replace to apply it.",
    actions
  );

  body += messages(errors, warnings);

  if (missingColumns.length > 0) {
    body += `<div class="banner banner-warn">Your file does not include <code>${missingColumns
      .map(escapeHtml)
      .join("</code>, <code>")}</code>. <strong>Merge</strong> keeps the current values; <strong>Replace</strong> clears them.</div>`;
  }

  body += `<div class="stat-row">
    ${stat(diff.added.length, "new")}
    ${stat(diff.changed.length, "changed")}
    ${stat(diff.unchanged.length, "unchanged")}
    ${stat(diff.missing.length, "kept")}
  </div>`;

  if (blocked) {
    body += `<div class="panel"><h2>Why it stopped</h2><p class="muted">An import that would break a file is refused as a whole — no partial writes.</p></div>`;
    return shell({ ...ctx, title: "Import preview", active: "import" }, body);
  }

  if (diff.added.length > 0) {
    body += `<h2 class="section-title">New (${diff.added.length})</h2>`;
    body += addedTable(presentColumns, diff.added);
  }

  if (diff.changed.length > 0) {
    body += `<h2 class="section-title">Changed (${diff.changed.length})</h2>`;
    body += changedTable(diff.changed);
  }

  if (diff.missing.length > 0) {
    body += `<h2 class="section-title">Not in your file (${diff.missing.length})</h2>`;
    body += `<div class="banner banner-warn">These exist on disk. <strong>Merge</strong> keeps them; <strong>Replace</strong> deletes them.</div>`;
    body += `<p>${diff.missing
      .map(({ id }) => `<code>${escapeHtml(id)}</code>`)
      .join(" ")}</p>`;
  }

  return shell({ ...ctx, title: "Import preview", active: "import" }, body);
}

export function backupPage(ctx) {
  const { bundle, err, msg } = ctx;

  const body =
    pageHead("Backups", "Every data file in one download, and the way back.", "") +
    (err ? `<div class="banner banner-err">${escapeHtml(err)}</div>` : "") +
    (msg ? `<div class="banner banner-ok">${escapeHtml(msg)}</div>` : "") +
    `<div class="panel">
      <h2>Download</h2>
      <p>One JSON file holding every CSV in the data folder — sections, rooms, the grid, professors and subjects.</p>
      <p class="muted">${bundle.fileCount} files · ${formatBytes(bundle.bytes)}</p>
      <a class="btn btn-primary" href="/backup/download">Download backup</a>
    </div>
    <div class="panel">
      <h2>Restore</h2>
      <p>Choose a backup file. You will see what changes before anything is written, and each file keeps one <code>.bak</code> copy of its previous version.</p>
      <form class="form" method="post" action="/backup/restore/preview" enctype="multipart/form-data">
        <div class="field">
          <label for="f-bundle">Backup file</label>
          <input id="f-bundle" type="file" name="file" accept=".json,application/json">
        </div>
        <div class="form-actions">
          <button class="btn">Preview restore</button>
        </div>
      </form>
    </div>
    <div class="panel muted-panel">
      A restore deletes data files that are not in the backup, because restoring means “make it look like that backup”. The deleted files are listed before you confirm.
    </div>`;

  return shell({ ...ctx, title: "Backups", active: "import" }, body);
}

export function restorePreviewPage(ctx) {
  const { summary, createdAt } = ctx;
  const { added, changed, removed, same } = summary;
  const nothingToDo = added.length === 0 && changed.length === 0 && removed.length === 0;

  const actions = nothingToDo
    ? `<form method="post" action="/backup/restore/cancel"><button class="btn btn-ghost">Back</button></form>`
    : `<form method="post" action="/backup/restore/apply"><button class="btn btn-primary">Restore this backup</button></form>
       <form method="post" action="/backup/restore/cancel"><button class="btn btn-ghost">Cancel</button></form>`;

  let body = pageHead(
    "Restore preview",
    nothingToDo ? "This backup matches what is already on disk." : "Nothing has been written yet.",
    actions
  );

  body += `<div class="stat-row">
    ${stat(changed.length, "files changed")}
    ${stat(added.length, "files added")}
    ${stat(removed.length, "files removed")}
    ${stat(same.length, "unchanged")}
  </div>`;

  const list = (items) => items.map((file) => `<code>${escapeHtml(file)}</code>`).join(" ");

  if (changed.length > 0) body += `<h2 class="section-title">Changed</h2><p>${list(changed)}</p>`;
  if (added.length > 0) body += `<h2 class="section-title">Added</h2><p>${list(added)}</p>`;
  if (removed.length > 0) {
    body += `<h2 class="section-title">Removed</h2>`;
    body += `<div class="banner banner-warn">These files are not in the backup and will be deleted.</div>`;
    body += `<p>${list(removed)}</p>`;
  }

  if (createdAt) {
    body += `<p class="muted">Backup taken ${escapeHtml(formatWhen(createdAt))}.</p>`;
  }

  return shell({ ...ctx, title: "Restore preview", active: "import" }, body);
}

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

// --- misc ------------------------------------------------------------------

export function helpPage(ctx) {
  const body = pageHead("How to use this", "Four steps, in order. Everything is saved as CSV files in the data folder.", "") +
    `<div class="panel">
      <h2>1 · Data</h2>
      <p>Add <strong>rooms</strong>, <strong>professors</strong>, <strong>subjects</strong> and <strong>sections</strong>. A section's instructor must match a professor's name; its course id must match a subject id.</p>
      <p>Already have a spreadsheet? Use <a href="/import">Import</a>: upload or paste the CSV and see what changes before anything is written. <strong>Merge</strong> keeps rows your file does not mention; <strong>Replace</strong> makes the file the whole list.</p>
      <p class="muted">Blank duration or capacity on a section falls back to the subject default.</p>
    </div>
    <div class="panel">
      <h2>2 · Generate</h2>
      <p>The solver places sections respecting room capacity, room clashes, instructor clashes, course clashes, professor availability and each professor's section limit. Preferred hours are soft: they are preferred, not required.</p>
      <p>Generate shows a preview in memory. <strong>Save as draft</strong> writes it to <code>data/drafts/current.csv</code> — private until you publish.</p>
    </div>
    <div class="panel">
      <h2>3 · Review</h2>
      <p>The draft timetable is your working copy. Click any class on the grid or in the table to <strong>lock</strong> it. Generate again and locked classes stay put while everything else is rebuilt around them. Lock a class again to unlock it.</p>
      <p><a href="/versions">Versions</a> are named snapshots. Publishing creates one automatically; you can also save one at any time and restore it into the draft later.</p>
      <p>Open a professor's schedule to see their availability and preferred windows shaded, with classes outside them flagged.</p>
    </div>
    <div class="panel">
      <h2>4 · Publish and export</h2>
      <p><strong>Publish draft</strong> writes the published timetable to <code>schedule.csv</code> and saves a snapshot. This is what readers see; the draft stays private.</p>
      <p><strong>Export</strong> writes <code>schedule.html</code>: one self-contained file you can double-click or share. It is built from the published schedule, not from a draft or an unsaved preview.</p>
    </div>
    <div class="panel">
      <h2>Backups</h2>
      <p><a href="/backup">Download one file</a> holding every CSV in the data folder, and restore from it later. A restore shows exactly which files change, and deletes data files that are not in the backup — they are listed before you confirm.</p>
      <p class="muted">Every file also keeps a <code>.bak</code> copy of its previous version.</p>
    </div>
    <div class="panel">
      <h2>Files on disk</h2>
      <table class="table">
        <thead><tr><th>File</th><th>What it holds</th></tr></thead>
        <tbody>
          <tr><td><code>data/grid.csv</code></td><td>First/last day, start, end, slot length</td></tr>
          <tr><td><code>data/rooms.csv</code></td><td>One row per room</td></tr>
          <tr><td><code>data/sections.csv</code></td><td>One row per class meeting</td></tr>
          <tr><td><code>data/professors/*.csv</code></td><td>One file per professor: windows and limits</td></tr>
          <tr><td><code>data/subjects/*.csv</code></td><td>One file per subject: duration and capacity defaults</td></tr>
          <tr><td><code>data/settings.csv</code></td><td>School name and term shown on the published page</td></tr>
          <tr><td><code>data/drafts/current.csv</code></td><td>Your working draft — private, never published by accident</td></tr>
          <tr><td><code>data/drafts/locks.csv</code></td><td>Classes pinned in place for the next generate</td></tr>
          <tr><td><code>data/schedules/</code></td><td>Named snapshots and their index</td></tr>
          <tr><td><code>schedule.csv</code></td><td>The published schedule</td></tr>
          <tr><td><code>schedule.html</code></td><td>The exported, shareable timetable</td></tr>
        </tbody>
      </table>
    </div>
    <div class="panel">
      <h2>If something goes wrong</h2>
      <ul class="steps-list">
        <li><strong>Port already in use</strong> — the server tries the next port automatically and prints the address it used.</li>
        <li><strong>A change does not appear</strong> — every page reads the CSV files fresh, so a refresh is enough.</li>
        <li><strong>Bad CSV edit by hand</strong> — the app keeps one <code>.bak</code> next to each file it writes.</li>
      </ul>
    </div>`;

  return shell({ ...ctx, title: "How to use this", active: "help" }, body);
}

export function confirmPage(ctx, {
  title,
  subtitle,
  detail,
  action,
  cancelHref,
  file,
  label = "Delete",
  buttonClass = "btn-danger",
}) {
  const body = pageHead(title, subtitle, "") + `<div class="panel">${detail}</div>
    <div class="actions">
      ${
        action
          ? `<form method="post" action="${action}">
              ${file ? `<input type="hidden" name="file" value="${escapeHtml(file)}">` : ""}
              <button class="btn ${buttonClass}">${escapeHtml(label)}</button>
            </form>`
          : ""
      }
      <a class="btn btn-ghost" href="${cancelHref}">${action ? "Cancel" : "Back"}</a>
    </div>`;
  return shell({ ...ctx, title, active: ctx.active }, body);
}

export function notFoundPage(ctx) {
  const body = pageHead("Page not found", "That address does not exist.", "") +
    emptyState("Nothing here", "Check the link or use the sidebar.", "/timetable", "Back to timetable");
  return shell({ ...ctx, title: "Not found", active: "" }, body);
}

export function errorPage(ctx, message) {
  const body = pageHead("Something went wrong", "The app hit an error while building this page.", "") +
    `<div class="banner banner-err"><pre>${escapeHtml(message)}</pre></div>` +
    `<a class="btn" href="/timetable">Back to timetable</a>`;
  return shell({ ...ctx, title: "Error", active: "" }, body);
}

// ---------------------------------------------------------------------------
// The exported file
// ---------------------------------------------------------------------------

export function exportDocument(grid, placements) {
  const flatPlacements = placements.map(flat);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Class schedule</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<main class="export">
  <h1>Class schedule</h1>
  <p class="sub">Generated ${escapeHtml(new Date().toLocaleString())}</p>
  ${timetableHtml(grid, flatPlacements)}
  ${scheduleTable(flatPlacements)}
</main>
</body>
</html>`;
}
