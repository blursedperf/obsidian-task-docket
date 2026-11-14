# Task Docket

Every checkbox task in your vault, in one list you can sort by urgency, due date, time or priority. Check tasks off, reschedule them and change their priority from the list; the change is written back to the task's own note.

## Why this suite exists

I created this suite of Obsidian plugins and the DoomEsque theme so that I can be 100 percent certain there are no network calls or traffic: everything runs 100 percent offline, so I can use Obsidian for my notes in open-book law exams.

- Nothing in the suite makes a network request. Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, ...).
- Obsidian itself has separate online features. For a fully offline setup, also turn off automatic updates, Sync and Publish, and don't browse community plugins during the exam.

The suite:

- [DoomEsque](https://github.com/blursedperf/obsidian-theme-doomesque) (theme)
- [DoomEsque Settings](https://github.com/blursedperf/obsidian-doomesque-settings)
- [Filetypes](https://github.com/blursedperf/obsidian-filetypes-plugin)
- [Inline Autocomplete](https://github.com/blursedperf/obsidian-inline-autocomplete)
- [Inline Schema Expander](https://github.com/blursedperf/obsidian-inline-schema-expander)
- [Links in New Tabs](https://github.com/blursedperf/obsidian-links-in-new-tabs)
- [Pomodoro Flashcards](https://github.com/blursedperf/obsidian-pomodoro-flashcards)
- **Task Docket**
- [Whole-Tree Search](https://github.com/blursedperf/obsidian-whole-tree-search)

## Writing tasks

A task is any checkbox list item, in any note:

```markdown
- [ ] Read [[Donoghue v Stevenson]] and brief the ratio 📅 2026-11-20 ⏫ #torts
- [ ] Tutorial problem question 📅 2026-11-14 14:00
- [ ] Moot submissions [due:: 2026-11-21T17:00] [priority:: highest]
- [x] Summarise Wagon Mound ✅ 2026-11-12
```

Task Docket reads both common formats, so tasks written for the Tasks or Dataview plugins work as they are:

| | Tasks plugin emoji | Dataview fields |
| --- | --- | --- |
| Due date | `📅 2026-11-20` | `[due:: 2026-11-20]` |
| Due time | `📅 2026-11-20 14:00` or `⏰ 14:00` | `[due:: 2026-11-20T14:00]` or `[time:: 14:00]` |
| Scheduled / start | `⏳ 2026-11-18` / `🛫 2026-11-17` | `[scheduled:: ...]` / `[start:: ...]` |
| Priority | `🔺` highest, `⏫` high, `🔼` medium, `🔽` low, `⏬` lowest | `[priority:: high]` |
| Completed | `✅ 2026-11-12` | `[completion:: 2026-11-12]` |

`[x]` is done, `[-]` cancelled and `[/]` in progress. Tasks inside code blocks and frontmatter are ignored.

### Setting dates and priorities as you type

On a checklist line, type `@` to set a due date, time or priority without leaving the keyboard:

| Type | Offers |
| --- | --- |
| `@` | Today, Tomorrow, In a week, Pick date and time…, and the priorities |
| `@tom`, `@fri`, `@mon` | That day (weekdays offer the next two) |
| `@fri 9am`, `@tomorrow 17:00` | That day at that time |
| `@17:00`, `@9:30pm` | Today or tomorrow at that time |
| `@3d`, `@2w`, `@2026-12-01` | In 3 days, in 2 weeks, a specific date |
| `@high`, `@low`, `@!` `@!!` `@!!!` | A priority (`!` medium, `!!` high, `!!!` highest) |

Choose with the arrow keys and Enter. The `@…` you typed is replaced by the date or priority, written at the end of the line in the format the line already uses, and the cursor stays at the end, ready for the next `@`. One undo reverts it. The suggestions only open at the start of a word on a checklist line, so e-mail addresses and ordinary text are left alone, and they do not interfere with Inline Autocomplete.

With the mouse or on a phone, right-click (or long-press) a checklist line for **Task due today**, **Task due tomorrow**, **Set task due date…**, **Clear task due date** and **Set task priority…**. The same actions are commands (**Set due date for task at cursor**, **Set priority for task at cursor**, **Clear due date for task at cursor**) that you can pin to the mobile toolbar.

## The docket

Open it from the ribbon (checklist icon), the **Task Docket: Open** command or the status bar. The ribbon button opens a menu showing how many tasks are overdue or due today, with **Open task docket**, **Add task…** and **Rescan tasks**.

- **Sort** by urgency, due date and time, priority or note. Urgency weighs how soon a task is due (overdue first, then today, tomorrow and the coming week) against its priority, and pushes down tasks scheduled or starting in the future.
- **Group** by due date (Overdue, Today, Tomorrow, Next 7 days, Later, No date), priority, note or tag, or not at all. Groups collapse.
- **Filter** by open, done or all tasks, and by text, `#tag` or note name. Click a tag to filter by it.
- **Check off** a task with its checkbox. Completing stamps today's date (optional); reopening removes it.
- **Reschedule and reprioritize** from the task menu (the `…` button, right-click or long-press): due today, tomorrow or in a week, pick a date and time, clear the date, or set any priority.
- **Open** a task's note at its line by clicking the task or its note chip (Ctrl/Cmd-click for a new tab).
- **Add a task** with the **Add task** button or command. It is written to your inbox note.

Edits change only the task's own line. Before writing, Task Docket checks that the line is still exactly what the list showed; if the note was edited in the meantime, nothing is changed and the list refreshes.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Inbox note | `Tasks.md` | Where new tasks are added (created if missing). |
| Excluded folders | none | Folders whose tasks are ignored, one per line. |
| Stamp the completion date | on | Add ✅ (or `[completion:: ]`) when checking off. |
| Date and priority format | Tasks emoji | Format for new dates and priorities; existing tasks keep theirs. |
| Default sort / grouping | Urgency / Due date | How the docket opens. |
| Open the docket in | A new tab | Or the right sidebar. |
| Show due counts in the status bar | on | Overdue and due-today counts (desktop). |
| Suggest dates and priorities while typing | on | The `@` suggestions on checklist lines. |
| Trigger character | `@` | What opens them (up to 3 characters, no spaces). |
| Task actions in the editor menu | on | Due date and priority items when right-clicking a checklist line. |

## Privacy & Security

- **Zero network activity.** No network requests, telemetry or remote content.
- **Offline audit.** Every test run checks the source, built bundle and styles for any network API, dynamic code or remote CSS.
- **Local only.** Tasks are read from your notes through Obsidian's own APIs. Only notes that contain tasks are read, and an edited note is re-read from the text Obsidian already has in memory.

## Installation

### Beta testing with BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian-42-brat) plugin.
2. Run **BRAT: Add a beta plugin for testing** and enter `blursedperf/obsidian-task-docket`.
3. Enable **Task Docket** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [GitHub release](https://github.com/blursedperf/obsidian-task-docket/releases).
2. Copy them to `<vault>/.obsidian/plugins/task-docket/`.
3. Reload Obsidian and enable **Task Docket** in **Settings → Community plugins**.

## Development

```bash
npm install
npm test        # unit tests and the offline audit
npm run build   # type-check and bundle main.js
```

## License

[MIT](LICENSE) © 2026 blursedperf
