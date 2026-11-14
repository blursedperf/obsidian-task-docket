/**
 * Task lines: parsing and editing. Pure functions with no Obsidian dependency.
 *
 * A task is a list item with a checkbox: `- [ ] text`, `* [x] text`, `1. [ ] text`.
 * Metadata is read in two widely used formats and written in the one the user chooses:
 *
 *   Tasks plugin emoji   📅 2026-11-20  ⏳ scheduled  🛫 start  ✅ done  ❌ cancelled  ➕ created
 *                        priority 🔺 highest  ⏫ high  🔼 medium  🔽 low  ⏬ lowest
 *   Dataview fields      [due:: 2026-11-20]  [priority:: high]  (also round brackets)
 *
 * A time can follow the due date (📅 2026-11-20 14:30, [due:: 2026-11-20T14:30]) or stand alone
 * (⏰ 14:30, [time:: 14:30]).
 */

export type TaskStatus = "open" | "done" | "cancelled" | "in-progress";

/** 0 lowest, 1 low, 2 normal (no marker), 3 medium, 4 high, 5 highest. */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export const PRIORITY_NAMES: Record<Priority, string> = {
	0: "lowest",
	1: "low",
	2: "normal",
	3: "medium",
	4: "high",
	5: "highest",
};

export type MetadataFormat = "emoji" | "dataview";

export interface Task {
	/** Vault path of the note. */
	path: string;
	/** 0-based line number in the note. */
	line: number;
	/** The full source line, used to confirm the line has not changed before editing it. */
	raw: string;
	/** Character inside the brackets. */
	mark: string;
	status: TaskStatus;
	/** Task text with recognised metadata removed. */
	text: string;
	/** YYYY-MM-DD */
	due?: string;
	/** HH:MM (24-hour) */
	time?: string;
	scheduled?: string;
	start?: string;
	doneDate?: string;
	priority: Priority;
	tags: string[];
	/** Leading whitespace width, for nesting. */
	indent: number;
}

const TASK_LINE = /^(\s*)((?:[-*+])|(?:\d+[.)]))\s+\[(.)\]\s?(.*)$/;
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const TIME = "(\\d{1,2}:\\d{2})";

const EMOJI_DATES: Record<string, keyof Task> = {
	"📅": "due",
	"🗓️": "due",
	"🗓": "due",
	"⏳": "scheduled",
	"🛫": "start",
	"✅": "doneDate",
};
const EMOJI_OTHER_DATES = ["❌", "➕"];
const EMOJI_PRIORITY: Record<string, Priority> = { "🔺": 5, "⏫": 4, "🔼": 3, "🔽": 1, "⏬": 0 };
const FIELD_PRIORITY: Record<string, Priority> = {
	highest: 5,
	urgent: 5,
	high: 4,
	medium: 3,
	normal: 2,
	none: 2,
	low: 1,
	lowest: 0,
};

const FIELD = /[[(]\s*([A-Za-z][\w-]*)\s*::\s*([^\])]*?)\s*[\])]/g;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

function normaliseTime(t: string): string {
	const [h, m] = t.split(":");
	return `${h.padStart(2, "0")}:${m}`;
}

export function statusFor(mark: string): TaskStatus {
	if (mark === "x" || mark === "X") return "done";
	if (mark === "-") return "cancelled";
	if (mark === "/") return "in-progress";
	return "open";
}

/** Parse one line; returns null when it is not a task. */
export function parseTaskLine(raw: string, path: string, line: number): Task | null {
	const m = raw.match(TASK_LINE);
	if (!m) return null;
	const [, ws, , mark, body] = m;
	const task: Task = {
		path,
		line,
		raw,
		mark,
		status: statusFor(mark),
		text: "",
		priority: 2,
		tags: [],
		indent: ws.replace(/\t/g, "    ").length,
	};

	let text = body;

	// Dataview-style fields
	text = text.replace(FIELD, (whole, key: string, value: string) => {
		const k = key.toLowerCase();
		const v = value.trim();
		if (k === "due" || k === "scheduled" || k === "start" || k === "completion" || k === "done") {
			const dm = v.match(new RegExp(`^${DATE}(?:[T ]${TIME})?$`));
			if (!dm) return whole;
			const field = k === "completion" || k === "done" ? "doneDate" : k;
			(task as unknown as Record<string, string>)[field] = dm[1];
			if (k === "due" && dm[2]) task.time = normaliseTime(dm[2]);
			return " ";
		}
		if (k === "time") {
			const tm = v.match(new RegExp(`^${TIME}$`));
			if (!tm) return whole;
			task.time = normaliseTime(tm[1]);
			return " ";
		}
		if (k === "priority") {
			const p = FIELD_PRIORITY[v.toLowerCase()];
			if (p === undefined) return whole;
			task.priority = p;
			return " ";
		}
		return whole;
	});

	// Emoji dates (the due date may carry a time)
	for (const [emoji, field] of Object.entries(EMOJI_DATES)) {
		const re = new RegExp(`${emoji}\\uFE0F?\\s*${DATE}${field === "due" ? `(?:[ T]${TIME})?` : ""}`, "u");
		text = text.replace(re, (_w, date: string, time?: string) => {
			(task as unknown as Record<string, string>)[field] = date;
			if (field === "due" && time) task.time = normaliseTime(time);
			return " ";
		});
	}
	for (const emoji of EMOJI_OTHER_DATES) {
		text = text.replace(new RegExp(`${emoji}\\uFE0F?\\s*${DATE}`, "u"), " ");
	}
	text = text.replace(new RegExp(`⏰\\uFE0F?\\s*${TIME}`, "u"), (_w, time: string) => {
		task.time = normaliseTime(time);
		return " ";
	});
	for (const [emoji, p] of Object.entries(EMOJI_PRIORITY)) {
		if (text.includes(emoji)) {
			task.priority = p;
			text = text.split(emoji).join(" ");
		}
	}

	for (const t of text.matchAll(TAG)) task.tags.push(t[2]);
	task.text = text.replace(/\s+/g, " ").trim();
	return task;
}

/** All tasks in a note, skipping frontmatter and fenced code blocks. */
export function parseTasks(content: string, path: string): Task[] {
	const lines = content.split(/\r?\n/);
	const tasks: Task[] = [];
	let i = 0;
	if (lines[0]?.trim() === "---") {
		for (i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---" || lines[i].trim() === "...") {
				i++;
				break;
			}
		}
		if (i >= lines.length) i = 0; // unterminated: treat as content
	}
	let fence: string | null = null;
	for (; i < lines.length; i++) {
		const line = lines[i];
		const fm = line.match(/^\s*(`{3,}|~{3,})/);
		if (fm) {
			if (fence === null) fence = fm[1];
			else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
			continue;
		}
		if (fence !== null) continue;
		const task = parseTaskLine(line, path, i);
		if (task) tasks.push(task);
	}
	return tasks;
}

/* ---------- editing ---------- */

const TASK_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s?)/;

function setMark(raw: string, mark: string): string {
	return raw.replace(TASK_PREFIX, (_w, a: string, _m: string, b: string) => a + mark + b);
}

function removeEmojiDate(raw: string, emoji: string): string {
	return raw.replace(new RegExp(`\\s*${emoji}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, "u"), "");
}

function removeField(raw: string, key: string): string {
	return raw.replace(new RegExp(`\\s*[[(]\\s*${key}\\s*::[^\\])]*[\\])]`, "i"), "");
}

/** Check off or reopen a task. Completing can stamp today's date (✅ or [completion:: ]). */
export function toggleTaskLine(raw: string, today: string, stampDone: boolean, format: MetadataFormat): string {
	const m = raw.match(TASK_PREFIX);
	if (!m) return raw;
	const done = statusFor(m[2]) === "done";
	let out = setMark(raw, done ? " " : "x");
	if (done) {
		out = removeField(removeEmojiDate(out, "✅"), "completion");
	} else if (stampDone) {
		out = out.replace(/\s+$/, "") + (format === "dataview" ? ` [completion:: ${today}]` : ` ✅ ${today}`);
	}
	return out;
}

const EMOJI_METADATA = /[📅🗓⏳🛫✅❌➕⏰🔺⏫🔼🔽⏬]/u;
const FIELD_METADATA = /[[(]\s*(?:due|time|priority|scheduled|start|completion|created|cancelled)\s*::/i;

/** The format a line already uses for its metadata; the setting decides only for a bare line. */
export function lineFormat(raw: string, fallback: MetadataFormat): MetadataFormat {
	const emoji = EMOJI_METADATA.test(raw);
	const field = FIELD_METADATA.test(raw);
	if (emoji !== field) return emoji ? "emoji" : "dataview";
	return fallback;
}

/** Set or clear the due date (and optionally its time), keeping the line's existing format. */
export function setDueLine(raw: string, date: string | null, time: string | null, format: MetadataFormat): string {
	const usesField = /[[(]\s*due\s*::/i.test(raw) || (!/📅|🗓/u.test(raw) && lineFormat(raw, format) === "dataview");
	let out = raw.replace(/\s*(?:📅|🗓️?)️?\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?/u, "");
	out = removeField(out, "due");
	out = out.replace(/\s*⏰️?\s*\d{1,2}:\d{2}/u, "");
	out = removeField(out, "time");
	out = out.replace(/\s+$/, "");
	if (!date) return out;
	if (usesField) return `${out} [due:: ${date}${time ? `T${time}` : ""}]`;
	return `${out} 📅 ${date}${time ? ` ⏰ ${time}` : ""}`;
}

/** Set the priority, keeping the line's existing format. */
export function setPriorityLine(raw: string, priority: Priority, format: MetadataFormat): string {
	const usesField = /[[(]\s*priority\s*::/i.test(raw) || (!/[🔺⏫🔼🔽⏬]/u.test(raw) && lineFormat(raw, format) === "dataview");
	let out = raw.replace(/\s*[🔺⏫🔼🔽⏬]/gu, "");
	out = removeField(out, "priority").replace(/\s+$/, "");
	if (priority === 2) return out;
	if (usesField) return `${out} [priority:: ${PRIORITY_NAMES[priority]}]`;
	const emoji = Object.entries(EMOJI_PRIORITY).find(([, p]) => p === priority)?.[0] ?? "";
	return `${out} ${emoji}`;
}

/** A new task line from parts, in the chosen format. */
export function buildTaskLine(
	text: string,
	opts: { due?: string; time?: string; priority?: Priority },
	format: MetadataFormat
): string {
	let line = `- [ ] ${text.trim()}`;
	if (opts.priority !== undefined && opts.priority !== 2) line = setPriorityLine(line, opts.priority, format);
	if (opts.due) line = setDueLine(line, opts.due, opts.time ?? null, format);
	else if (opts.time) line += format === "dataview" ? ` [time:: ${opts.time}]` : ` ⏰ ${opts.time}`;
	return line;
}
