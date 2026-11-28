// site.js - the static reader site that gets published.
//
// It is plain HTML and CSS, written next to the published schedule.csv so that
// GitHub Pages (or any static host, or a USB stick) can serve it with no
// server, no database and no build step. The admin app is never part of it:
// readers get the timetable and the lists, nothing that can change data.

import { DAYS, formatHhmm } from "./data.js";
import { escapeHtml, timetableHtml, TIMETABLE_CSS } from "./pages.js";

const SITE_CSS = `
${TIMETABLE_CSS}
:root {
  --ink: #18181b;
  --muted: #71717a;
  --line: #e4e4e7;
  --bg: #f5f6f8;
  --card: #ffffff;
  --accent: #4338ca;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
a { color: var(--accent); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 28px 20px 64px; }
.site-head { margin-bottom: 18px; }
.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 { margin: 0; font-size: 30px; line-height: 1.15; letter-spacing: -.01em; }
.updated { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
.jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 18px 0 24px;
}
.jump a {
  display: inline-block;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}
.jump a:hover { border-color: var(--accent); color: var(--accent); }
section.block { margin: 0 0 34px; }
h2 {
  margin: 0 0 12px;
  font-size: 13px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}
h3 { margin: 0 0 6px; font-size: 15px; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.person { margin: 0 0 18px; }
.person .count { color: var(--muted); font-size: 12px; font-weight: 400; }
.scroll-x { overflow-x: auto; }
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.table th {
  text-align: left;
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--muted);
  background: #fafafb;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
}
.table td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table tr:last-child td { border-bottom: none; }
.nowrap { white-space: nowrap; }
.empty {
  background: var(--card);
  border: 1px dashed var(--line);
  border-radius: 12px;
  padding: 28px;
  text-align: center;
  color: var(--muted);
}
.site-foot {
  margin-top: 36px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 720px) {
  .wrap { padding: 18px 12px 44px; }
  h1 { font-size: 24px; }
  .timetable { min-width: 760px; }
}
@media print {
  body { background: #fff; font-size: 11px; }
  .wrap { max-width: none; padding: 0; }
  .jump { display: none; }
  .timetable { min-width: 0; }
  .table, .card { break-inside: avoid; }
  section.block { break-inside: auto; }
}
`;

function dayOrder(day) {
  const index = DAYS.indexOf(day);
  return index < 0 ? 99 : index;
}

/** Trailing spaces are invisible but show up in every diff, so drop them. */
function tidy(text) {
  return text.replace(/[ \t]+$/gm, "");
}

function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      dayOrder(a.day) - dayOrder(b.day) ||
      a.start - b.start ||
      a.section_id.localeCompare(b.section_id)
  );
}

function timeRange(row) {
  return `${formatHhmm(row.start)}–${formatHhmm(row.end)}`;
}

function classTable(rows, { instructor = true, room = true } = {}) {
  return `<div class="scroll-x"><table class="table">
    <thead><tr>
      <th>Course</th><th>Section</th>
      ${instructor ? "<th>Instructor</th>" : ""}
      ${room ? "<th>Room</th>" : ""}
      <th>Day</th><th>Time</th>
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.course_name || row.course_id)}</td>
            <td class="nowrap">${escapeHtml(row.section_id)}</td>
            ${instructor ? `<td>${escapeHtml(row.instructor || "—")}</td>` : ""}
            ${room ? `<td>${escapeHtml(row.room_name || row.room_id)}</td>` : ""}
            <td>${escapeHtml(row.day)}</td>
            <td class="nowrap">${timeRange(row)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table></div>`;
}

function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const name = key(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Build every file the reader site needs, as { path: text }. */
export function buildSite({ data, placements, generatedAt = new Date() }) {
  const rows = sortRows(placements);
  const rooms = new Set(rows.map((row) => row.room_id));
  const school = data.settings.school_name || "";
  const term = data.settings.term_label || "Class timetable";
  const heading = school ? `${term} timetable` : "Class timetable";
  const dates =
    data.settings.term_start && data.settings.term_end
      ? `${data.settings.term_start} – ${data.settings.term_end}`
      : "";
  const updated = generatedAt.toLocaleString([], { dateStyle: "long", timeStyle: "short" });

  const summary = [
    `${rows.length} class${rows.length === 1 ? "" : "es"}`,
    `${rooms.size} room${rooms.size === 1 ? "" : "s"}`,
    dates,
  ]
    .filter(Boolean)
    .join(" · ");

  const professors = groupRows(
    rows.filter((row) => row.instructor !== ""),
    (row) => row.instructor
  );
  const byRoom = groupRows(rows, (row) => row.room_name || row.room_id);
  const unassigned = rows.filter((row) => row.instructor === "");

  const body = rows.length === 0
    ? `<div class="empty">No classes have been published yet.</div>`
    : `<section class="block" id="timetable">
        <h2>Timetable</h2>
        <div class="card scroll-x">${timetableHtml(data.grid, rows)}</div>
      </section>

      <section class="block" id="classes">
        <h2>All classes</h2>
        ${classTable(rows)}
      </section>

      <section class="block" id="professors">
        <h2>By professor</h2>
        ${professors
          .map(
            ([name, list]) => `<div class="person">
              <h3>${escapeHtml(name)} <span class="count">· ${list.length} class${list.length === 1 ? "" : "es"}</span></h3>
              ${classTable(list, { instructor: false, room: true })}
            </div>`
          )
          .join("")}
        ${
          unassigned.length > 0
            ? `<div class="person">
                <h3>No instructor <span class="count">· ${unassigned.length}</span></h3>
                ${classTable(unassigned, { instructor: false, room: true })}
              </div>`
            : ""
        }
      </section>

      <section class="block" id="rooms">
        <h2>By room</h2>
        ${byRoom
          .map(
            ([name, list]) => `<div class="person">
              <h3>${escapeHtml(name)} <span class="count">· ${list.length} class${list.length === 1 ? "" : "es"}</span></h3>
              ${classTable(list, { instructor: true, room: false })}
            </div>`
          )
          .join("")}
      </section>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}${school ? ` · ${escapeHtml(school)}` : ""}</title>
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<div class="wrap">
  <header class="site-head">
    ${school ? `<p class="eyebrow">${escapeHtml(school)}</p>` : ""}
    <h1>${escapeHtml(heading)}</h1>
    <p class="updated">Updated ${escapeHtml(updated)} · ${escapeHtml(summary)}</p>
  </header>

  <nav class="jump">
    <a href="#timetable">Timetable</a>
    <a href="#classes">All classes</a>
    <a href="#professors">By professor</a>
    <a href="#rooms">By room</a>
  </nav>

  ${body}

  <footer class="site-foot">
    Published from Class Scheduler. Times are local. This page is static — it has no login and cannot change any data.
  </footer>
</div>
</body>
</html>
`;

  return {
    "index.html": tidy(html),
    "schedule.html": tidy(html),
    "assets/site.css": tidy(SITE_CSS),
  };
}
