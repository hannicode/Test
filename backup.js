// backup.js - one file that holds every data file, and the way back.
//
// A backup is a plain JSON document:
//   { format, version, createdAt, files: { "sections.csv": "...", ... } }
// Text in, text out, no compression and no binary format, so you can open one
// in a text editor and see exactly what it contains.
//
// Restoring is deliberately a two-step operation: summarise() reports what
// would change, and only apply() touches the disk.

import fs from "node:fs";
import path from "node:path";

import { writeTextAtomic } from "./csv.js";

export const BUNDLE_FORMAT = "class-scheduler-backup";
export const BUNDLE_VERSION = 1;

/** Every CSV under `dir`, as relative paths using forward slashes. */
function listCsvFiles(dir, base = dir, found = []) {
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listCsvFiles(full, base, found);
    } else if (entry.name.toLowerCase().endsWith(".csv")) {
      found.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }

  return found.sort();
}

/** A backup of every data file. */
export function createBundle(dataDir) {
  const files = {};
  for (const relative of listCsvFiles(dataDir)) {
    files[relative] = fs.readFileSync(path.join(dataDir, relative), "utf8");
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    files,
  };
}

export function bundleToJson(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** Everything a bundle would restore, without touching anything. */
export function describeBundle(bundle) {
  const files = Object.entries(bundle.files);
  const bytes = files.reduce((total, [, text]) => total + Buffer.byteLength(text), 0);
  return { fileCount: files.length, bytes };
}

/** A path we are willing to write to: inside the data folder, and a CSV. */
function isSafeRelative(relative) {
  if (typeof relative !== "string" || relative === "") return false;
  if (relative.includes("\\") || relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return false;
  if (!relative.toLowerCase().endsWith(".csv")) return false;
  return relative
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

/** Parse and sanity-check a backup file. */
export function parseBundle(text) {
  let bundle;
  try {
    bundle = JSON.parse(String(text ?? ""));
  } catch {
    return { errors: ["That file is not valid JSON. Choose the .json file the backup button downloads."] };
  }

  if (!bundle || bundle.format !== BUNDLE_FORMAT || typeof bundle.files !== "object" || bundle.files === null) {
    return { errors: ["That file is not a Class Scheduler backup."] };
  }

  const errors = [];
  for (const [relative, content] of Object.entries(bundle.files)) {
    if (!isSafeRelative(relative)) errors.push(`Unexpected file path in the backup: ${relative}`);
    else if (typeof content !== "string") errors.push(`${relative} is not text.`);
  }

  for (const required of ["sections.csv", "grid.csv", "rooms.csv"]) {
    if (typeof bundle.files[required] !== "string") errors.push(`The backup is missing ${required}.`);
  }

  if (errors.length > 0) return { errors };
  return { bundle };
}

function sameText(a, b) {
  return String(a).replace(/\r\n/g, "\n") === String(b).replace(/\r\n/g, "\n");
}

/** What restoring this bundle would do, file by file. */
export function summariseRestore(bundle, dataDir) {
  const onDisk = listCsvFiles(dataDir);
  const incoming = Object.keys(bundle.files).sort();

  const added = [];
  const changed = [];
  const same = [];

  for (const relative of incoming) {
    if (!onDisk.includes(relative)) {
      added.push(relative);
      continue;
    }
    const current = fs.readFileSync(path.join(dataDir, relative), "utf8");
    if (sameText(current, bundle.files[relative])) same.push(relative);
    else changed.push(relative);
  }

  const removed = onDisk.filter((relative) => !(relative in bundle.files));

  return { added, changed, same, removed };
}

/**
 * Write the bundle over the data folder. Files that are not in the bundle are
 * deleted, because "restore" means "make it look like that backup" - the
 * caller is expected to have shown the summary first.
 */
export function applyRestore(bundle, dataDir, { deleteExtra = true } = {}) {
  if (deleteExtra) {
    for (const relative of listCsvFiles(dataDir)) {
      if (!(relative in bundle.files)) fs.unlinkSync(path.join(dataDir, relative));
    }
  }

  for (const [relative, content] of Object.entries(bundle.files)) {
    if (!isSafeRelative(relative)) continue;
    writeTextAtomic(path.join(dataDir, relative), content);
  }
}
