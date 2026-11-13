/**
 * Urgency, sorting, grouping and filtering. Pure functions: "today" and "now" are passed in.
 */
import { PRIORITY_NAMES, Task } from "./task";

export type SortMode = "urgency" | "due" | "priority" | "note";
export type GroupMode = "when" | "priority" | "note" | "tag" | "none";
export type StatusFilter = "open" | "done" | "all";

const DAY = 86_400_000;

/** Whole days from `today` to `date` (both YYYY-MM-DD, local calendar days). */
export function daysBetween(today: string, date: string): number {
	const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
	const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
	return Math.round((b - a) / DAY);
}

/** YYYY-MM-DD for a local date. */
export function isoDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
	const d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
	d.setDate(d.getDate() + days);
	return isoDate(d);
}

/**
 * Urgency: how much a task needs attention now. Due date dominates (overdue > today > soon),
 * priority adjusts it, and a task scheduled or starting in the future is pushed down because it
 * cannot be acted on yet. Done and cancelled tasks score lowest.
 */
export function urgency(task: Task, today: string, nowMinutes: number): number {
	if (task.status === "done" || task.status === "cancelled") return -100;
	let score = 0;
	if (task.due) {
		const d = daysBetween(today, task.due);
		if (d < 0) score += 15 + Math.min(-d, 14) * 0.3; // overdue outranks anything due today except "highest"
		else if (d === 0) {
			score += 10;
			if (task.time) {
				const [h, m] = task.time.split(":").map(Number);
				const minutesLeft = h * 60 + m - nowMinutes;
				score += minutesLeft < 0 ? 1.5 : minutesLeft <= 120 ? 1 : 0.5;
			}
		} else if (d === 1) score += 8;
		else if (d <= 7) score += 8 - d * 0.6;
		else if (d <= 14) score += 3;
		else score += 1;
	}
	score += { 0: -3, 1: -1.5, 2: 0, 3: 2, 4: 4, 5: 6 }[task.priority];
	const notYet = [task.scheduled, task.start].some((d) => d && daysBetween(today, d) > 0);
	if (notYet) score -= 4;
	if (task.status === "in-progress") score += 1;
	return Math.round(score * 10) / 10;
}

const byNote = (a: Task, b: Task) => a.path.localeCompare(b.path) || a.line - b.line;
/** Sort key by due date then time; on the same day, tasks without a time (all day) come first. */
const dueKey = (t: Task) => (t.due ? `${t.due}T${t.time ?? ""}` : "9999");

export function sortTasks(tasks: Task[], mode: SortMode, today: string, nowMinutes: number): Task[] {
	const list = [...tasks];
	const scores = new Map(list.map((t) => [t, urgency(t, today, nowMinutes)]));
	const cmp: Record<SortMode, (a: Task, b: Task) => number> = {
		urgency: (a, b) => scores.get(b)! - scores.get(a)! || dueKey(a).localeCompare(dueKey(b)) || byNote(a, b),
		due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || b.priority - a.priority || byNote(a, b),
		priority: (a, b) => b.priority - a.priority || dueKey(a).localeCompare(dueKey(b)) || byNote(a, b),
		note: byNote,
	};
	return list.sort(cmp[mode]);
}

export interface TaskGroup {
	key: string;
	label: string;
	tasks: Task[];
	/** Emphasis for the heading: overdue groups are highlighted. */
	tone?: "overdue" | "today" | "done";
}

const WHEN_ORDER = ["overdue", "today", "tomorrow", "week", "later", "none", "done"];
const WHEN_LABEL: Record<string, string> = {
	overdue: "Overdue",
	today: "Today",
	tomorrow: "Tomorrow",
	week: "Next 7 days",
	later: "Later",
	none: "No date",
	done: "Done",
};

export function whenBucket(task: Task, today: string): string {
	if (task.status === "done" || task.status === "cancelled") return "done";
	if (!task.due) return "none";
	const d = daysBetween(today, task.due);
	if (d < 0) return "overdue";
	if (d === 0) return "today";
	if (d === 1) return "tomorrow";
	if (d <= 7) return "week";
	return "later";
}

/** Group an already-sorted list; groups keep the order of their first task except "when" and "priority". */
export function groupTasks(sorted: Task[], mode: GroupMode, today: string): TaskGroup[] {
	if (mode === "none") return [{ key: "all", label: "All tasks", tasks: sorted }];
	const groups = new Map<string, TaskGroup>();
	const add = (key: string, label: string, task: Task, tone?: TaskGroup["tone"]) => {
		let g = groups.get(key);
		if (!g) groups.set(key, (g = { key, label, tasks: [], tone }));
		g.tasks.push(task);
	};
	for (const t of sorted) {
		if (mode === "when") {
			const b = whenBucket(t, today);
			add(b, WHEN_LABEL[b], t, b === "overdue" ? "overdue" : b === "today" ? "today" : b === "done" ? "done" : undefined);
		} else if (mode === "priority") {
			add(String(5 - t.priority), PRIORITY_NAMES[t.priority][0].toUpperCase() + PRIORITY_NAMES[t.priority].slice(1), t);
		} else if (mode === "note") {
			add(t.path, t.path.replace(/\.md$/i, ""), t);
		} else {
			const tags = t.tags.length ? t.tags : [""];
			for (const tag of tags) add(tag || "~", tag ? `#${tag}` : "No tag", t);
		}
	}
	const list = [...groups.values()];
	if (mode === "when") list.sort((a, b) => WHEN_ORDER.indexOf(a.key) - WHEN_ORDER.indexOf(b.key));
	if (mode === "priority") list.sort((a, b) => a.key.localeCompare(b.key));
	if (mode === "tag") list.sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : a.key.localeCompare(b.key)));
	return list;
}

export function filterTasks(tasks: Task[], status: StatusFilter, query: string): Task[] {
	const q = query.trim().toLowerCase();
	const terms = q ? q.split(/\s+/) : [];
	return tasks.filter((t) => {
		const closed = t.status === "done" || t.status === "cancelled";
		if (status === "open" && closed) return false;
		if (status === "done" && !closed) return false;
		if (!terms.length) return true;
		const hay = `${t.text} ${t.tags.map((x) => "#" + x).join(" ")} ${t.path}`.toLowerCase();
		return terms.every((term) => hay.includes(term));
	});
}

/** Short human label for a due date relative to today. */
export function dueLabel(due: string, today: string): string {
	const d = daysBetween(today, due);
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	if (d === -1) return "Yesterday";
	if (d < 0) return `${-d} days overdue`;
	if (d < 7) {
		const date = new Date(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}
	return due;
}
