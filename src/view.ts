import { ItemView, Keymap, Menu, Platform, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import type TaskDocketPlugin from "./main";
import {
	GroupMode,
	SortMode,
	StatusFilter,
	addDays,
	dueLabel,
	filterTasks,
	groupTasks,
	isoDate,
	sortTasks,
	whenBucket,
} from "./arrange";
import { GROUP_OPTIONS, SORT_OPTIONS } from "./settings";
import { PRIORITY_NAMES, Priority, Task } from "./task";
import { DueDateModal, PRIORITY_ICON } from "./modals";

export const VIEW_TYPE_DOCKET = "task-docket-view";

/** Tasks shown per group before "Show more". Keeps very large vaults responsive. */
const PAGE = 50;

interface DocketState {
	sort: SortMode;
	group: GroupMode;
	status: StatusFilter;
	query: string;
	collapsed: string[];
}

export class TaskDocketView extends ItemView {
	private state: DocketState;
	private listEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private expanded = new Set<string>();
	private unsubscribe: (() => void) | null = null;
	private lastToday = "";

	constructor(leaf: WorkspaceLeaf, private plugin: TaskDocketPlugin) {
		super(leaf);
		this.state = {
			sort: plugin.settings.defaultSort,
			group: plugin.settings.defaultGroup,
			status: "open",
			query: "",
			collapsed: [],
		};
	}

	getViewType(): string {
		return VIEW_TYPE_DOCKET;
	}

	getDisplayText(): string {
		return "Task docket";
	}

	getIcon(): string {
		return "list-checks";
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: Partial<DocketState>, result: ViewStateResult): Promise<void> {
		this.state = { ...this.state, ...state };
		if (this.listEl) {
			this.buildToolbar();
			this.render();
		}
		return super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("task-docket");
		this.buildToolbar();
		this.unsubscribe = this.plugin.index.onChange(() => this.render());
		// Re-render when the date rolls over (due labels and groups depend on "today").
		this.registerInterval(
			window.setInterval(() => {
				if (isoDate(new Date()) !== this.lastToday) this.render();
			}, 60_000)
		);
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/* ---------- toolbar ---------- */

	private buildToolbar(): void {
		this.contentEl.querySelector(".task-docket-toolbar")?.remove();
		this.contentEl.querySelector(".task-docket-summary")?.remove();
		this.contentEl.querySelector(".task-docket-list")?.remove();

		const bar = this.contentEl.createDiv({ cls: "task-docket-toolbar" });
		const search = bar.createDiv({ cls: "task-docket-search search-input-container" });
		const input = search.createEl("input", {
			type: "search",
			placeholder: "Filter tasks, #tags or notes…",
			attr: { "aria-label": "Filter tasks" },
		});
		input.value = this.state.query;
		input.addEventListener("input", () => {
			this.state.query = input.value;
			this.render();
		});

		const controls = bar.createDiv({ cls: "task-docket-controls" });
		const seg = controls.createDiv({ cls: "task-docket-segmented", attr: { role: "group", "aria-label": "Show" } });
		for (const [value, label] of [["open", "Open"], ["done", "Done"], ["all", "All"]] as [StatusFilter, string][]) {
			const b = seg.createEl("button", { text: label, cls: "task-docket-seg-btn" });
			b.toggleClass("is-active", this.state.status === value);
			b.setAttr("aria-pressed", String(this.state.status === value));
			b.addEventListener("click", () => {
				this.state.status = value;
				seg.querySelectorAll("button").forEach((x) => {
					x.toggleClass("is-active", x === b);
					x.setAttr("aria-pressed", String(x === b));
				});
				this.render();
			});
		}

		const select = (label: string, options: Record<string, string>, value: string, onChange: (v: string) => void) => {
			const el = controls.createEl("select", { cls: "dropdown task-docket-select", attr: { "aria-label": label } });
			for (const [k, v] of Object.entries(options)) el.createEl("option", { value: k, text: v });
			el.value = value;
			el.addEventListener("change", () => onChange(el.value));
		};
		select("Sort by", Object.fromEntries(Object.entries(SORT_OPTIONS).map(([k, v]) => [k, `Sort: ${v}`])), this.state.sort, (v) => {
			this.state.sort = v as SortMode;
			this.render();
		});
		select("Group by", Object.fromEntries(Object.entries(GROUP_OPTIONS).map(([k, v]) => [k, `Group: ${v}`])), this.state.group, (v) => {
			this.state.group = v as GroupMode;
			this.state.collapsed = [];
			this.render();
		});

		const add = controls.createEl("button", { cls: "mod-cta task-docket-add", attr: { "aria-label": "Add task" } });
		setIcon(add.createSpan({ cls: "task-docket-add-icon" }), "plus");
		add.createSpan({ text: "Add task" });
		add.addEventListener("click", () => this.plugin.openAddTask());

		this.summaryEl = this.contentEl.createDiv({ cls: "task-docket-summary" });
		this.listEl = this.contentEl.createDiv({ cls: "task-docket-list" });
	}

	/* ---------- list ---------- */

	render(): void {
		if (!this.listEl) return;
		const today = isoDate(new Date());
		this.lastToday = today;
		const now = new Date();
		const minutes = now.getHours() * 60 + now.getMinutes();

		const all = this.plugin.index.all();
		const open = all.filter((t) => t.status === "open" || t.status === "in-progress");
		const overdue = open.filter((t) => whenBucket(t, today) === "overdue").length;
		const dueToday = open.filter((t) => whenBucket(t, today) === "today").length;
		this.summaryEl.empty();
		if (!this.plugin.index.isReady) {
			this.summaryEl.setText("Collecting tasks…");
		} else {
			const parts: [string, string][] = [];
			if (overdue) parts.push([`${overdue} overdue`, "is-overdue"]);
			if (dueToday) parts.push([`${dueToday} due today`, "is-today"]);
			parts.push([`${open.length} open`, ""]);
			parts.forEach(([text, cls], i) => {
				if (i) this.summaryEl.createSpan({ text: " · ", cls: "task-docket-sep" });
				this.summaryEl.createSpan({ text, cls });
			});
		}

		const scroll = this.listEl.scrollTop;
		this.listEl.empty();
		const shown = filterTasks(all, this.state.status, this.state.query);
		if (this.plugin.index.isReady && shown.length === 0) {
			const empty = this.listEl.createDiv({ cls: "task-docket-empty" });
			empty.createDiv({
				cls: "task-docket-empty-title",
				text: all.length === 0 ? "No tasks in this vault yet" : "No tasks match",
			});
			empty.createDiv({
				cls: "task-docket-empty-desc",
				text:
					all.length === 0
						? "Tasks are checkbox list items, like - [ ] Read Donoghue v Stevenson 📅 2026-11-20. Add one here or in any note."
						: "Try another filter, or show done tasks.",
			});
			return;
		}

		const groups = groupTasks(sortTasks(shown, this.state.sort, today, minutes), this.state.group, today);
		for (const g of groups) {
			const collapsed = this.state.collapsed.includes(g.key);
			const section = this.listEl.createDiv({ cls: "task-docket-group" });
			if (g.tone) section.addClass(`is-${g.tone}`);
			if (this.state.group !== "none") {
				const head = section.createEl("button", { cls: "task-docket-group-head", attr: { "aria-expanded": String(!collapsed) } });
				setIcon(head.createSpan({ cls: "task-docket-chevron" }), collapsed ? "chevron-right" : "chevron-down");
				head.createSpan({ cls: "task-docket-group-label", text: g.label });
				head.createSpan({ cls: "task-docket-group-count", text: String(g.tasks.length) });
				head.addEventListener("click", () => {
					this.state.collapsed = collapsed ? this.state.collapsed.filter((k) => k !== g.key) : [...this.state.collapsed, g.key];
					this.render();
				});
			}
			if (collapsed) continue;
			const limit = this.expanded.has(g.key) ? Infinity : PAGE;
			for (const task of g.tasks.slice(0, limit)) this.renderTask(section, task, today);
			if (g.tasks.length > limit) {
				const more = section.createEl("button", { cls: "task-docket-more", text: `Show ${g.tasks.length - limit} more` });
				more.addEventListener("click", () => {
					this.expanded.add(g.key);
					this.render();
				});
			}
		}
		this.listEl.scrollTop = scroll;
	}

	private renderTask(parent: HTMLElement, task: Task, today: string): void {
		const closed = task.status === "done" || task.status === "cancelled";
		const row = parent.createDiv({ cls: "task-docket-task" });
		row.toggleClass("is-done", task.status === "done");
		row.toggleClass("is-cancelled", task.status === "cancelled");

		const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox task-docket-check" });
		box.checked = task.status === "done";
		box.setAttr("aria-label", closed ? "Mark as not done" : "Mark as done");
		box.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.plugin.toggleTask(task);
		});

		const main = row.createDiv({ cls: "task-docket-main" });
		const textEl = main.createDiv({ cls: "task-docket-text" });
		this.renderInline(textEl, task.text || "(empty task)");
		textEl.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest(".task-docket-link, .task-docket-tag")) return;
			void this.plugin.openTask(task, Boolean(Keymap.isModEvent(e)));
		});

		const meta = main.createDiv({ cls: "task-docket-meta" });
		const prioIcon = PRIORITY_ICON[task.priority];
		if (prioIcon) {
			const p = meta.createSpan({ cls: `task-docket-chip task-docket-priority is-p${task.priority}`, attr: { "aria-label": `${PRIORITY_NAMES[task.priority]} priority` } });
			setIcon(p, prioIcon);
			p.createSpan({ text: PRIORITY_NAMES[task.priority] });
		}
		if (task.due) {
			const bucket = whenBucket(task, today);
			const due = meta.createSpan({ cls: "task-docket-chip task-docket-due" });
			if (!closed && (bucket === "overdue" || bucket === "today")) due.addClass(`is-${bucket}`);
			setIcon(due, "calendar");
			due.createSpan({ text: dueLabel(task.due, today) });
			due.setAttr("aria-label", `Due ${task.due}`);
		}
		if (task.time) {
			const time = meta.createSpan({ cls: "task-docket-chip task-docket-time" });
			setIcon(time, "clock");
			time.createSpan({ text: task.time });
		}
		if (task.scheduled && task.scheduled > today) {
			const s = meta.createSpan({ cls: "task-docket-chip task-docket-scheduled", attr: { "aria-label": `Scheduled ${task.scheduled}` } });
			setIcon(s, "hourglass");
			s.createSpan({ text: dueLabel(task.scheduled, today) });
		}
		const note = meta.createSpan({ cls: "task-docket-chip task-docket-note", attr: { "aria-label": `Open ${task.path}` } });
		setIcon(note, "file-text");
		note.createSpan({ text: task.path.split("/").pop()!.replace(/\.md$/i, "") });
		note.addEventListener("click", (e) => void this.plugin.openTask(task, Boolean(Keymap.isModEvent(e))));

		const more = row.createEl("button", { cls: "clickable-icon task-docket-menu-btn", attr: { "aria-label": "Task actions" } });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (e) => this.openMenu(task, e));
		row.addEventListener("contextmenu", (e) => this.openMenu(task, e));
	}

	/** Plain-text rendering with wikilinks and tags made interactive: fast, and never loads anything. */
	private renderInline(el: HTMLElement, text: string): void {
		const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\([^)]*\)|(^|\s)#([\p{L}\p{N}_/-]+)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/gu;
		let pos = 0;
		for (const m of text.matchAll(re)) {
			const at = m.index ?? 0;
			el.appendText(text.slice(pos, at));
			if (m[1] !== undefined) {
				const link = el.createSpan({ cls: "task-docket-link", text: m[2] ?? m[1] });
				link.addEventListener("click", (e) => {
					e.stopPropagation();
					void this.app.workspace.openLinkText(m[1], "", Boolean(Keymap.isModEvent(e)));
				});
			} else if (m[3] !== undefined) {
				el.appendText(m[3]);
			} else if (m[5] !== undefined) {
				el.appendText(m[4]);
				const tag = el.createSpan({ cls: "tag task-docket-tag", text: `#${m[5]}` });
				tag.addEventListener("click", (e) => {
					e.stopPropagation();
					this.state.query = `#${m[5]}`;
					const input = this.contentEl.querySelector<HTMLInputElement>(".task-docket-search input");
					if (input) input.value = this.state.query;
					this.render();
				});
			} else if (m[6] !== undefined) {
				el.createEl("code", { text: m[6] });
			} else {
				el.createEl("strong", { text: m[7] ?? m[8] });
			}
			pos = at + m[0].length;
		}
		el.appendText(text.slice(pos));
	}

	private openMenu(task: Task, evt: MouseEvent): void {
		evt.preventDefault();
		evt.stopPropagation();
		const today = isoDate(new Date());
		const menu = new Menu();
		const due = (title: string, icon: string, date: string | null) =>
			menu.addItem((i) =>
				i.setTitle(title).setIcon(icon).setSection("due").onClick(() => void this.plugin.setDue(task, date, date ? task.time ?? null : null))
			);
		due("Due today", "calendar-check", today);
		due("Due tomorrow", "calendar-plus", addDays(today, 1));
		due("Due in a week", "calendar-range", addDays(today, 7));
		menu.addItem((i) =>
			i
				.setTitle("Pick date and time…")
				.setIcon("calendar-clock")
				.setSection("due")
				.onClick(() =>
					new DueDateModal(this.app, task, (d, t) => void this.plugin.setDue(task, d, t)).open()
				)
		);
		if (task.due) due("Clear due date", "calendar-x", null);
		for (const p of [5, 4, 3, 2, 1, 0] as Priority[]) {
			menu.addItem((i) =>
				i
					.setTitle(`${PRIORITY_NAMES[p][0].toUpperCase()}${PRIORITY_NAMES[p].slice(1)} priority`)
					.setIcon(PRIORITY_ICON[p] ?? "circle")
					.setChecked(task.priority === p)
					.setSection("priority")
					.onClick(() => void this.plugin.setPriority(task, p))
			);
		}
		menu.addItem((i) =>
			i.setTitle("Open in note").setIcon("file-text").setSection("open").onClick(() => void this.plugin.openTask(task, false))
		);
		if (!Platform.isPhone) {
			menu.addItem((i) =>
				i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => void this.plugin.openTask(task, true))
			);
		}
		menu.showAtMouseEvent(evt);
	}
}
