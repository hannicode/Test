// upload.js - reading a file out of a normal HTML form.
//
// Browsers post file inputs as multipart/form-data, which is a small format:
// a boundary line separates the parts, each part has headers, then a blank
// line, then the value. We only need text files, so there is no need for a
// streaming parser - read the body, split it, done.
//
// Keeping this in its own file means the server never has to think about
// boundary strings, and the parser can be tested on its own.

/** Read the whole request body as one buffer, refusing anything huge. */
export function readRawBody(req, limit = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("That file is too large (12 MB is the limit)."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Split a multipart body into plain fields and files.
 * `text` is decoded as UTF-8; CSV and JSON are text, so that is enough.
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType ?? ""));
  if (!match) throw new Error("The upload did not include a form boundary.");

  const boundary = `--${(match[1] ?? match[2]).trim()}`;
  const fields = {};
  const files = {};

  for (const part of buffer.toString("utf8").split(boundary)) {
    // The first split is the preamble and the last is the closing "--".
    const trimmed = part.replace(/^\r\n/, "");
    if (trimmed.trim() === "" || trimmed.trim() === "--") continue;

    const split = trimmed.indexOf("\r\n\r\n");
    if (split < 0) continue;

    const headerText = trimmed.slice(0, split);
    let value = trimmed.slice(split + 4);
    if (value.endsWith("\r\n")) value = value.slice(0, -2);

    const name = /name="([^"]*)"/i.exec(headerText)?.[1];
    if (!name) continue;

    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
    if (filename && filename !== "") {
      files[name] = { filename, text: value };
    } else {
      fields[name] = value;
    }
  }

  return { fields, files };
}

/**
 * One entry point for every form: returns a URLSearchParams for the plain
 * fields plus the first uploaded file, if any.
 */
export async function readSubmission(req) {
  const raw = await readRawBody(req);
  const type = req.headers["content-type"] ?? "";

  if (!type.toLowerCase().includes("multipart/form-data")) {
    return { form: new URLSearchParams(raw.toString("utf8")), upload: null };
  }

  const { fields, files } = parseMultipart(raw, type);
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);

  const upload = Object.values(files)[0] ?? null;
  return { form, upload };
}
