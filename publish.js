// publish.js - the checks before publishing, and the git steps after.
//
// Publishing is allowed to fail softly. The timetable and the reader site are
// always written locally; git is a second step that can be skipped (no repo, no
// remote) or can fail (credentials, network). The page then shows the exact
// commands to run by hand, so a failed push never traps the user.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Run one git command in `dir` and never throw. */
async function git(dir, args) {
  try {
    const { stdout, stderr } = await exec("git", args, {
      cwd: dir,
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message;
    return { ok: false, output };
  }
}

/** Where the published site would live, if the remote is GitHub. */
export function pagesUrl(remote) {
  const text = String(remote ?? "").trim().replace(/\.git$/i, "");
  let match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(text);
  if (!match) match = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(text);
  if (!match) return "";
  const [, user, repo] = match;
  return `https://${user}.github.io/${repo}/`;
}

/** What the folder looks like to git, without changing anything. */
export async function inspectGit(dir) {
  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.output.trim() !== "true") {
    return {
      isRepo: false,
      branch: "",
      remote: "",
      pagesUrl: "",
      error: inside.output,
    };
  }

  const [branch, remote, status] = await Promise.all([
    git(dir, ["branch", "--show-current"]),
    git(dir, ["remote", "get-url", "origin"]),
    git(dir, ["status", "--porcelain"]),
  ]);

  return {
    isRepo: true,
    branch: branch.ok ? branch.output.trim() : "",
    remote: remote.ok ? remote.output.trim() : "",
    pagesUrl: remote.ok ? pagesUrl(remote.output) : "",
    dirty: status.ok ? status.output !== "" : false,
  };
}

/**
 * The checklist shown before publishing. Only a missing draft blocks; everything
 * else is a warning, because the registrar may know something the app does not.
 */
export function buildPreflight({ data, draft, locks = [], lockCheck, draftStale, git }) {
  const checks = [];
  const add = (ok, label, detail = "", level = "warn") => {
    checks.push({ ok, label, detail, level });
  };

  if (!draft) {
    add(false, "A draft is ready", "Generate a schedule and save it as a draft first.", "block");
    return { checks, blocked: true, warnings: 1, pagesUrl: git?.pagesUrl ?? "" };
  }

  const sectionIds = new Set(data.sections.map((section) => section.section_id));
  const roomIds = new Set(data.rooms.map((room) => room.id));
  const missingSections = draft.placements.filter((row) => !sectionIds.has(row.section_id));
  const missingRooms = draft.placements.filter((row) => !roomIds.has(row.room_id));

  add(
    missingSections.length === 0,
    "Every class in the draft still exists",
    missingSections.length > 0
      ? `${missingSections.length} section(s) were deleted from the data: ${missingSections
          .slice(0, 5)
          .map((row) => row.section_id)
          .join(", ")}${missingSections.length > 5 ? "…" : ""}`
      : "All section ids match the data folder."
  );

  add(
    missingRooms.length === 0,
    "Every room in the draft still exists",
    missingRooms.length > 0
      ? `${missingRooms.length} placement(s) use a room that was deleted: ${[
          ...new Set(missingRooms.map((row) => row.room_id)),
        ].join(", ")}`
      : "All rooms match the data folder."
  );

  const placedIds = new Set(draft.placements.map((row) => row.section_id));
  const notInDraft = data.sections.filter((section) => !placedIds.has(section.section_id));
  add(
    notInDraft.length === 0,
    "Every section is in the draft",
    notInDraft.length > 0
      ? `${notInDraft.length} section(s) will not be published: ${notInDraft
          .slice(0, 8)
          .map((section) => section.section_id)
          .join(", ")}${notInDraft.length > 8 ? "…" : ""}`
      : `All ${data.sections.length} sections are placed.`
  );

  const unknownInstructor = data.sections.filter(
    (section) => section.instructor && !data.professors.has(section.instructor)
  );
  add(
    unknownInstructor.length === 0,
    "Every instructor matches a professor",
    unknownInstructor.length > 0
      ? `${unknownInstructor.length} section(s) name someone with no professor file: ${unknownInstructor
          .slice(0, 4)
          .map((section) => `${section.section_id} → ${section.instructor}`)
          .join(", ")}${unknownInstructor.length > 4 ? "…" : ""}`
      : "Names match the professor files."
  );

  const unknownSubject = data.sections.filter(
    (section) => section.course_id && !data.subjects.has(section.course_id)
  );
  add(
    unknownSubject.length === 0,
    "Every course matches a subject",
    unknownSubject.length > 0
      ? `${unknownSubject.length} section(s) use a course with no subject file: ${[
          ...new Set(unknownSubject.map((section) => section.course_id)),
        ].join(", ")}`
      : "Course ids match the subject files."
  );

  add(
    Boolean(data.settings.school_name && data.settings.term_label),
    "School name and term are set",
    data.settings.school_name && data.settings.term_label
      ? `${data.settings.school_name} · ${data.settings.term_label}`
      : "Set them in data/settings.csv so readers know what they are looking at."
  );

  add(
    !draftStale,
    "The draft is newer than the data",
    draftStale
      ? "Data changed after this draft was saved. Generate again so the published timetable matches the data."
      : "The draft was saved after the last data change."
  );

  if (locks.length > 0) {
    const dropped = lockCheck?.dropped ?? [];
    add(
      dropped.length === 0,
      "Every lock still fits",
      dropped.length > 0
        ? `${dropped.length} lock(s) will be ignored on the next generate: ${dropped
            .slice(0, 4)
            .map((lock) => lock.section_id)
            .join(", ")}`
        : `${locks.length} class(es) are locked.`
    );
  }

  add(
    Boolean(git?.isRepo),
    "This folder is a git repository",
    git?.isRepo
      ? `Branch ${git.branch || "(none yet)"}.`
      : "The files will still be written, but they cannot be committed or pushed from here."
  );

  add(
    Boolean(git?.remote),
    "A remote named origin is set",
    git?.remote || "Add one with: git remote add origin <your repository URL>"
  );

  if (git?.isRepo) {
    add(
      git.branch === "main",
      "You are on main",
      git.branch === "main"
        ? "GitHub Pages is set to deploy from main."
        : `You are on ${git.branch || "(no branch)"}. GitHub Pages deploys from main, so a push here will not update the site.`
    );
  }

  return {
    checks,
    blocked: false,
    warnings: checks.filter((check) => !check.ok).length,
    pagesUrl: git?.pagesUrl ?? "",
  };
}

/** The commands to run by hand if the automatic push cannot finish. */
export function manualCommands({ paths, message, branch }) {
  return [
    `git add -- ${paths.join(" ")}`,
    `git commit -m ${JSON.stringify(message)}`,
    `git push origin ${branch || "main"}`,
  ];
}

/**
 * Stage only the published files, commit them and push. Returns every step with
 * its output so the page can show exactly what happened.
 */
export async function gitPublish(dir, { paths, message, branch }) {
  const steps = [];

  const add = await git(dir, ["add", "--", ...paths]);
  steps.push({ command: `git add -- ${paths.join(" ")}`, ...add });
  if (!add.ok) return { ok: false, skipped: false, steps };

  const commit = await git(dir, ["commit", "-m", message]);
  const nothingToCommit = /nothing to commit|no changes added/i.test(commit.output);
  steps.push({
    command: `git commit -m ${JSON.stringify(message)}`,
    ok: commit.ok || nothingToCommit,
    output: commit.output || (nothingToCommit ? "Nothing to commit." : ""),
  });
  if (!commit.ok && !nothingToCommit) return { ok: false, skipped: false, steps };

  const push = await git(dir, ["push", "origin", branch || "main"]);
  steps.push({ command: `git push origin ${branch || "main"}`, ...push });

  return { ok: push.ok, skipped: false, steps };
}
