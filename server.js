// server.js - the local web app.
//
// Run with:  node server.js
// Then open the address it prints (http://127.0.0.1:8000 by default).
//
// This file only routes requests to the right page and writes the CSV files.
// The solver lives in solver.js, the page HTML in pages.js, and all file
// handling in csv.js / data.js.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  DAYS,
  loadData,
  applySubjectDefaults,
  readSavedSchedule,
  readDraft,
  readLocks,
  readVersions,
  readVersion,
  isStale,
  saveSections,
  saveRooms,
  saveGrid,
  saveProfessorFile,
  saveSubjectFile,
  saveSchedule,
  saveDraft,
  saveLocks,
  saveVersion,
  deleteVersion,
  setCurrentVersion,
  toInt,
  parseHhmm,
  formatHhmm,
} from "./data.js";
import { solve, explainUnplaced, placementPenalty, checkLocks } from "./solver.js";
import {
  validateSection,
  validateProfessor,
  validateSubject,
  validateRoom,
  validateGrid,
} from "./validate.js";
import { readSubmission } from "./upload.js";
import {
  prepareImport,
  applyImport,
  importKinds,
  importColumns,
  describeDiff,
} from "./import.js";
import {
  createBundle,
  bundleToJson,
  parseBundle,
  summariseRestore,
  applyRestore,
  describeBundle,
} from "./backup.js";
import * as pages from "./pages.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// --- command line flags ----------------------------------------------------

const args = process.argv.slice(2);
function flagValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const PORT = Number(flagValue("--port", "8000"));
const BUDGET_MS = Number(flagValue("--budget", "5000"));
const OPEN_BROWSER = !args.includes("--no-browser");
const HOST = args.includes("--lan") ? "0.0.0.0" : "127.0.0.1";

// `--data <folder>` runs against a different data folder (for example a demo
// set, or a second term) and keeps the schedule it produces inside that
// folder, so real results at the project root are never overwritten.
const DATA_FLAG = flagValue("--data", "");
const WORKSPACE = DATA_FLAG ? path.resolve(ROOT, DATA_FLAG) : path.join(ROOT, "data");
const OUT_DIR = DATA_FLAG ? WORKSPACE : ROOT;

/** Load the folder this run is pointed at. */
function load() {
  return loadData({ dataDir: WORKSPACE, outDir: OUT_DIR });
}

// The generated-but-not-saved schedule. It lives here in memory only, which is
// why restarting the server throws an unsaved preview away.
let preview = null;

// An import or a restore that has been checked but not applied yet. Same idea:
// memory only, and lost on restart, which is the safest place for it.
let pendingImport = null;
let pendingRestore = null;

/** Destination list page after importing each kind. */
const IMPORT_BACK = {
  sections: "/sections",
  professors: "/professors",
  subjects: "/subjects",
  rooms: "/rooms",
};

function importKindsForPage() {
  return importKinds().map((kind) => ({ ...kind, columns: importColumns(kind.value) }));
}

// --- small helpers ---------------------------------------------------------

function sendHtml(res, html, status = 200) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendCss(res, css) {
  res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
  res.end(css);
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Form is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

/** Everything a page needs: fresh CSV data, the saved schedule and any preview. */
function baseContext(extra = {}) {
  const data = load();
  const saved = readSavedSchedule(OUT_DIR);
  const draft = readDraft(data);
  const locks = readLocks(data);
  const versions = readVersions(data);

  // Re-check the pins against today's data so pages can warn before a solve.
  const sections = applySubjectDefaults(data.sections, data.subjects);
  const lockCheck = checkLocks({
    locked: locks,
    sections,
    rooms: data.rooms,
    grid: data.grid,
    professors: data.professors,
  });

  return {
    data,
    saved,
    draft,
    locks,
    versions,
    lockCheck,
    preview,
    stale: isStale(data, saved),
    draftStale: isStale(data, draft),
    draftDiffers: Boolean(draft && saved && !samePlacements(draft.placements, saved.placements)),
    exportExists: fs.existsSync(data.paths.export),
    budgetMs: BUDGET_MS,
    ...extra,
  };
}

/** Do two lists of saved rows describe the same timetable? */
function samePlacements(a, b) {
  if (a.length !== b.length) return false;
  const key = (row) => `${row.section_id}|${row.room_id}|${row.day}|${row.start}`;
  const seen = new Set(a.map(key));
  return b.every((row) => seen.has(key(row)));
}

/** Only follow redirects that stay inside this app. */
function safeNext(value) {
  const text = String(value ?? "");
  return text.startsWith("/") && !text.startsWith("//") ? text : "/timetable";
}

function flash(path, message, warnings = []) {
  const text = [message, ...warnings].filter(Boolean).join(" ");
  return { redirect: `${path}?msg=${encodeURIComponent(text)}` };
}

function notFound() {
  return { html: pages.notFoundPage(baseContext({ title: "Not found" })), status: 404 };
}

/** Normalise solver placements (nested) and saved rows (flat) to one shape. */
function flatten(placements) {
  return placements.map((placement) =>
    placement.section
      ? {
          section_id: placement.section.section_id,
          course_id: placement.section.course_id,
          instructor: placement.section.instructor,
          day: placement.day,
          start: placement.start,
          end: placement.end,
        }
      : placement
  );
}

// --- form value builders ---------------------------------------------------

function sectionValuesFromForm(form) {
  return {
    section_id: (form.get("section_id") ?? "").trim(),
    course_id: (form.get("course_id") ?? "").trim(),
    course_name: (form.get("course_name") ?? "").trim(),
    instructor: (form.get("instructor") ?? "").trim(),
    capacity_needed: (form.get("capacity_needed") ?? "").trim(),
    duration_minutes: (form.get("duration_minutes") ?? "").trim(),
    allowed_days: form.getAll("days"),
  };
}

function professorValuesFromForm(form) {
  return {
    professor_id: (form.get("professor_id") ?? "").trim(),
    name: (form.get("name") ?? "").trim(),
    preferred_days: form.getAll("days"),
    preferred_start: (form.get("preferred_start") ?? "").trim(),
    preferred_end: (form.get("preferred_end") ?? "").trim(),
    availability_start: (form.get("availability_start") ?? "").trim(),
    availability_end: (form.get("availability_end") ?? "").trim(),
    max_sections: (form.get("max_sections") ?? "").trim(),
  };
}

function subjectValuesFromForm(form) {
  return {
    subject_id: (form.get("subject_id") ?? "").trim(),
    course_name: (form.get("course_name") ?? "").trim(),
    default_duration_minutes: (form.get("default_duration_minutes") ?? "").trim(),
    default_capacity: (form.get("default_capacity") ?? "").trim(),
  };
}

function roomValuesFromForm(form) {
  return {
    room_id: (form.get("room_id") ?? "").trim(),
    room_name: (form.get("room_name") ?? "").trim(),
    building: (form.get("building") ?? "").trim(),
    capacity: (form.get("capacity") ?? "").trim(),
  };
}

// --- routing ---------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
}

function matchParts(pattern, actual) {
  if (pattern.length !== actual.length) return null;
  const params = {};
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = actual[i];
    else if (pattern[i] !== actual[i]) return null;
  }
  return params;
}

// --- pages -----------------------------------------------------------------

route("GET", "/", () => ({ redirect: "/timetable" }));

route("GET", "/web/app.css", () => ({
  css: fs.readFileSync(path.join(ROOT, "web", "app.css"), "utf8"),
}));

route("GET", "/timetable", ({ query }) => {
  const data = load();
  const saved = readSavedSchedule(OUT_DIR);
  return {
    html: pages.timetablePage(baseContext({
      title: "Timetable",
      active: "timetable",
      msg: query.get("msg"),
      err: query.get("err"),
      data,
      saved,
    })),
  };
});

route("GET", "/generate", ({ query }) => ({
  html: pages.generatePage(baseContext({
    title: "Generate",
    active: "generate",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("POST", "/generate", () => {
  const data = load();
  const sections = applySubjectDefaults(data.sections, data.subjects);
  const locks = readLocks(data);
  const { kept, dropped } = checkLocks({
    locked: locks,
    sections,
    rooms: data.rooms,
    grid: data.grid,
    professors: data.professors,
  });

  const placements = solve({
    sections,
    rooms: data.rooms,
    grid: data.grid,
    professors: data.professors,
    budgetMs: BUDGET_MS,
    locked: kept,
  });

  const placedIds = new Set(placements.map((placement) => placement.section.section_id));
  const unplaced = sections
    .filter((section) => !placedIds.has(section.section_id))
    .map((section) => ({
      section,
      reason: explainUnplaced(section, {
        grid: data.grid,
        rooms: data.rooms,
        professors: data.professors,
        placed: placements,
      }),
    }));

  preview = { placements, unplaced, createdAt: new Date(), locks: kept, droppedLocks: dropped };
  return { redirect: "/preview" };
});

route("GET", "/preview", () => {
  if (!preview) return { redirect: `/generate?err=${encodeURIComponent("Generate a schedule first.")}` };
  return {
    html: pages.previewPage(baseContext({ title: "Preview", active: "generate" })),
  };
});

route("POST", "/save", () => {
  if (!preview) return { redirect: `/timetable?err=${encodeURIComponent("There is nothing to save.")}` };
  const data = load();
  saveDraft(data, preview.placements);
  saveLocks(data, preview.locks ?? []);
  const placed = preview.placements.length;
  const unplaced = preview.unplaced.length;
  const dropped = preview.droppedLocks?.length ?? 0;
  preview = null;
  return flash(
    "/timetable",
    `Draft saved — ${placed} placed, ${unplaced} unplaced.`,
    dropped ? [`${dropped} lock(s) no longer fit and were removed.`] : []
  );
});

route("POST", "/discard", () => {
  preview = null;
  return flash("/timetable", "Preview discarded. The draft is unchanged.");
});

// --- draft, locks and published versions -----------------------------------

route("POST", "/lock", async ({ req }) => {
  const form = await readBody(req);
  const next = safeNext(form.get("next"));
  const data = load();
  const draft = readDraft(data);
  if (!draft) {
    return { redirect: `/timetable?err=${encodeURIComponent("Save a draft before locking classes.")}` };
  }

  const sectionId = (form.get("section_id") ?? "").trim();
  const row = draft.placements.find((placement) => placement.section_id === sectionId);
  if (!row) {
    return { redirect: `/timetable?err=${encodeURIComponent("That class is not in the draft any more.")}` };
  }

  const locks = readLocks(data);
  const existing = locks.find((lock) => lock.section_id === sectionId);
  if (existing) {
    saveLocks(data, locks.filter((lock) => lock.section_id !== sectionId));
    return flash(next, `Unlocked ${sectionId}.`);
  }

  saveLocks(data, [
    ...locks,
    { section_id: row.section_id, room_id: row.room_id, day: row.day, start: row.start },
  ]);
  return flash(next, `Locked ${sectionId} at ${row.day} ${formatHhmm(row.start)}. Generate again to keep it there.`);
});

route("POST", "/unlock-all", () => {
  const data = load();
  const count = readLocks(data).length;
  saveLocks(data, []);
  return flash("/timetable", `Cleared ${count} lock(s).`);
});

route("GET", "/versions", ({ query }) => ({
  html: pages.versionsPage(baseContext({
    title: "Versions",
    active: "timetable",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("POST", "/versions", async ({ req }) => {
  const form = await readBody(req);
  const data = load();
  const source = readDraft(data) ?? readSavedSchedule(OUT_DIR);
  if (!source) {
    return { redirect: `/versions?err=${encodeURIComponent("Generate and save a draft first.")}` };
  }

  const placedIds = new Set(source.placements.map((placement) => placement.section_id));
  const unplaced = data.sections.filter((section) => !placedIds.has(section.section_id)).length;
  const typed = (form.get("name") ?? "").trim();
  const name = typed || `${data.settings.term_label || "Schedule"} — ${new Date().toLocaleString()}`;

  const version = saveVersion(data, { name, placements: source.placements, unplaced });
  return flash("/versions", `Saved version “${version.name}”.`);
});

route("GET", "/versions/restore/:file", ({ params }) => {
  const data = load();
  const version = readVersions(data).find((item) => item.file === params.file);
  const contents = version ? readVersion(data, version) : null;
  if (!version || !contents) {
    return { redirect: `/versions?err=${encodeURIComponent("That version no longer exists.")}` };
  }

  return {
    html: pages.versionRestorePage(baseContext({
      title: "Restore version",
      active: "timetable",
      version,
      versionPlacements: contents.placements,
    })),
  };
});

route("POST", "/versions/restore", async ({ req }) => {
  const form = await readBody(req);
  const file = (form.get("file") ?? "").trim();
  const data = load();
  const version = readVersions(data).find((item) => item.file === file);
  const contents = version ? readVersion(data, version) : null;
  if (!version || !contents) {
    return { redirect: `/versions?err=${encodeURIComponent("That version no longer exists.")}` };
  }

  saveDraft(data, contents.placements);
  saveLocks(data, []);
  return flash("/timetable", `Restored “${version.name}” as the draft. Locks were cleared.`);
});

route("GET", "/versions/delete/:file", ({ params }) => {
  const data = load();
  const version = readVersions(data).find((item) => item.file === params.file);
  if (!version) {
    return { redirect: `/versions?err=${encodeURIComponent("That version no longer exists.")}` };
  }

  return {
    html: pages.versionDeletePage(baseContext({
      title: "Delete version",
      active: "timetable",
      version,
    })),
  };
});

route("POST", "/versions/delete", async ({ req }) => {
  const form = await readBody(req);
  const file = (form.get("file") ?? "").trim();
  const data = load();
  const version = readVersions(data).find((item) => item.file === file);
  if (!version) {
    return { redirect: `/versions?err=${encodeURIComponent("That version no longer exists.")}` };
  }

  deleteVersion(data, file);
  return flash("/versions", `Deleted “${version.name}”.`);
});

route("GET", "/publish", () => {
  const ctx = baseContext({ title: "Publish", active: "timetable" });
  if (!ctx.draft) {
    return { redirect: `/timetable?err=${encodeURIComponent("There is no draft to publish.")}` };
  }
  return { html: pages.publishPage(ctx) };
});

route("POST", "/publish", () => {
  const data = load();
  const draft = readDraft(data);
  if (!draft) {
    return { redirect: `/timetable?err=${encodeURIComponent("There is no draft to publish.")}` };
  }

  saveSchedule(data, draft.placements);

  const placedIds = new Set(draft.placements.map((placement) => placement.section_id));
  const unplaced = data.sections.filter((section) => !placedIds.has(section.section_id)).length;
  const name = `Published ${data.settings.term_label || "schedule"} — ${new Date().toLocaleString()}`;
  const version = saveVersion(data, { name, placements: draft.placements, unplaced });
  setCurrentVersion(data, version.file);

  return flash(
    "/timetable",
    `Published ${draft.placements.length} sections. Snapshot “${version.name}” saved.`
  );
});

route("GET", "/export", ({ query }) => ({
  html: pages.exportPage(baseContext({
    title: "Export",
    active: "export",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("POST", "/export", () => {
  const data = load();
  const saved = readSavedSchedule(OUT_DIR);
  if (!saved) return { redirect: `/export?err=${encodeURIComponent("There is no saved schedule to export.")}` };

  fs.writeFileSync(
    data.paths.export,
    pages.exportDocument(data.grid, saved.placements),
    "utf8"
  );
  return flash("/export", "schedule.html written — double-click it or share it.");
});

// --- sections --------------------------------------------------------------

route("GET", "/sections", ({ query }) => ({
  html: pages.sectionsPage(baseContext({
    title: "Sections",
    active: "sections",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("GET", "/sections/new", () => ({
  html: pages.sectionFormPage(baseContext({
    title: "Add section",
    active: "sections",
    isNew: true,
    values: {
      section_id: "",
      course_id: "",
      course_name: "",
      instructor: "",
      capacity_needed: "",
      duration_minutes: "",
      allowed_days: [],
    },
  })),
}));

route("GET", "/sections/:id/edit", ({ params }) => {
  const data = load();
  const section = data.sections.find((item) => item.section_id === params.id);
  if (!section) return notFound();

  return {
    html: pages.sectionFormPage(baseContext({
      title: "Edit section",
      active: "sections",
      isNew: false,
      values: {
        section_id: section.section_id,
        course_id: section.course_id,
        course_name: section.course_name,
        instructor: section.instructor,
        capacity_needed: section.capacity_needed ? String(section.capacity_needed) : "",
        duration_minutes: section.duration_minutes ? String(section.duration_minutes) : "",
        allowed_days: section.allowed_days,
      },
    })),
  };
});

route("POST", "/sections/save", async ({ req }) => {
  const form = await readBody(req);
  const values = sectionValuesFromForm(form);
  const originalId = (form.get("original_id") ?? "").trim();
  const data = load();
  const { errors, warnings } = validateSection(values, { data, originalId });

  if (errors.length > 0) {
    return {
      status: 400,
      html: pages.sectionFormPage(baseContext({
        title: originalId ? "Edit section" : "Add section",
        active: "sections",
        values,
        isNew: !originalId,
        errors,
        warnings,
      })),
    };
  }

  const section = {
    section_id: values.section_id,
    course_id: values.course_id,
    course_name: values.course_name,
    instructor: values.instructor,
    capacity_needed: toInt(values.capacity_needed, 0),
    duration_minutes: toInt(values.duration_minutes, 0),
    allowed_days: values.allowed_days,
  };

  const sections = originalId
    ? data.sections.map((item) => (item.section_id === originalId ? section : item))
    : [...data.sections, section];

  saveSections(data, sections);
  return flash("/sections", "Section saved.", warnings);
});

route("GET", "/sections/:id/delete", ({ params }) => {
  const data = load();
  const section = data.sections.find((item) => item.section_id === params.id);
  if (!section) return notFound();

  return {
    html: pages.confirmPage(baseContext({ title: "Delete section", active: "sections" }), {
      title: `Delete ${section.section_id}?`,
      subtitle: "This removes the section row. The saved schedule is untouched until you generate again.",
      detail: `<p><strong>${pages.escapeHtml(section.course_name || section.course_id)}</strong> · ${pages.escapeHtml(section.instructor || "no instructor")}</p>`,
      action: `/sections/${encodeURIComponent(section.section_id)}/delete`,
      cancelHref: "/sections",
    }),
  };
});

route("POST", "/sections/:id/delete", ({ params }) => {
  const data = load();
  saveSections(data, data.sections.filter((section) => section.section_id !== params.id));
  return flash("/sections", "Section deleted.");
});

// --- professors ------------------------------------------------------------

route("GET", "/professors", ({ query }) => ({
  html: pages.professorsPage(baseContext({
    title: "Professors",
    active: "professors",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("GET", "/professors/new", () => ({
  html: pages.professorFormPage(baseContext({
    title: "Add professor",
    active: "professors",
    isNew: true,
    values: {
      professor_id: "",
      name: "",
      preferred_days: [],
      preferred_start: "",
      preferred_end: "",
      availability_start: "",
      availability_end: "",
      max_sections: "",
    },
  })),
}));

route("GET", "/professors/:id/edit", ({ params }) => {
  const data = load();
  const professor = data.professorList.find((item) => item.id === params.id);
  if (!professor) return notFound();

  return {
    html: pages.professorFormPage(baseContext({
      title: "Edit professor",
      active: "professors",
      isNew: false,
      values: {
        professor_id: professor.id,
        name: professor.name,
        preferred_days: professor.preferred_days,
        preferred_start: professor.preferred_start ? formatHhmm(professor.preferred_start) : "",
        preferred_end: professor.preferred_end ? formatHhmm(professor.preferred_end) : "",
        availability_start: professor.availability_start ? formatHhmm(professor.availability_start) : "",
        availability_end: professor.availability_end ? formatHhmm(professor.availability_end) : "",
        max_sections: professor.max_sections ? String(professor.max_sections) : "",
      },
    })),
  };
});

route("POST", "/professors/save", async ({ req }) => {
  const form = await readBody(req);
  const values = professorValuesFromForm(form);
  const originalId = (form.get("original_id") ?? "").trim();
  const data = load();
  const { errors, warnings } = validateProfessor(values, { data, originalId });

  if (errors.length > 0) {
    return {
      status: 400,
      html: pages.professorFormPage(baseContext({
        title: originalId ? "Edit professor" : "Add professor",
        active: "professors",
        values,
        isNew: !originalId,
        errors,
        warnings,
      })),
    };
  }

  const id = values.professor_id || originalId;
  const file = path.join(data.paths.professors, `${id}.csv`);
  saveProfessorFile(file, { ...values, professor_id: id });
  return flash("/professors", "Professor saved.", warnings);
});

route("GET", "/professors/:id/delete", ({ params }) => {
  const data = load();
  const professor = data.professorList.find((item) => item.id === params.id);
  if (!professor) return notFound();

  const used = data.sections.filter((section) => section.instructor === professor.name);
  if (used.length > 0) {
    return {
      html: pages.confirmPage(baseContext({ title: "Delete professor", active: "professors" }), {
        title: `Cannot delete ${professor.name}`,
        subtitle: `${used.length} section(s) still use this professor.`,
        detail: `<p>${used.map((section) => `<code>${pages.escapeHtml(section.section_id)}</code>`).join(", ")}</p>
          <p class="muted">Delete or rename those sections first.</p>`,
        action: "",
        cancelHref: "/professors",
      }),
    };
  }

  return {
    html: pages.confirmPage(baseContext({ title: "Delete professor", active: "professors" }), {
      title: `Delete ${professor.name}?`,
      subtitle: "This removes the professor file. No section uses it.",
      detail: `<p>${pages.escapeHtml(professor.file)}</p>`,
      action: `/professors/${encodeURIComponent(professor.id)}/delete`,
      cancelHref: "/professors",
    }),
  };
});

route("POST", "/professors/:id/delete", ({ params }) => {
  const data = load();
  const professor = data.professorList.find((item) => item.id === params.id);
  if (!professor) return notFound();

  const used = data.sections.filter((section) => section.instructor === professor.name);
  if (used.length > 0) {
    return {
      redirect: `/professors?err=${encodeURIComponent(
        `${professor.name} still teaches ${used.length} section(s). Delete or rename them first.`
      )}`,
    };
  }

  fs.unlinkSync(professor.file);
  return flash("/professors", "Professor deleted.");
});

route("GET", "/schedules", () => {
  const data = load();
  const saved = readSavedSchedule(OUT_DIR);
  const source = preview ? preview.placements : saved ? saved.placements : [];
  const flat = flatten(source);
  const sourceLabel = preview ? "preview" : saved ? "saved" : "current";

  const rows = data.professorList.map((professor) => {
    const own = flat.filter((placement) => placement.instructor === professor.name);
    const hours = own.reduce((total, placement) => total + (placement.end - placement.start), 0) / 60;
    const inside = own.filter((placement) =>
      placementPenalty(
        {
          section: { instructor: placement.instructor },
          day: placement.day,
          start: placement.start,
          end: placement.end,
        },
        data.professors
      ) === 0
    ).length;

    return { professor, count: own.length, hours, inside, outside: own.length - inside };
  });

  return {
    html: pages.schedulesPage(
      baseContext({ title: "Professor schedules", active: "schedules", sourceLabel }),
      rows
    ),
  };
});

route("GET", "/professors/:id", ({ params }) => {
  const data = load();
  const professor = data.professorList.find((item) => item.id === params.id);
  if (!professor) return notFound();

  const saved = readSavedSchedule(OUT_DIR);
  const source = preview
    ? { placements: preview.placements, label: "preview" }
    : saved
      ? { placements: saved.placements, label: "saved" }
      : { placements: [], label: "current" };

  const placedIds = new Set(
    flatten(source.placements).map((placement) => placement.section_id)
  );
  const sections = applySubjectDefaults(data.sections, data.subjects);
  const unplaced = sections
    .filter((section) => section.instructor === professor.name && !placedIds.has(section.section_id))
    .map((section) => ({
      section,
      reason: explainUnplaced(section, {
        grid: data.grid,
        rooms: data.rooms,
        professors: data.professors,
        placed: source.placements,
      }),
    }));

  return {
    html: pages.professorDetailPage(baseContext({
      title: `${professor.name} schedule`,
      active: "schedules",
      professor,
      placements: source.placements,
      unplaced,
      sourceLabel: source.label,
    })),
  };
});

// --- subjects --------------------------------------------------------------

route("GET", "/subjects", ({ query }) => ({
  html: pages.subjectsPage(baseContext({
    title: "Subjects",
    active: "subjects",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("GET", "/subjects/new", () => ({
  html: pages.subjectFormPage(baseContext({
    title: "Add subject",
    active: "subjects",
    isNew: true,
    values: {
      subject_id: "",
      course_name: "",
      default_duration_minutes: "",
      default_capacity: "",
    },
  })),
}));

route("GET", "/subjects/:id/edit", ({ params }) => {
  const data = load();
  const subject = data.subjectList.find((item) => item.id === params.id);
  if (!subject) return notFound();

  return {
    html: pages.subjectFormPage(baseContext({
      title: "Edit subject",
      active: "subjects",
      isNew: false,
      values: {
        subject_id: subject.id,
        course_name: subject.course_name,
        default_duration_minutes: subject.default_duration_minutes ? String(subject.default_duration_minutes) : "",
        default_capacity: subject.default_capacity ? String(subject.default_capacity) : "",
      },
    })),
  };
});

route("POST", "/subjects/save", async ({ req }) => {
  const form = await readBody(req);
  const values = subjectValuesFromForm(form);
  const originalId = (form.get("original_id") ?? "").trim();
  const data = load();
  const { errors, warnings } = validateSubject(values, { data, originalId });

  if (errors.length > 0) {
    return {
      status: 400,
      html: pages.subjectFormPage(baseContext({
        title: originalId ? "Edit subject" : "Add subject",
        active: "subjects",
        values,
        isNew: !originalId,
        errors,
        warnings,
      })),
    };
  }

  const id = values.subject_id || originalId;
  const file = path.join(data.paths.subjects, `${id}.csv`);
  saveSubjectFile(file, { ...values, subject_id: id });
  return flash("/subjects", "Subject saved.", warnings);
});

route("GET", "/subjects/:id/delete", ({ params }) => {
  const data = load();
  const subject = data.subjectList.find((item) => item.id === params.id);
  if (!subject) return notFound();

  const used = data.sections.filter((section) => section.course_id === subject.id).length;
  return {
    html: pages.confirmPage(baseContext({ title: "Delete subject", active: "subjects" }), {
      title: `Delete ${subject.id}?`,
      subtitle: used > 0
        ? `${used} section(s) use this course id. They keep their own values, but lose the subject defaults.`
        : "No section uses this subject.",
      detail: `<p>${pages.escapeHtml(subject.file)}</p>`,
      action: `/subjects/${encodeURIComponent(subject.id)}/delete`,
      cancelHref: "/subjects",
    }),
  };
});

route("POST", "/subjects/:id/delete", ({ params }) => {
  const data = load();
  const subject = data.subjectList.find((item) => item.id === params.id);
  if (!subject) return notFound();

  fs.unlinkSync(subject.file);
  return flash("/subjects", "Subject deleted. Sections keep the values they already have.");
});

// --- rooms and grid --------------------------------------------------------

route("GET", "/rooms", ({ query }) => ({
  html: pages.roomsPage(baseContext({
    title: "Rooms & grid",
    active: "rooms",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("GET", "/rooms/new", () => ({
  html: pages.roomFormPage(baseContext({
    title: "Add room",
    active: "rooms",
    isNew: true,
    values: { room_id: "", room_name: "", building: "", capacity: "" },
  })),
}));

route("GET", "/rooms/:id/edit", ({ params }) => {
  const data = load();
  const room = data.rooms.find((item) => item.id === params.id);
  if (!room) return notFound();

  return {
    html: pages.roomFormPage(baseContext({
      title: "Edit room",
      active: "rooms",
      isNew: false,
      values: {
        room_id: room.id,
        room_name: room.name,
        building: room.building,
        capacity: String(room.capacity),
      },
    })),
  };
});

route("POST", "/rooms/save", async ({ req }) => {
  const form = await readBody(req);
  const values = roomValuesFromForm(form);
  const originalId = (form.get("original_id") ?? "").trim();
  const data = load();
  const { errors, warnings } = validateRoom(values, { data, originalId });

  if (errors.length > 0) {
    return {
      status: 400,
      html: pages.roomFormPage(baseContext({
        title: originalId ? "Edit room" : "Add room",
        active: "rooms",
        values,
        isNew: !originalId,
        errors,
        warnings,
      })),
    };
  }

  const room = {
    id: values.room_id,
    name: values.room_name,
    building: values.building,
    capacity: toInt(values.capacity, 0),
  };

  const rooms = originalId
    ? data.rooms.map((item) => (item.id === originalId ? room : item))
    : [...data.rooms, room];

  saveRooms(data, rooms);
  return flash("/rooms", "Room saved.", warnings);
});

route("GET", "/rooms/:id/delete", ({ params }) => {
  const data = load();
  const room = data.rooms.find((item) => item.id === params.id);
  if (!room) return notFound();

  return {
    html: pages.confirmPage(baseContext({ title: "Delete room", active: "rooms" }), {
      title: `Delete ${room.name || room.id}?`,
      subtitle: "The saved schedule is a snapshot, so it keeps showing this room until you generate again.",
      detail: `<p>${pages.escapeHtml(room.id)} · ${room.capacity} seats</p>`,
      action: `/rooms/${encodeURIComponent(room.id)}/delete`,
      cancelHref: "/rooms",
    }),
  };
});

route("POST", "/rooms/:id/delete", ({ params }) => {
  const data = load();
  saveRooms(data, data.rooms.filter((room) => room.id !== params.id));
  return flash("/rooms", "Room deleted.");
});

route("GET", "/grid", ({ query }) => {
  const data = load();
  return {
    html: pages.gridPage(baseContext({
      title: "Teaching grid",
      active: "rooms",
      msg: query.get("msg"),
      err: query.get("err"),
      values: {
        first_day: DAYS[data.grid.first],
        last_day: DAYS[data.grid.last],
        start: formatHhmm(data.grid.start),
        end: formatHhmm(data.grid.end),
        slot_minutes: String(data.grid.slot_minutes),
      },
    })),
  };
});

route("POST", "/grid", async ({ req }) => {
  const form = await readBody(req);
  const values = {
    first_day: (form.get("first_day") ?? "").trim(),
    last_day: (form.get("last_day") ?? "").trim(),
    start: (form.get("start") ?? "").trim(),
    end: (form.get("end") ?? "").trim(),
    slot_minutes: (form.get("slot_minutes") ?? "").trim(),
  };
  const data = load();
  const { errors, warnings } = validateGrid(values);

  if (errors.length > 0) {
    return {
      status: 400,
      html: pages.gridPage(baseContext({
        title: "Teaching grid",
        active: "rooms",
        values,
        errors,
        warnings,
      })),
    };
  }

  const first = DAYS.indexOf(values.first_day);
  const last = DAYS.indexOf(values.last_day);
  saveGrid(data, {
    first,
    last,
    start: parseHhmm(values.start),
    end: parseHhmm(values.end),
    slot_minutes: Number(values.slot_minutes),
    days: DAYS.slice(first, last + 1),
  });

  return flash("/rooms", "Teaching grid saved.", warnings);
});

// --- import and backup -----------------------------------------------------

route("GET", "/import", ({ query }) => ({
  html: pages.importPage(baseContext({
    title: "Import & backup",
    active: "import",
    kinds: importKindsForPage(),
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

route("POST", "/import/preview", async ({ req }) => {
  try {
    const { form, upload } = await readSubmission(req);
    const kind = String(form.get("kind") ?? "sections");
    const text = upload && upload.text.trim() !== "" ? upload.text : String(form.get("text") ?? "");
    pendingImport = { kind, prepared: prepareImport(kind, text, load()) };
    return { redirect: "/import/preview" };
  } catch (error) {
    return { redirect: `/import?err=${encodeURIComponent(error.message)}` };
  }
});

route("GET", "/import/preview", () => {
  if (!pendingImport) return { redirect: "/import" };
  return {
    html: pages.importPreviewPage(baseContext({
      title: "Import preview",
      active: "import",
      prepared: pendingImport.prepared,
    })),
  };
});

route("POST", "/import/apply", async ({ req }) => {
  if (!pendingImport) {
    return { redirect: `/import?err=${encodeURIComponent("That import has expired. Start again.")}` };
  }

  const { form } = await readSubmission(req);
  const mode = form.get("mode") === "replace" ? "replace" : "merge";
  const { kind, prepared } = pendingImport;

  if (prepared.errors.length > 0) {
    pendingImport = null;
    return { redirect: `/import?err=${encodeURIComponent("That import had problems and was not applied.")}` };
  }

  const count = applyImport(kind, prepared, mode, load());
  pendingImport = null;

  const what = mode === "replace" ? "replaced" : "merged";
  return flash(
    IMPORT_BACK[kind] ?? "/import",
    `${count} ${prepared.label.toLowerCase()} ${what} — ${describeDiff(prepared.diff)}.`
  );
});

route("POST", "/import/cancel", () => {
  pendingImport = null;
  return flash("/import", "Import cancelled. Nothing was written.");
});

route("GET", "/backup", ({ query }) => {
  const data = load();
  return {
    html: pages.backupPage(baseContext({
      title: "Backups",
      active: "import",
      bundle: describeBundle(createBundle(data.dataDir)),
      msg: query.get("msg"),
      err: query.get("err"),
    })),
  };
});

route("GET", "/backup/download", () => {
  const data = load();
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    file: {
      name: `class-scheduler-backup-${stamp}.json`,
      type: "application/json; charset=utf-8",
      body: bundleToJson(createBundle(data.dataDir)),
    },
  };
});

route("POST", "/backup/restore/preview", async ({ req }) => {
  try {
    const { form, upload } = await readSubmission(req);
    const text = upload && upload.text.trim() !== "" ? upload.text : String(form.get("text") ?? "");
    const parsed = parseBundle(text);
    if (parsed.errors) {
      return { redirect: `/backup?err=${encodeURIComponent(parsed.errors.join(" "))}` };
    }

    const data = load();
    pendingRestore = {
      bundle: parsed.bundle,
      summary: summariseRestore(parsed.bundle, data.dataDir),
      createdAt: parsed.bundle.createdAt,
    };
    return { redirect: "/backup/restore/preview" };
  } catch (error) {
    return { redirect: `/backup?err=${encodeURIComponent(error.message)}` };
  }
});

route("GET", "/backup/restore/preview", () => {
  if (!pendingRestore) return { redirect: "/backup" };
  return {
    html: pages.restorePreviewPage(baseContext({
      title: "Restore preview",
      active: "import",
      summary: pendingRestore.summary,
      createdAt: pendingRestore.createdAt,
    })),
  };
});

route("POST", "/backup/restore/apply", () => {
  if (!pendingRestore) {
    return { redirect: `/backup?err=${encodeURIComponent("That restore has expired. Choose the file again.")}` };
  }

  applyRestore(pendingRestore.bundle, load().dataDir);
  pendingRestore = null;
  return flash("/backup", "Backup restored.");
});

route("POST", "/backup/restore/cancel", () => {
  pendingRestore = null;
  return flash("/backup", "Restore cancelled. Nothing was written.");
});

// --- help and fallbacks ----------------------------------------------------

route("GET", "/help", ({ query }) => ({
  html: pages.helpPage(baseContext({
    title: "How to use this",
    active: "help",
    msg: query.get("msg"),
    err: query.get("err"),
  })),
}));

// --- HTTP plumbing ---------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
  const parts = pathname.split("/").filter(Boolean);

  if (req.method === "GET" && pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  for (const entry of routes) {
    if (entry.method !== req.method) continue;
    const params = matchParts(entry.parts, parts);
    if (!params) continue;

    try {
      const result = await entry.handler({ params, query: url.searchParams, req });
      if (result.redirect) return redirect(res, result.redirect);
      if (result.css) return sendCss(res, result.css);
      if (result.file) {
        res.writeHead(200, {
          "content-type": result.file.type,
          "content-disposition": `attachment; filename="${result.file.name}"`,
          "content-length": Buffer.byteLength(result.file.body),
          "cache-control": "no-store",
        });
        res.end(result.file.body);
        return;
      }
      return sendHtml(res, result.html, result.status ?? 200);
    } catch (error) {
      console.error(error);
      try {
        return sendHtml(
          res,
          pages.errorPage(baseContext({ title: "Error" }), error.stack ?? String(error)),
          500
        );
      } catch {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Something went wrong:\n${error.stack ?? error}`);
        return;
      }
    }
  }

  return sendHtml(res, pages.notFoundPage(baseContext({ title: "Not found" })), 404);
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Opening a browser is a convenience; never let it stop the server.
  }
}

let attempts = 0;

/**
 * Start listening. Resolves with { server, port, url } once the socket is up,
 * so callers (and the tests) never have to guess when it is ready.
 */
export function startServer({
  port = PORT,
  host = HOST,
  openBrowser: shouldOpen = OPEN_BROWSER,
} = {}) {
  const server = http.createServer(handle);

  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && port !== 0 && attempts < 10) {
        attempts += 1;
        console.log(`Port ${port} is busy, trying ${port + 1}…`);
        resolve(startServer({ port: port + 1, host, openBrowser: shouldOpen }));
        return;
      }
      reject(error);
    });

    server.once("listening", () => {
      const actualPort = server.address().port;
      const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      const url = `http://${shownHost}:${actualPort}/timetable`;
      if (shouldOpen) openBrowser(url);
      resolve({ server, port: actualPort, url });
    });

    server.listen(port, host);
  });
}

// Only start (and print the banner) when run directly, not when imported by a test.
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer()
    .then(({ url }) => {
      const where = DATA_FLAG ? `   (data: ${WORKSPACE})` : "";
      console.log("");
      console.log(`  Class Scheduler is running at ${url}${where}`);
      console.log("  Press Ctrl+C to stop.");
      console.log("");
    })
    .catch((error) => {
      console.error("Could not start the server:", error.message);
      process.exit(1);
    });
}
