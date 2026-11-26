// csv.js - reading and writing the small CSV files that hold the college data.
//
// Every file the app stores on disk goes through this module, so there is
// exactly one place that knows CSV syntax and one place that touches files
// safely (see writeTextAtomic).

import fs from "node:fs";
import path from "node:path";

/**
 * Turn CSV text into rows of cells.
 * Handles quoted fields ("a,b"), escaped quotes ("a""b") and Windows line endings.
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // drop UTF-8 BOM

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines (a trailing newline, an empty file) are not data.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Turn CSV text into an array of objects, using the first row as headers. */
export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (cells[index] ?? "").trim();
    });
    return obj;
  });
}

/** Quote a single cell only when it contains a comma, quote or newline. */
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Turn objects into CSV text with a fixed column order. */
export function objectsToCsv(headers, objects) {
  const lines = [headers.join(",")];
  for (const obj of objects) {
    lines.push(headers.map((header) => csvCell(obj[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** Read one CSV file into objects. A missing file is treated as empty. */
export function readCsvFile(file) {
  if (!fs.existsSync(file)) return [];
  return csvToObjects(fs.readFileSync(file, "utf8"));
}

/**
 * Read a directory that holds one record per file (professors, subjects).
 * Returns [{ file, name, values }] sorted by file name.
 */
export function readCsvDirectory(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return {
        file,
        name: path.basename(name, ".csv"),
        values: csvToObjects(fs.readFileSync(file, "utf8"))[0] ?? {},
      };
    })
    .filter((entry) =>
      Object.values(entry.values).some((value) => String(value ?? "").trim() !== "")
    );
}

/**
 * Write a file in one safe step: write a temporary file, keep a .bak copy of
 * the previous version, then rename over the original. A crash can never
 * leave half a CSV behind.
 */
export function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text, "utf8");
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}

/** Write objects to a CSV file atomically. */
export function writeCsvFile(file, headers, objects) {
  writeTextAtomic(file, objectsToCsv(headers, objects));
}
