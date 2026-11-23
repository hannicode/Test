"use strict";
// frontend/schedule.ts - TypeScript source of the class-scheduler front end.
//
// schedule.py embeds the solved schedule and grid as the globals GRID and
// PLACEMENTS in schedule.html; this file draws the page: a timetable grid
// (main view) plus a table of the placed sections (below it).
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// One pastel color per course, in order of first appearance in PLACEMENTS.
const PALETTE = [
    "#BBDEFB", "#D1C4E9", "#C8E6C9", "#FFF3E0", "#FCE4EC",
    "#E0F7FA", "#FFF9C4", "#E8EAF6", "#B2DFDB", "#F0F4C3",
];
function dayIndex(day) {
    const idx = DAYS.indexOf(day);
    return idx === -1 ? 0 : idx;
}
function slotIndex(minutes) {
    return Math.round((minutes - GRID.start) / GRID.slot_minutes);
}
function slotLabel(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function colorsFor() {
    const color = new Map();
    let idx = 0;
    for (const p of PLACEMENTS) {
        if (!color.has(p.course_id)) {
            color.set(p.course_id, PALETTE[idx % PALETTE.length]);
            idx++;
        }
    }
    return color;
}
function attachTooltip(block, p) {
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
function drawTimetable() {
    const colDays = DAYS.slice(DAYS.indexOf(GRID.first_day), DAYS.indexOf(GRID.last_day) + 1);
    const nDays = colDays.length;
    const nSlots = Math.max(1, Math.round((GRID.end - GRID.start) / GRID.slot_minutes));
    const timet = document.createElement("div");
    timet.className = "timetable";
    timet.style.display = "grid";
    timet.style.gridTemplateColumns = `60px repeat(${nDays}, 1fr)`;
    timet.style.gridTemplateRows = `40px repeat(${nSlots}, 40px)`;
    timet.style.gap = "2px";
    // Corner cell (top-left, empty).
    const corner = document.createElement("div");
    corner.className = "cell";
    corner.style.gridColumn = "1 / 2";
    corner.style.gridRow = "1 / 2";
    timet.appendChild(corner);
    // Day-of-week headers across the top, one per day column.
    colDays.forEach((day, i) => {
        const cell = document.createElement("div");
        cell.className = "cell day";
        cell.textContent = day;
        cell.style.gridColumn = `${2 + i} / ${3 + i}`;
        cell.style.gridRow = "1 / 2";
        timet.appendChild(cell);
    });
    // Time slots down the far-left column + empty cells in each day column
    // (the empty cells carry no text - timestamps live only in the left column).
    for (let k = 0; k < nSlots; k++) {
        const row = `${2 + k} / ${3 + k}`;
        const label = document.createElement("div");
        label.className = "cell time";
        label.textContent = slotLabel(GRID.start + k * GRID.slot_minutes);
        label.style.gridColumn = "1 / 2";
        label.style.gridRow = row;
        timet.appendChild(label);
        for (let c = 0; c < nDays; c++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.style.gridColumn = `${2 + c} / ${3 + c}`;
            cell.style.gridRow = row;
            timet.appendChild(cell);
        }
    }
    // Blocks: one per placed section, spanning its actual start-to-end time
    // vertically in its day column.
    const colors = colorsFor();
    PLACEMENTS.forEach((p) => {
        const col = Math.max(colDays.indexOf(p.day), 0);
        const block = document.createElement("div");
        block.className = "block";
        block.style.background = colors.get(p.course_id) || "#cccccc";
        block.style.gridColumn = `${2 + col} / ${3 + col}`;
        block.style.gridRow = `${2 + slotIndex(p.start)} / ${2 + slotIndex(p.end)}`;
        block.innerHTML =
            `<div class="block-course">${escapeHtml(p.course_id)}</div>` +
                `<div class="block-info">${slotLabel(p.start)} – ${slotLabel(p.end)} · ` +
                `${escapeHtml(p.room_id)} · ${escapeHtml(p.instructor)}</div>`;
        timet.appendChild(block);
        attachTooltip(block, p);
    });
    document.body.appendChild(timet);
}
function drawTable() {
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
    const sorted = [...PLACEMENTS].sort((a, b) => (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) ||
        (a.start - b.start) ||
        a.section_id.localeCompare(b.section_id));
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
