/**
 * Inline task properties: what follows the trigger character (default "@") on a task line, turned
 * into due dates, times and priorities. Pure functions with no Obsidian dependency; "today" is
 * passed in.
 *
 *   @            Today, Tomorrow, In a week, Pick date and time…, the priorities
 *   @fri         the next two Fridays
 *   @tom 9am     tomorrow at 09:00          @17:00   today at 17:00
 *   @3d  @2w     in 3 days / in 2 weeks     @2026-11-20
 *   @high  @!!   priority (! medium, !! high, !!! highest)
 */
import { addDays, daysBetween } from "./arrange";
import { PRIORITY_NAMES, Priority } from "./task";

export type InlineChoice =
	| { kind: "due"; date: string; time: string | null; label: string; detail: string }
	| { kind: "priority"; priority: Priority; label: string }
	| { kind: "pick"; label: string }
	| { kind: "clear"; label: string };

/** A list item with a checkbox, up to and including the space after "]". */
const TASK_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PRIORITY_ORDER: Priority[] = [5, 4, 3, 2, 1, 0];
const BANGS: Record<string, Priority> = { "!": 3, "!!": 4, "!!!": 5 };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A usable trigger: the setting trimmed, without whitespace, at most 3 characters; "@" otherwise. */
export function normaliseTrigger(raw: string): string {
	const t = raw.trim();
	return t && !/\s/.test(t) && t.length <= 3 ? t : "@";
}

/**
 * Find the trigger and its query in the text before the cursor. The trigger must start a word on a
 * task line (so e-mail addresses and "a@b" never trigger), and the query is at most two words.
 * Returns the trigger's column and the query.
 */
export function findTrigger(lineBefore: string, trigger: string): { start: number; query: string } | null {
	const prefix = lineBefore.match(TASK_PREFIX);
	if (!prefix) return null;
	const m = lineBefore.match(new RegExp(`(?:^|\\s)${escapeRegExp(trigger)}(\\S*(?: \\S*)?)$`));
	if (!m || m.index === undefined) return null;
	const query = m[1];
	if (query.includes(trigger)) return null;
	const start = lineBefore.length - query.length - trigger.length;
	if (start < prefix[0].length) return null;
	return { start, query };
}

/** "9am", "9:30pm", "17:00" → HH:MM. A bare number is not a time (it could be anything). */
export function parseTime(token: string): string | null {
	const m = token.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/);
	if (!m || (!m[2] && !m[3])) return null;
	let h = Number(m[1]);
	const min = m[2] ? Number(m[2]) : 0;
	if (min > 59) return null;
	if (m[3]) {
		if (h < 1 || h > 12) return null;
		h = (h % 12) + (m[3].startsWith("p") ? 12 : 0);
	} else if (h > 23) return null;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Could this still become a time as the user keeps typing? ("9", "9:", "9:3", "9p") */
function isPartialTime(token: string): boolean {
	return /^\d{1,2}(?::\d{0,2})?(?:a|am|p|pm)?$/.test(token);
}

function weekdayOf(date: string): number {
	return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)).getDay();
}

function isRealDate(date: string): boolean {
	const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
	return d.getMonth() === +date.slice(5, 7) - 1 && d.getDate() === +date.slice(8, 10);
}

/** Human label for a date relative to today. */
export function relativeLabel(date: string, today: string): string {
	const d = daysBetween(today, date);
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	const day = capitalise(WEEKDAYS[weekdayOf(date)]);
	if (d > 1 && d < 7) return day;
	if (d >= 7 && d < 14) return `${day} next week`;
	return day;
}

/** Dates a single word can mean. */
export function dateOptions(token: string, today: string): { date: string; label: string }[] {
	const t = token.toLowerCase();
	if (!t) return [];
	const out: { date: string; label: string }[] = [];
	const add = (date: string, label = relativeLabel(date, today)) => {
		if (!out.some((o) => o.date === date)) out.push({ date, label });
	};
	if ("today".startsWith(t)) add(today);
	if ("tomorrow".startsWith(t)) add(addDays(today, 1));
	if (t.length >= 2 && ("week".startsWith(t) || "nextweek".startsWith(t))) add(addDays(today, 7), "In a week");
	WEEKDAYS.forEach((name, wd) => {
		if (!name.startsWith(t)) return;
		const ahead = ((wd - weekdayOf(today) + 7) % 7) || 7;
		add(addDays(today, ahead));
		add(addDays(today, ahead + 7));
	});
	const rel = t.match(/^\+?(\d{1,3})([dw])$/);
	if (rel) {
		const n = Number(rel[1]) * (rel[2] === "w" ? 7 : 1);
		add(addDays(today, n), `In ${rel[1]} ${rel[2] === "w" ? "week" : "day"}${rel[1] === "1" ? "" : "s"}`);
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(t) && isRealDate(t)) add(t);
	return out;
}

/** Priorities a single word can mean ("hi" → high, highest; "!!" → high). */
export function priorityOptions(token: string): Priority[] {
	const t = token.toLowerCase();
	if (!t) return [];
	if (t in BANGS) return [BANGS[t]];
	if ("urgent".startsWith(t) && t.length >= 2) return [5];
	return PRIORITY_ORDER.filter((p) => PRIORITY_NAMES[p].startsWith(t) || (p === 2 && t.length >= 2 && "none".startsWith(t)));
}

function due(date: string, time: string | null, label: string): InlineChoice {
	return { kind: "due", date, time, label: time ? `${label} at ${time}` : label, detail: time ? `${date} ${time}` : date };
}

function priority(p: Priority): InlineChoice {
	return { kind: "priority", priority: p, label: p === 2 ? "Normal priority (no marker)" : `${capitalise(PRIORITY_NAMES[p])} priority` };
}

/** The choices for a query. An empty list means the popup should not show. */
export function inlineChoices(query: string, today: string, opts: { hasDue: boolean } = { hasDue: false }): InlineChoice[] {
	const [first = "", second] = query.toLowerCase().split(" ");
	const out: InlineChoice[] = [];

	if (second === undefined) {
		if (!first) {
			out.push(due(today, null, "Today"), due(addDays(today, 1), null, "Tomorrow"), due(addDays(today, 7), null, "In a week"));
			out.push({ kind: "pick", label: "Pick date and time…" });
			if (opts.hasDue) out.push({ kind: "clear", label: "Clear due date" });
			for (const p of [5, 4, 3, 1, 0] as Priority[]) out.push(priority(p));
			return out;
		}
		for (const d of dateOptions(first, today)) out.push(due(d.date, null, d.label));
		const time = parseTime(first);
		if (time) out.push(due(today, time, "Today"), due(addDays(today, 1), time, "Tomorrow"));
		for (const p of priorityOptions(first)) out.push(priority(p));
		if (first.length >= 2 && ("pick".startsWith(first) || "date".startsWith(first))) out.push({ kind: "pick", label: "Pick date and time…" });
		if (opts.hasDue && first.length >= 2 && "clear".startsWith(first)) out.push({ kind: "clear", label: "Clear due date" });
		return out;
	}

	// Two words: a date, then a time (complete, or still being typed).
	const dates = dateOptions(first, today);
	if (!dates.length) return [];
	const time = second ? parseTime(second) : null;
	if (second && !time && !isPartialTime(second)) return [];
	return dates.map((d) => due(d.date, time, d.label));
}

/** Remove the typed trigger and query (columns start..end) and the space left before it at line end. */
export function removeTrigger(raw: string, start: number, end: number): string {
	const before = raw.slice(0, start);
	const after = raw.slice(end);
	return after.trim() ? before + after.replace(/^\s+/, "") : before.replace(/\s+$/, "");
}
