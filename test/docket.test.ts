import * as assert from "assert";
import {
	buildTaskLine,
	parseTaskLine,
	parseTasks,
	setDueLine,
	setPriorityLine,
	toggleTaskLine,
} from "../src/task";
import { addDays, dueLabel, filterTasks, groupTasks, sortTasks, urgency, whenBucket } from "../src/arrange";

const T = (raw: string, line = 0) => {
	const t = parseTaskLine(raw, "Notes/Torts.md", line);
	assert.ok(t, `not a task: ${raw}`);
	return t!;
};

// 1. Parsing: statuses and list markers
{
	assert.strictEqual(parseTaskLine("- not a task", "a.md", 0), null);
	assert.strictEqual(parseTaskLine("[ ] bracket without a list marker", "a.md", 0), null);
	assert.strictEqual(T("- [ ] open").status, "open");
	assert.strictEqual(T("* [x] done").status, "done");
	assert.strictEqual(T("+ [X] done").status, "done");
	assert.strictEqual(T("1. [-] cancelled").status, "cancelled");
	assert.strictEqual(T("2) [/] in progress").status, "in-progress");
	assert.strictEqual(T("\t\t- [ ] nested").indent, 8);
}

// 2. Tasks plugin emoji metadata
{
	const t = T("- [ ] Read Donoghue v Stevenson 📅 2026-11-20 ⏳ 2026-11-18 🛫 2026-11-17 ⏫ #torts #reading");
	assert.strictEqual(t.due, "2026-11-20");
	assert.strictEqual(t.scheduled, "2026-11-18");
	assert.strictEqual(t.start, "2026-11-17");
	assert.strictEqual(t.priority, 4);
	assert.deepStrictEqual(t.tags, ["torts", "reading"]);
	assert.strictEqual(t.text, "Read Donoghue v Stevenson #torts #reading");

	const timed = T("- [ ] Tutorial 📅 2026-11-20 14:30 🔺");
	assert.strictEqual(timed.time, "14:30");
	assert.strictEqual(timed.priority, 5);
	assert.strictEqual(T("- [ ] Call ⏰ 9:05").time, "09:05");
	const done = T("- [x] Essay ✅ 2026-11-12 ➕ 2026-11-01");
	assert.strictEqual(done.doneDate, "2026-11-12");
	assert.strictEqual(done.text, "Essay");
}

// 3. Dataview fields
{
	const t = T("- [ ] Moot prep [due:: 2026-11-21T09:30] [priority:: high] (scheduled:: 2026-11-19) [court:: HCA]");
	assert.strictEqual(t.due, "2026-11-21");
	assert.strictEqual(t.time, "09:30");
	assert.strictEqual(t.priority, 4);
	assert.strictEqual(t.scheduled, "2026-11-19");
	assert.strictEqual(t.text, "Moot prep [court:: HCA]", "unknown fields stay in the text");
	assert.strictEqual(T("- [ ] x [time:: 7:00]").time, "07:00");
	assert.strictEqual(T("- [ ] x [priority:: banana]").priority, 2);
}

// 4. Whole notes: frontmatter and code blocks are skipped
{
	const md = ["---", "tags: [x]", "---", "- [ ] one", "```", "- [ ] in code", "```", "text", "\t- [x] two", "~~~~", "- [ ] tilde code", "~~~~", "- [ ] three"].join("\n");
	assert.deepStrictEqual(parseTasks(md, "a.md").map((t) => [t.line, t.text]), [[3, "one"], [8, "two"], [12, "three"]]);
}

// 5. Editing lines
{
	const today = "2026-11-13";
	assert.strictEqual(toggleTaskLine("- [ ] Read 📅 2026-11-20", today, true, "emoji"), "- [x] Read 📅 2026-11-20 ✅ 2026-11-13");
	assert.strictEqual(toggleTaskLine("- [x] Read 📅 2026-11-20 ✅ 2026-11-13", today, true, "emoji"), "- [ ] Read 📅 2026-11-20");
	assert.strictEqual(toggleTaskLine("- [ ] Read", today, true, "dataview"), "- [x] Read [completion:: 2026-11-13]");
	assert.strictEqual(toggleTaskLine("- [x] Read [completion:: 2026-11-13]", today, true, "dataview"), "- [ ] Read");
	assert.strictEqual(toggleTaskLine("\t1. [ ] Indented", today, false, "emoji"), "\t1. [x] Indented");

	assert.strictEqual(setDueLine("- [ ] A 📅 2026-11-20 ⏫", "2026-11-25", null, "emoji"), "- [ ] A ⏫ 📅 2026-11-25");
	assert.strictEqual(setDueLine("- [ ] A 📅 2026-11-20 14:00", "2026-11-25", "09:00", "emoji"), "- [ ] A 📅 2026-11-25 ⏰ 09:00");
	assert.strictEqual(setDueLine("- [ ] A [due:: 2026-11-20]", "2026-11-25", "09:00", "emoji"), "- [ ] A [due:: 2026-11-25T09:00]");
	assert.strictEqual(setDueLine("- [ ] A", "2026-11-25", null, "dataview"), "- [ ] A [due:: 2026-11-25]");
	assert.strictEqual(setDueLine("- [ ] A 📅 2026-11-20 ⏰ 14:00", null, null, "emoji"), "- [ ] A");

	assert.strictEqual(setPriorityLine("- [ ] A ⏫ 📅 2026-11-20", 1, "emoji"), "- [ ] A 📅 2026-11-20 🔽");
	assert.strictEqual(setPriorityLine("- [ ] A [priority:: high]", 5, "emoji"), "- [ ] A [priority:: highest]");
	assert.strictEqual(setPriorityLine("- [ ] A 🔺", 2, "emoji"), "- [ ] A");

	assert.strictEqual(buildTaskLine("Brief Mabo", { due: "2026-11-20", time: "10:00", priority: 4 }, "emoji"), "- [ ] Brief Mabo ⏫ 📅 2026-11-20 ⏰ 10:00");
	assert.strictEqual(buildTaskLine("Brief Mabo", { priority: 3 }, "dataview"), "- [ ] Brief Mabo [priority:: medium]");
	// Round trip: what we write parses back to the same values
	const back = T(buildTaskLine("X", { due: "2026-11-20", time: "10:00", priority: 0 }, "dataview"));
	assert.deepStrictEqual([back.due, back.time, back.priority, back.text], ["2026-11-20", "10:00", 0, "X"]);
}

// 6. Urgency, sorting and grouping
{
	const today = "2026-11-13";
	const noon = 12 * 60;
	const overdue = T("- [ ] overdue 📅 2026-11-10", 1);
	const todayHigh = T("- [ ] today high 📅 2026-11-13 ⏫", 2);
	const todayLater = T("- [ ] today 18:00 📅 2026-11-13 18:00", 3);
	const tomorrow = T("- [ ] tomorrow 📅 2026-11-14", 4);
	const undatedHighest = T("- [ ] no date highest 🔺", 5);
	const scheduledLater = T("- [ ] scheduled later 📅 2026-11-14 ⏳ 2026-11-14", 6);
	const done = T("- [x] done 📅 2026-11-10", 7);
	const all = [done, undatedHighest, tomorrow, todayLater, overdue, scheduledLater, todayHigh];

	assert.ok(urgency(overdue, today, noon) > urgency(todayLater, today, noon));
	assert.ok(urgency(todayHigh, today, noon) > urgency(todayLater, today, noon));
	assert.ok(urgency(tomorrow, today, noon) > urgency(scheduledLater, today, noon), "not actionable until tomorrow");
	assert.ok(urgency(done, today, noon) < urgency(undatedHighest, today, noon));

	const byUrgency = sortTasks(all, "urgency", today, noon).map((t) => t.text);
	assert.strictEqual(byUrgency[0], "overdue");
	assert.strictEqual(byUrgency[byUrgency.length - 1], "done");
	assert.deepStrictEqual(
		sortTasks(all, "due", today, noon).map((t) => t.text).slice(0, 4),
		["overdue", "done", "today high", "today 18:00"]
	);
	assert.strictEqual(sortTasks(all, "priority", today, noon)[0].text, "no date highest");

	const groups = groupTasks(sortTasks(all, "urgency", today, noon), "when", today);
	assert.deepStrictEqual(groups.map((g) => g.label), ["Overdue", "Today", "Tomorrow", "No date", "Done"]);
	assert.strictEqual(whenBucket(T("- [ ] x 📅 2026-11-20"), today), "week");
	assert.strictEqual(whenBucket(T("- [ ] x 📅 2026-12-20"), today), "later");

	assert.deepStrictEqual(filterTasks(all, "open", "").length, 6);
	assert.deepStrictEqual(filterTasks(all, "done", "").map((t) => t.text), ["done"]);
	assert.deepStrictEqual(filterTasks(all, "all", "today 18").map((t) => t.text), ["today 18:00"]);

	const tagged = [T("- [ ] a #torts"), T("- [ ] b #contract #torts"), T("- [ ] c")];
	assert.deepStrictEqual(groupTasks(tagged, "tag", today).map((g) => [g.label, g.tasks.length]), [["#contract", 1], ["#torts", 2], ["No tag", 1]]);

	assert.strictEqual(addDays("2026-12-30", 3), "2027-01-02");
	assert.strictEqual(dueLabel("2026-11-13", today), "Today");
	assert.strictEqual(dueLabel("2026-11-10", today), "3 days overdue");
	assert.strictEqual(dueLabel("2026-12-25", today), "2026-12-25");
}

console.log("All Task Docket tests passed!");
