import { Editor, Menu, Notice, Platform, Plugin, TFile, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import { TaskIndex } from "./index";
import { TaskDocketView, VIEW_TYPE_DOCKET } from "./view";
import { DEFAULT_SETTINGS, TaskDocketSettingTab, TaskDocketSettings } from "./settings";
import { AddTaskModal, DueDateModal, NewTask, PriorityModal } from "./modals";
import { TaskPropertySuggest, inCodeOrFrontmatter, rewriteTaskLine, taskOnLine } from "./suggest";
import { Priority, Task, buildTaskLine, setDueLine, setPriorityLine, toggleTaskLine } from "./task";
import { addDays, isoDate, whenBucket } from "./arrange";

export default class TaskDocketPlugin extends Plugin {
	settings: TaskDocketSettings = { ...DEFAULT_SETTINGS };
	index!: TaskIndex;
	private statusEl: HTMLElement | null = null;

	requestRebuild = debounce(() => void this.index.rebuild(), 600, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.index = this.addChild(new TaskIndex(this.app, () => this.excludedFolders()));
		this.registerView(VIEW_TYPE_DOCKET, (leaf) => new TaskDocketView(leaf, this));

		this.addRibbonIcon("list-checks", "Task docket", (evt) => this.openRibbonMenu(evt));
		this.addCommand({ id: "open", name: "Open", callback: () => void this.activateView() });
		this.addCommand({ id: "add-task", name: "Add task", callback: () => this.openAddTask() });
		this.addCommand({ id: "rebuild", name: "Rescan tasks", callback: () => void this.index.rebuild() });

		this.registerEditorSuggest(new TaskPropertySuggest(this));
		this.addCommand({
			id: "set-due-at-cursor",
			name: "Set due date for task at cursor",
			icon: "calendar-clock",
			editorCheckCallback: (checking, editor) => this.withCursorTask(editor, checking, (line) => this.pickDue(editor, line)),
		});
		this.addCommand({
			id: "set-priority-at-cursor",
			name: "Set priority for task at cursor",
			icon: "flag",
			editorCheckCallback: (checking, editor) => this.withCursorTask(editor, checking, (line) => this.pickPriority(editor, line)),
		});
		this.addCommand({
			id: "clear-due-at-cursor",
			name: "Clear due date for task at cursor",
			icon: "calendar-x",
			editorCheckCallback: (checking, editor) =>
				this.withCursorTask(editor, checking, (line) => this.setLineDue(editor, line, null), (t) => !!t.due),
		});
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!this.settings.editorMenu) return;
				const line = editor.getCursor().line;
				const task = taskOnLine(editor, line);
				if (!task || inCodeOrFrontmatter(this.app, info.file, line)) return;
				const today = isoDate(new Date());
				const item = (title: string, icon: string, run: () => void) =>
					menu.addItem((i) => i.setTitle(title).setIcon(icon).setSection("task-docket").onClick(run));
				item("Task due today", "calendar-check", () => this.setLineDue(editor, line, today));
				item("Task due tomorrow", "calendar-plus", () => this.setLineDue(editor, line, addDays(today, 1)));
				item("Set task due date…", "calendar-clock", () => this.pickDue(editor, line));
				if (task.due) item("Clear task due date", "calendar-x", () => this.setLineDue(editor, line, null));
				item("Set task priority…", "flag", () => this.pickPriority(editor, line));
			})
		);

		this.addSettingTab(new TaskDocketSettingTab(this.app, this));

		this.register(this.index.onChange(() => this.refreshStatusBar()));
		this.refreshStatusBar();
		// The status bar counts depend on the date: refresh when it rolls over.
		let lastDay = isoDate(new Date());
		this.registerInterval(
			window.setInterval(() => {
				const day = isoDate(new Date());
				if (day !== lastDay) {
					lastDay = day;
					this.refreshStatusBar();
				}
			}, 60_000)
		);
	}

	onunload(): void {
		this.requestRebuild.cancel();
	}

	async loadSettings(): Promise<void> {
		const data: unknown = await this.loadData();
		const saved = data !== null && typeof data === "object" ? (data as Partial<TaskDocketSettings>) : {};
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	excludedFolders(): string[] {
		return this.settings.excludedFolders.split("\n").map((f) => f.trim()).filter(Boolean);
	}

	/* ---------- view ---------- */

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DOCKET)[0] ?? null;
		if (!leaf) {
			leaf = this.settings.openIn === "sidebar" && !Platform.isPhone ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_DOCKET, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	refreshStatusBar(): void {
		if (!this.settings.showStatusBar || Platform.isMobile) {
			this.statusEl?.remove();
			this.statusEl = null;
			return;
		}
		if (!this.statusEl) {
			this.statusEl = this.addStatusBarItem();
			this.statusEl.addClass("task-docket-status", "mod-clickable");
			this.statusEl.setAttr("aria-label", "Open task docket");
			this.registerDomEvent(this.statusEl, "click", () => void this.activateView());
		}
		const { overdue, dueToday } = this.dueCounts();
		this.statusEl.empty();
		this.statusEl.toggleClass("has-overdue", overdue > 0);
		this.statusEl.setText(
			overdue || dueToday ? [overdue ? `${overdue} overdue` : "", dueToday ? `${dueToday} due today` : ""].filter(Boolean).join(" · ") : "No tasks due"
		);
	}

	/** Open tasks that are overdue or due today. */
	dueCounts(): { overdue: number; dueToday: number } {
		const today = isoDate(new Date());
		let overdue = 0;
		let dueToday = 0;
		for (const t of this.index.all()) {
			if (t.status !== "open" && t.status !== "in-progress") continue;
			const b = whenBucket(t, today);
			if (b === "overdue") overdue++;
			else if (b === "today") dueToday++;
		}
		return { overdue, dueToday };
	}

	/** The ribbon button: today's counts at a glance, then the docket's actions. */
	private openRibbonMenu(evt: MouseEvent): void {
		const { overdue, dueToday } = this.dueCounts();
		const summary = [overdue ? `${overdue} overdue` : "", dueToday ? `${dueToday} due today` : ""].filter(Boolean).join(" · ") || "No tasks due today";
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(summary).setIcon(overdue ? "alert-circle" : "calendar-check").setSection("summary").setDisabled(true));
		menu.addItem((i) => i.setTitle("Open task docket").setIcon("list-checks").setSection("actions").onClick(() => void this.activateView()));
		menu.addItem((i) => i.setTitle("Add task…").setIcon("plus").setSection("actions").onClick(() => this.openAddTask()));
		menu.addItem((i) => i.setTitle("Rescan tasks").setIcon("refresh-cw").setSection("actions").onClick(() => void this.index.rebuild()));
		menu.showAtMouseEvent(evt);
	}

	/* ---------- editing ---------- */

	/**
	 * Rewrite a task's line in its note. The line must still be exactly what the docket showed; if it
	 * moved, it is found by its text, and if it changed the edit is skipped instead of guessed.
	 */
	private async editTask(task: Task, transform: (line: string) => string): Promise<void> {
		const file = this.app.vault.getFileByPath(task.path);
		if (!file) {
			new Notice("Task Docket: the note for this task no longer exists.");
			return;
		}
		let applied = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			const eol = (i: number) => (lines[i].endsWith("\r") ? "\r" : "");
			const same = (i: number) => lines[i]?.replace(/\r$/, "") === task.raw;
			let at = same(task.line) ? task.line : -1;
			if (at < 0) {
				const matches = lines.map((_, i) => i).filter(same);
				if (matches.length === 1) at = matches[0];
			}
			if (at < 0) return data;
			lines[at] = transform(task.raw) + eol(at);
			applied = true;
			return lines.join("\n");
		});
		if (!applied) new Notice("Task Docket: this task changed in its note. The list has been refreshed; try again.");
	}

	toggleTask(task: Task): Promise<void> {
		const { stampDoneDate, metadataFormat } = this.settings;
		return this.editTask(task, (line) => toggleTaskLine(line, isoDate(new Date()), stampDoneDate, metadataFormat));
	}

	setDue(task: Task, due: string | null, time: string | null): Promise<void> {
		return this.editTask(task, (line) => setDueLine(line, due, time, this.settings.metadataFormat));
	}

	setPriority(task: Task, priority: Priority): Promise<void> {
		return this.editTask(task, (line) => setPriorityLine(line, priority, this.settings.metadataFormat));
	}

	async openTask(task: Task, newTab: boolean): Promise<void> {
		const file = this.app.vault.getFileByPath(task.path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.openFile(file, { eState: { line: task.line } });
	}

	/* ---------- editing in the note ---------- */

	/** Run an action for the task under the cursor; commands are only offered on task lines. */
	private withCursorTask(editor: Editor, checking: boolean, run: (line: number) => void, when: (t: Task) => boolean = () => true): boolean {
		const line = editor.getCursor().line;
		const task = taskOnLine(editor, line);
		if (!task || !when(task)) return false;
		if (!checking) run(line);
		return true;
	}

	private setLineDue(editor: Editor, line: number, date: string | null, time: string | null = null): void {
		rewriteTaskLine(editor, line, (raw) => setDueLine(raw, date, time, this.settings.metadataFormat));
	}

	private pickDue(editor: Editor, line: number): void {
		const task = taskOnLine(editor, line);
		new DueDateModal(this.app, task ?? {}, (date, time) => this.setLineDue(editor, line, date, time)).open();
	}

	private pickPriority(editor: Editor, line: number): void {
		const task = taskOnLine(editor, line);
		new PriorityModal(this.app, task?.priority ?? 2, (p) =>
			rewriteTaskLine(editor, line, (raw) => setPriorityLine(raw, p, this.settings.metadataFormat))
		).open();
	}

	/* ---------- adding ---------- */

	openAddTask(): void {
		const path = this.inboxPath();
		new AddTaskModal(this.app, path, (t) => void this.addTask(t)).open();
	}

	private inboxPath(): string {
		const raw = this.settings.inboxPath.trim() || DEFAULT_SETTINGS.inboxPath;
		return normalizePath(/\.md$/i.test(raw) ? raw : `${raw}.md`);
	}

	async addTask(t: NewTask): Promise<void> {
		const line = buildTaskLine(t.text, { due: t.due, time: t.time, priority: t.priority }, this.settings.metadataFormat);
		const path = this.inboxPath();
		let file = this.app.vault.getFileByPath(path);
		if (!file) {
			const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			if (folder && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
			file = await this.app.vault.create(path, `${line}\n`);
		} else {
			await this.app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}${data.trim() ? "\n" : ""}${line}\n`);
		}
		new Notice(`Task added to ${file.basename}`);
	}
}
