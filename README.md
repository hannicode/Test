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

1. **Data** — add sections, professors, subjects, and rooms. Set the teaching
   grid (days and hours).
2. **Generate** — the solver runs in the server and takes up to ~5 seconds.
3. **Review** — inspect the result. The preview shows what could not be placed
   and why. Open any professor to see their personal schedule.
4. **Export** — write `schedule.html`, a single self-contained file you can
   double-click, email, or publish.

Nothing is written to `schedule.csv` until you press **Save schedule** on the
preview. A bad run can never destroy a good schedule.

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
| `web/app.css` | Styling for the app shell |
| `data/` | Your data — this is the source of truth |
| `schedule.csv` | The saved schedule |
| `schedule.html` | The exported, shareable timetable |

The app writes each CSV safely: a temporary file is written first, the previous
version is kept as `.bak`, and only then does it replace the original.

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
| `section_id` | `S101-L1` | Unique |
| `course_id` | `CS101` | Matches a subject file |
| `course_name` | `Intro to Computing` | Shown on the timetable |
| `instructor` | `Dr. Lee` | Matches a professor's `name` |
| `capacity_needed` | `30` | Blank = subject default, then any room |
| `duration_minutes` | `90` | Blank = subject default |
| `allowed_days` | `Mon,Wed,Fri` | Blank = any day in the grid |

### `data/professors/<id>.csv` (one file per professor)

| Column | Example | Notes |
| --- | --- | --- |
| `professor_id` | `P101` | Also the file name |
| `name` | `Dr. Lee` | Sections match on this exact text |
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
| `course_name` | `Intro to Computing` | Shown on the timetable |
| `default_duration_minutes` | `90` | Used when a section leaves duration blank |
| `default_capacity` | `30` | Used when a section leaves capacity blank |

---

## Command line flags

```powershell
node server.js                    # 127.0.0.1:8000, opens the browser
node server.js --port 9000        # start on another port
node server.js --no-browser       # do not open the browser
node server.js --budget 10000     # give the solver 10 seconds per generate
node server.js --lan              # listen on 0.0.0.0 (other devices on your network)
```

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

## Publishing the timetable

`schedule.html` is fully self-contained (styles inline, no scripts). To put it
online with GitHub Pages, commit it and enable Pages for your repository
(Settings → Pages → Deploy from branch → `main` / root). The file is then
available at:

```
https://<your-username>.github.io/<repository>/schedule.html
```

---

## Project history

The first version of the solver was written in Python with a compiled
TypeScript front end. It was rewritten in JavaScript so the whole project —
solver, server and pages — uses one language and runs with nothing but Node.js.
