# Class Scheduler

A small local web app that builds a college timetable. It places course
sections into rooms and time slots while respecting room capacity, room clashes,
instructor clashes, course clashes, each professor's availability, and each
professor's section limit. It also tries to keep classes inside the hours each
professor prefers.

Everything runs on your own machine. There are **no dependencies** — no
`npm install`, no build step, no database. Your data lives in plain CSV files
in the `data/` folder, so you can always open it in a text editor.

---

## Quick start

1. Install [Node.js](https://nodejs.org) (this project was built on Node 26).
2. Open a terminal in this folder.
3. Run:

   ```powershell
   node server.js
   ```

4. Your browser opens at `http://127.0.0.1:8000/timetable`.
5. Press `Ctrl+C` in the terminal to stop the server.

If port 8000 is busy, the server tries the next port and prints the address it
actually used.

---

## The flow

The sidebar is the flow, in four numbered steps:

1. **Data** — add sections, professors, subjects, and rooms. Type them in, or
   import a CSV from a spreadsheet. Set the teaching grid (days and hours).
2. **Generate** — the solver runs in the server and takes up to ~5 seconds.
   Locked classes stay put; everything else is placed around them.
3. **Review** — save the result as a **draft**, inspect it, click classes to
   lock them, and regenerate. Named **versions** are checkpoints you can
   restore.
4. **Publish and share** — publish the draft: it writes `schedule.csv`, builds
   the static reader site (`index.html`, `schedule.html`, `assets/site.css`),
   commits those files and pushes. Readers need no login and no server.

A generated preview lives only in the server's memory. Press **Save as draft**
to write it to `data/drafts/current.csv`; nothing becomes visible to readers
until you press **Publish**. A bad run can never destroy a good timetable.

---

## Draft, publish, versions

The app keeps three states:

| State | Where it lives | Who sees it |
| --- | --- | --- |
| **Preview** | server memory | you, until you save or discard |
| **Draft** | `data/drafts/current.csv` | only you — the working copy |
| **Published** | `schedule.csv` | readers; this is the real timetable |

**Publishing** copies the draft to `schedule.csv`, saves a named snapshot, builds
the reader site and pushes it. A pre-flight checklist warns about unplaced
sections, deleted rooms, missing settings and git problems; warnings never stop
you. If the push cannot finish, the page shows the exact commands to run by
hand.

**Locking.** On the draft timetable, click a class (on the grid or in the table)
to pin it. Generate again: locked classes stay exactly where they are, and the
solver rebuilds everything else around them. Click again to unlock. Locks are
re-checked every time — if a room is deleted or a professor's availability
changes, a lock that no longer fits is dropped with the reason shown, rather
than forcing an impossible schedule.

**Versions** are named snapshots under `data/schedules/`. Publishing creates one
automatically. You can also save one at any time from the Versions page, and
restore it into the draft later. Restoring clears locks; the published
timetable is not touched until you publish again.

---

## What the solver guarantees

Hard constraints (it never breaks these):

| Constraint | Meaning |
| --- | --- |
| Room capacity | A section only goes into a room with at least as many seats |
| Room clash | Two sections cannot share a room at the same time |
| Instructor clash | One person cannot teach two sections at once |
| Course clash | Two sections of the same course cannot run at the same time |
| Availability | A section must fit inside its professor's available hours |
| Section limit | A professor never gets more than `max_sections` |

Soft preferences (it tries, but can't always succeed):

- Classes inside a professor's preferred days and hours.
- Earlier days and earlier start times.
- The smallest room that fits.

When a section cannot be placed, the preview explains the exact reason (no room
big enough, no free slot inside the availability window, the section limit, or
every remaining slot clashing with something else).

---

## Files

| File | Purpose |
| --- | --- |
| `server.js` | Starts the local web server and routes each page |
| `solver.js` | Greedy placement + local search, plus "why unplaced" answers |
| `pages.js` | All the HTML, including the timetable renderer |
| `data.js` | Reads and writes the CSV data |
| `csv.js` | CSV parsing and safe (atomic) file writing |
| `validate.js` | Rules that decide whether a form may be saved |
| `import.js` | Parsing, merging and diffing an imported CSV |
| `backup.js` | The one-file backup and its restore |
| `site.js` | Builds the static reader site (`index.html`, CSS) |
| `publish.js` | Pre-flight checks, git commands and the Pages address |
| `upload.js` | Reading a file out of a form |
| `test.js` | The checks behind `npm test` |
| `web/app.css` | Styling for the app shell |
| `data/` | Your data — this is the source of truth |
| `data/drafts/` | Private working draft and locks (not committed) |
| `data/schedules/` | Named snapshots and their index |
| `schedule.csv` | The published schedule |
| `index.html` | The published reader site |
| `schedule.html` | The same reader site, so old links keep working |
| `assets/site.css` | Styles for the reader site |

The app writes each CSV safely: a temporary file is written first, the previous
version is kept as `.bak`, and only then does it replace the original.

---

## The demo department

The repo ships with a realistic sample: 12 subjects, 25 professors, 12 rooms and
60 sections for a computing and mathematics department. It exists so the app and
the timetable are never empty, and so you can see what a real term looks like
before entering your own.

To use your own data, replace the rows in `data/sections.csv`, `data/rooms.csv`
and the files in `data/professors/` and `data/subjects/` — or delete the folders
and add everything through the app. The sample stays available in git history.

---

## Importing from a spreadsheet

**Import & backup → Import.** Choose what you are importing, then upload a CSV
or paste it. In Excel: *File → Save as → CSV*.

You will see a diff before anything is written:

| | Meaning |
| --- | --- |
| **New** | In your file, not on disk yet |
| **Changed** | In both, with different values — the page shows each field |
| **Unchanged** | Identical, nothing to do |
| **Not in your file** | On disk but missing from the file |

Then pick one:

- **Merge** updates what was in the file and keeps everything else. This is the
  normal choice — a file with just `section_id,instructor` reassigns teachers
  without touching anything else.
- **Replace** makes the file the whole list, deleting rows it does not mention.

Only the id column is required. Columns you leave out keep their current values
on a merge, so partial files are the easy path. An import that would produce a
broken file — a missing course id, a duplicate id, an unknown day — is refused
as a whole, with the line number. Nothing is ever half-written.

---

## Backups

**Import & backup → Backups.** *Download backup* writes one JSON file holding
every CSV in `data/` (sections, rooms, grid, settings, one entry per professor
and subject, plus the draft and any saved versions).

Restoring is also two steps: choose the file, see which files would be changed,
added or removed, then confirm. A restore deletes data files that are not in the
backup, because that is what "restore" means — they are listed before you
confirm. Each file keeps a `.bak` copy of its previous version either way.

The zero-tech option still works: copy the whole `data` folder somewhere safe.

---

## Tests

```powershell
npm test
```

Twenty-one checks, no framework: the data folder is complete, every section
points at a real professor and subject, the solver places all 60 sections
without breaking a hard constraint, a locked section stays pinned, the forms
refuse broken input, CSV survives commas and quotes, an import changes nothing
until it is applied, a backup restores exactly what it captured, a version
round-trips through its index, the reader site is static and complete, the
pre-flight checklist blocks only a missing draft, and every page answers. It
never writes to the repo, so it is safe to run at any time.

---

## Data files

Every save rewrites these files. You can also edit them by hand.

### `data/grid.csv`

| Column | Example | Meaning |
| --- | --- | --- |
| `first_day` | `Mon` | First teaching day |
| `last_day` | `Sat` | Last teaching day |
| `start` | `07:00` | Earliest start |
| `end` | `21:00` | Latest end |
| `slot_minutes` | `30` | How finely starts are spaced |

### `data/rooms.csv`

| Column | Example |
| --- | --- |
| `room_id` | `R101` |
| `room_name` | `Room 101` |
| `building` | `Main Building` |
| `capacity` | `30` |

### `data/sections.csv`

One row per class meeting.

| Column | Example | Notes |
| --- | --- | --- |
| `section_id` | `CS101-L1` | Unique |
| `course_id` | `CS101` | Matches a subject file |
| `course_name` | `Introduction to Programming` | Shown on the timetable |
| `instructor` | `Dr. Amara Okafor` | Matches a professor's `name` |
| `capacity_needed` | `30` | Blank = subject default, then any room |
| `duration_minutes` | `90` | Blank = subject default |
| `allowed_days` | `Mon,Wed,Fri` | Blank = any day in the grid |

### `data/professors/<id>.csv` (one file per professor)

| Column | Example | Notes |
| --- | --- | --- |
| `professor_id` | `P101` | Also the file name |
| `name` | `Dr. Amara Okafor` | Sections match on this exact text |
| `preferred_days` | `Mon,Wed,Fri` | Soft preference |
| `preferred_start` | `08:00` | Soft preference |
| `preferred_end` | `16:00` | Soft preference |
| `availability_start` | `07:00` | Hard limit |
| `availability_end` | `20:00` | Hard limit |
| `max_sections` | `4` | Hard limit; blank = no limit |

### `data/subjects/<id>.csv` (one file per subject)

| Column | Example | Notes |
| --- | --- | --- |
| `subject_id` | `CS101` | Matches a section's `course_id` |
| `course_name` | `Introduction to Programming` | Shown on the timetable |
| `default_duration_minutes` | `90` | Used when a section leaves duration blank |
| `default_capacity` | `30` | Used when a section leaves capacity blank |

### `data/settings.csv`

One row: what the published timetable says about itself.

| Column | Example | Meaning |
| --- | --- | --- |
| `school_name` | `Northgate College` | Shown in the heading |
| `term_label` | `Fall 2026` | Shown next to the school name |
| `term_start` | `2026-09-07` | Term dates, for reference |
| `term_end` | `2026-12-18` | Term dates, for reference |

---

## Command line flags

```powershell
node server.js                    # 127.0.0.1:8000, opens the browser
node server.js --port 9000        # start on another port
node server.js --no-browser       # do not open the browser
node server.js --budget 10000     # give the solver 10 seconds per generate
node server.js --data data-demo   # use another data folder (see below)
node server.js --lan              # listen on 0.0.0.0 (other devices on your network)
```

`--data <folder>` points the app at a different data folder and keeps the
schedule it produces **inside that folder**, so a demo run can never overwrite
your real `schedule.csv`. Copy `data/` somewhere, run with `--data`, and the two
sets stay independent.

`--lan` exposes the app to your local network. It has no login, so only use it
on a network you trust.

---

## How the solver works

1. **Greedy**: sort sections by the hardest to place (most seats, then longest),
   and give each one the cheapest feasible slot. For each section it keeps only
   the few smallest rooms that fit — rooms are interchangeable apart from
   capacity.
2. **Local search**: move one section at a time to a different slot while that
   reduces the number of clashes.
3. **Restarts**: repeat with different random tie-breaks and keep the best
   result.

A time budget (5 seconds by default) keeps the page responsive. On a synthetic
test with 150 sections and 60 rooms it places every section in about 0.3
seconds with zero clashes.

---

## Troubleshooting

**The page does not load.** Check the terminal where you ran `node server.js`.
If it printed a different port, use that address.

**My change did not appear.** Every page reads the CSV files fresh, so a browser
refresh is enough. If you edited a CSV by hand, make sure the file is still
valid CSV.

**I want the previous version of a file.** The app keeps a `.bak` copy next to
each file it writes (for example `data/sections.csv.bak`).

**A professor's classes are outside their preferred hours.** That is allowed —
preferences are soft. The professor view flags them in amber. The usual cause is
`allowed_days` or the availability window leaving no better option.

**A section is never placed.** Open the preview: the "Not placed" table gives the
reason for each one.

---

## Publishing the reader site

**Publish** (step 4) does four things:

1. Writes `schedule.csv` — the published timetable.
2. Saves a snapshot under `data/schedules/` and marks it current.
3. Writes the reader site: `index.html`, `schedule.html` (the same page, so old
   links keep working) and `assets/site.css`.
4. Stages only those files, commits them, and pushes `main`.

The reader site is plain HTML and CSS: the timetable grid, all classes, a view
by professor and a view by room. It has no login, no scripts and no server, so
it works on GitHub Pages, on a USB stick, or by double-clicking.

### Pre-flight checklist

Before publishing, the page checks the things that usually cause a bad publish:

- every section in the data is in the draft;
- every class and room in the draft still exists;
- instructors and course ids point at real files;
- school name and term are set;
- the draft is newer than the data;
- every lock still fits;
- the folder is a git repository with an `origin` remote, on `main`.

Only a missing draft blocks. Everything else is a warning, because the registrar
may know something the app does not. The page also tells you how many classes
would be published and how many are missing.

### Git and GitHub Pages

Publishing needs a git repository with a remote named `origin`, and credentials
that work without prompting. The page shows every command and its output. If
the push cannot finish, run the three commands shown on the page by hand:

```powershell
git add -- schedule.csv index.html schedule.html assets data/schedules
git commit -m "Publish Fall 2026 — 2026-09-01"
git push origin main
```

GitHub Pages only needs to be enabled once: repository **Settings → Pages →
Deploy from branch → `main` / root**. After that the site is at:

```
https://<your-username>.github.io/<repository>/
```

`schedule.html` keeps working, so links you shared before still open the
timetable.

### Reader site without git

**Reader site** (also step 4) rebuilds `index.html`, `schedule.html` and
`assets/site.css` from the published schedule without committing or pushing.
Useful for checking the result locally, or copying the files to a USB stick.

---

## Project history

The first version of the solver was written in Python with a compiled
TypeScript front end. It was rewritten in JavaScript so the whole project —
solver, server and pages — uses one language and runs with nothing but Node.js.
