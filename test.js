// test.js - the safety net. Run with:  npm test
//
// No test framework, no dependencies: a small list of checks, a clear pass or
// fail per check, and a non-zero exit code when anything is wrong.
//
// What it protects:
//   - the data folder is complete and every section points at something real
//   - the solver places everything without breaking a hard constraint
//   - the forms refuse structurally broken input
//   - every page answers, so a renamed function cannot take the app down
//
// It never writes to disk: it generates a preview in memory and never saves it.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadData, applySubjectDefaults } from "./data.js";
import { solve } from "./solver.js";
import { validateSection, validateRoom, validateGrid } from "./validate.js";
import { objectsToCsv, csvToObjects } from "./csv.js";
import { startServer } from "./server.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");

const data = loadData({ dataDir: DATA_DIR, outDir: ROOT });

// ---------------------------------------------------------------------------
// A tiny runner
// ---------------------------------------------------------------------------

const checks = [];
function test(name, fn) {
  checks.push({ name, fn });
}

// Every placement a placement should be: no shared room, no shared instructor,
// no shared course, and no double-booking around physics.
function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

function conflicts(a, b) {
  if (!overlaps(a, b)) return false;
  return (
    a.room.id === b.room.id ||
    (a.section.instructor !== "" && a.section.instructor === b.section.instructor) ||
    a.section.course_id === b.section.course_id
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

test("the data folder is complete", () => {
  assert.ok(data.sections.length > 0, "no sections");
  assert.ok(data.professorList.length > 0, "no professors");
  assert.ok(data.subjectList.length > 0, "no subjects");
  assert.ok(data.rooms.length > 0, "no rooms");
  assert.ok(data.grid.days.length > 0, "the grid has no days");
  assert.ok(data.settings.school_name !== "", "settings.csv has no school name");
});

test("every section points at a real professor and subject", () => {
  const unknown = [];
  for (const section of data.sections) {
    if (section.instructor && !data.professors.has(section.instructor)) {
      unknown.push(`${section.section_id} -> ${section.instructor}`);
    }
    if (!data.subjects.has(section.course_id)) {
      unknown.push(`${section.section_id} -> course ${section.course_id}`);
    }
  }
  assert.deepEqual(unknown, [], `dangling references:\n  ${unknown.join("\n  ")}`);
});

test("every section fits in at least one room", () => {
  const biggest = Math.max(...data.rooms.map((room) => room.capacity));
  const tooBig = applySubjectDefaults(data.sections, data.subjects)
    .filter((section) => section.capacity_needed > biggest)
    .map((section) => `${section.section_id} needs ${section.capacity_needed}, biggest room is ${biggest}`);
  assert.deepEqual(tooBig, [], tooBig.join("\n"));
});

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

let solution = null;
let effectiveSections = null;

test("the solver places every section", () => {
  effectiveSections = applySubjectDefaults(data.sections, data.subjects);
  solution = solve({
    sections: effectiveSections,
    rooms: data.rooms,
    grid: data.grid,
    professors: data.professors,
    budgetMs: 4000,
  });
  const missing = effectiveSections
    .filter((section) => !solution.some((placement) => placement.section.section_id === section.section_id))
    .map((section) => section.section_id);
  assert.deepEqual(missing, [], `not placed: ${missing.join(", ")}`);
});

test("the solution breaks no hard constraint", () => {
  assert.ok(solution, "the solver test did not run");
  const problems = [];

  for (let i = 0; i < solution.length; i += 1) {
    for (let j = i + 1; j < solution.length; j += 1) {
      if (conflicts(solution[i], solution[j])) {
        problems.push(`${solution[i].section.section_id} clashes with ${solution[j].section.section_id}`);
      }
    }
  }

  for (const placement of solution) {
    const { section, room } = placement;
    if (room.capacity < section.capacity_needed) {
      problems.push(`${section.section_id} (${section.capacity_needed}) in ${room.id} (${room.capacity})`);
    }
    if (section.allowed_days.length > 0 && !section.allowed_days.includes(placement.day)) {
      problems.push(`${section.section_id} placed on ${placement.day}, not an allowed day`);
    }
    if (placement.start < data.grid.start || placement.end > data.grid.end) {
      problems.push(`${section.section_id} outside the teaching day`);
    }

    const professor = data.professors.get(section.instructor);
    if (professor) {
      if (
        professor.availability_start &&
        professor.availability_end &&
        (placement.start < professor.availability_start || placement.end > professor.availability_end)
      ) {
        problems.push(`${section.section_id} outside ${professor.name}'s availability`);
      }
      const load = solution.filter((item) => item.section.instructor === professor.name).length;
      if (professor.max_sections && load > professor.max_sections) {
        problems.push(`${professor.name} has ${load} sections, limit ${professor.max_sections}`);
      }
    }
  }

  assert.deepEqual(problems, [], problems.slice(0, 10).join("\n"));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a section without a course is refused", () => {
  const { errors } = validateSection(
    {
      section_id: "TEST-1",
      course_id: "",
      course_name: "",
      instructor: "",
      capacity_needed: "",
      duration_minutes: "",
      allowed_days: [],
    },
    { data, originalId: "" }
  );
  assert.ok(errors.length > 0, "a blank course id was accepted");
});

test("a duplicate section id is refused", () => {
  const existing = data.sections[0].section_id;
  const { errors } = validateSection(
    {
      section_id: existing,
      course_id: data.sections[0].course_id,
      course_name: "",
      instructor: "",
      capacity_needed: "",
      duration_minutes: "",
      allowed_days: [],
    },
    { data, originalId: "" }
  );
  assert.ok(errors.some((error) => error.includes("already exists")), errors.join("; "));
});

test("a room with no seats is refused", () => {
  const { errors } = validateRoom(
    { room_id: "TEST-ROOM", room_name: "Test", building: "", capacity: "0" },
    { data, originalId: "" }
  );
  assert.ok(errors.length > 0, "a zero-capacity room was accepted");
});

test("a grid whose slots do not divide the day is refused", () => {
  const { errors } = validateGrid({
    first_day: "Mon",
    last_day: "Sat",
    start: "07:00",
    end: "21:00",
    slot_minutes: "50",
  });
  assert.ok(errors.some((error) => error.includes("divide")), errors.join("; "));
});

// ---------------------------------------------------------------------------
// CSV round-trip
// ---------------------------------------------------------------------------

test("CSV survives commas and quotes", () => {
  const rows = [{ section_id: "S1", course_name: 'Data, "Structures"', instructor: "A, B" }];
  const back = csvToObjects(objectsToCsv(["section_id", "course_name", "instructor"], rows));
  assert.deepEqual(back, rows);
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

test("every page answers", async () => {
  const { server, port } = await startServer({ port: 0, openBrowser: false });
  const base = `http://127.0.0.1:${port}`;

  try {
    const pages = [
      "/timetable",
      "/generate",
      "/sections",
      "/sections/new",
      "/professors",
      "/professors/new",
      "/subjects",
      "/subjects/new",
      "/rooms",
      "/rooms/new",
      "/grid",
      "/help",
      "/schedules",
      "/web/app.css",
    ];

    for (const page of pages) {
      const response = await fetch(base + page);
      assert.equal(response.status, 200, `${page} answered ${response.status}`);
      const body = await response.text();
      assert.ok(body.length > 100, `${page} returned almost nothing`);
    }

    const missing = await fetch(`${base}/no-such-page`);
    assert.equal(missing.status, 404, "an unknown address did not 404");

    // Generate a preview in memory, then look at it. Nothing is saved.
    const generated = await fetch(`${base}/generate`, { method: "POST", redirect: "manual" });
    assert.equal(generated.status, 303, "generate did not redirect to the preview");

    const preview = await fetch(`${base}/preview`);
    assert.equal(preview.status, 200, "the preview did not render");
    const html = await preview.text();
    assert.ok(html.includes("placed"), "the preview has no counts");
    assert.ok(!html.includes("Every remaining slot clashes"), "the demo data left sections unplaced");

    await fetch(`${base}/discard`, { method: "POST", redirect: "manual" });
    const afterDiscard = await fetch(`${base}/preview`, { redirect: "manual" });
    assert.equal(afterDiscard.status, 303, "the preview survived a discard");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function makeTempWorkspace() {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "class-scheduler-test-"));
  fs.cpSync(DATA_DIR, dir, { recursive: true });
  return dir;
}

test("an import shows what it would change without writing", async () => {
  const fs = await import("node:fs");
  const { prepareImport } = await import("./import.js");
  const dir = await makeTempWorkspace();

  try {
    const scratch = loadData({ dataDir: dir, outDir: dir });
    const csv = [
      "section_id,course_id,instructor",
      "CS101-L1,CS101,Dr. New Teacher",
      "CS101-L9,CS101,Dr. Amara Okafor",
    ].join("\n");

    const prepared = prepareImport("sections", csv, scratch);

    assert.deepEqual(prepared.errors, [], prepared.errors.join("; "));
    assert.equal(prepared.diff.added.length, 1, "expected one new section");
    assert.equal(prepared.diff.changed.length, 1, "expected one changed section");
    assert.equal(prepared.diff.unchanged.length, 0);
    assert.equal(prepared.diff.missing.length, scratch.sections.length - 1);

    // Nothing may be written during preparation.
    const onDisk = loadData({ dataDir: dir, outDir: dir });
    assert.equal(onDisk.sections.length, scratch.sections.length, "prepare wrote to disk");
    assert.equal(
      onDisk.sections.find((section) => section.section_id === "CS101-L1").instructor,
      "Dr. Amara Okafor",
      "prepare changed a section on disk"
    );

    const { applyImport } = await import("./import.js");
    applyImport("sections", prepared, "merge", scratch);

    const after = loadData({ dataDir: dir, outDir: dir });
    assert.equal(after.sections.length, scratch.sections.length + 1, "merge did not add the row");
    assert.equal(
      after.sections.find((section) => section.section_id === "CS101-L1").instructor,
      "Dr. New Teacher",
      "merge did not update the row"
    );

    // A partial import must leave every other file alone.
    assert.equal(after.professorList.length, scratch.professorList.length, "merge touched professors");
    assert.equal(fs.readdirSync(path.join(dir, "professors")).length, scratch.professorList.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an import that would break a file is refused", async () => {
  const fs = await import("node:fs");
  const { prepareImport } = await import("./import.js");
  const dir = await makeTempWorkspace();

  try {
    const scratch = loadData({ dataDir: dir, outDir: dir });

    const noCourse = prepareImport("sections", "section_id,course_id\nNEW-1,", scratch);
    assert.ok(noCourse.errors.length > 0, "a new section without a course was accepted");

    const duplicate = prepareImport("sections", "section_id,course_id\nNEW-1,CS101\nNEW-1,CS101", scratch);
    assert.ok(
      duplicate.errors.some((error) => error.includes("appears twice")),
      duplicate.errors.join("; ")
    );

    // Still untouched.
    assert.equal(loadData({ dataDir: dir, outDir: dir }).sections.length, scratch.sections.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("one-click backup restores exactly what it captured", async () => {
  const fs = await import("node:fs");
  const { createBundle, bundleToJson, parseBundle, summariseRestore, applyRestore } = await import("./backup.js");
  const dir = await makeTempWorkspace();

  try {
    const bundle = createBundle(dir);
    const parsed = parseBundle(bundleToJson(bundle));
    assert.deepEqual(parsed.errors, undefined, "a fresh backup failed to parse");

    const same = summariseRestore(parsed.bundle, dir);
    assert.equal(same.changed.length + same.added.length + same.removed.length, 0, "a fresh backup showed changes");

    // Change a file and add a stray one.
    const sectionsFile = path.join(dir, "sections.csv");
    const original = fs.readFileSync(sectionsFile, "utf8");
    fs.writeFileSync(sectionsFile, `${original}JUNK-1,CS101,Junk,Dr. Amara Okafor,,,`);
    fs.writeFileSync(path.join(dir, "professors", "P999.csv"), "professor_id,name\nP999,Stray\n");

    const dirty = summariseRestore(parsed.bundle, dir);
    assert.deepEqual(dirty.changed, ["sections.csv"]);
    assert.deepEqual(dirty.removed, ["professors/P999.csv"]);

    applyRestore(parsed.bundle, dir);
    assert.equal(fs.readFileSync(sectionsFile, "utf8"), original, "restore did not put the file back");
    assert.equal(fs.existsSync(path.join(dir, "professors", "P999.csv")), false, "restore left a stray file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a backup cannot write outside the data folder", async () => {
  const { parseBundle } = await import("./backup.js");
  const parsed = parseBundle(
    JSON.stringify({
      format: "class-scheduler-backup",
      files: { "../escape.csv": "x", "sections.csv": "a", "grid.csv": "b", "rooms.csv": "c" },
    })
  );
  assert.ok(parsed.errors?.length > 0, "a path outside the data folder was accepted");
});

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

test("a multipart upload is split into fields and a file", async () => {
  const { parseMultipart } = await import("./upload.js");
  const boundary = "----test-boundary";
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="kind"\r\n\r\n` +
      `sections\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="sections.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `section_id,course_id\r\nA,B\r\n` +
      `--${boundary}--\r\n`
  );

  const { fields, files } = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.equal(fields.kind, "sections");
  assert.equal(files.file.filename, "sections.csv");
  assert.equal(files.file.text, "section_id,course_id\r\nA,B");
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${String(error.message).split("\n").join("\n        ")}`);
  }
}

console.log("");
console.log(failed === 0 ? `All ${checks.length} checks passed.` : `${failed} of ${checks.length} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
