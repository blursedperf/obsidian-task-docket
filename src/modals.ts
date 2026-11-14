import { App, Modal, Setting, SuggestModal, setIcon } from "obsidian";
import { PRIORITY_NAMES, Priority } from "./task";

const PRIORITY_OPTIONS: Record<string, string> = Object.fromEntries(
	([5, 4, 3, 2, 1, 0] as Priority[]).map((p) => [String(p), PRIORITY_NAMES[p][0].toUpperCase() + PRIORITY_NAMES[p].slice(1)])
);

/** Lucide icon per priority (normal has none). */
export const PRIORITY_ICON: Record<Priority, string | null> = {
	5: "chevrons-up",
	4: "chevron-up",
	3: "minus",
	2: null,
	1: "chevron-down",
	0: "chevrons-down",
};

export interface NewTask {
	text: string;
	due?: string;
	time?: string;
	priority: Priority;
}

/** Add a task: text, optional due date and time, priority. Enter in the text field saves. */
export class AddTaskModal extends Modal {
	private value: NewTask = { text: "", priority: 2 };

	constructor(app: App, private inboxPath: string, private onSubmit: (task: NewTask) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Add task");
		this.modalEl.addClass("task-docket-modal");
		const { contentEl } = this;

		new Setting(contentEl).setName("Task").addText((text) => {
			text.setPlaceholder("Read Donoghue v Stevenson #torts").onChange((v) => (this.value.text = v));
			text.inputEl.addClass("task-docket-modal-text");
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl).setName("Due").addText((text) => {
			text.inputEl.type = "date";
			text.onChange((v) => (this.value.due = v || undefined));
		}).addText((text) => {
			text.inputEl.type = "time";
			text.onChange((v) => (this.value.time = v || undefined));
		});
		new Setting(contentEl).setName("Priority").addDropdown((dd) =>
			dd.addOptions(PRIORITY_OPTIONS).setValue("2").onChange((v) => (this.value.priority = Number(v) as Priority))
		);

		new Setting(contentEl)
			.setDesc(`Added to ${this.inboxPath}`)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Add task").setCta().onClick(() => this.submit()))
			.settingEl.addClass("task-docket-modal-footer");
	}

	private submit(): void {
		if (!this.value.text.trim()) return;
		this.onSubmit(this.value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Pick a due date and optional time for an existing task. */
export class DueDateModal extends Modal {
	constructor(
		app: App,
		private initial: { due?: string; time?: string },
		private onSubmit: (due: string | null, time: string | null) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Due date");
		this.modalEl.addClass("task-docket-modal");
		let due = this.initial.due ?? "";
		let time = this.initial.time ?? "";
		new Setting(this.contentEl)
			.setName("Date")
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(due).onChange((v) => (due = v));
			})
			.addText((text) => {
				text.inputEl.type = "time";
				text.setValue(time).onChange((v) => (time = v));
			});
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Clear").onClick(() => {
					this.onSubmit(null, null);
					this.close();
				})
			)
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						this.onSubmit(due || null, due && time ? time : null);
						this.close();
					})
			)
			.settingEl.addClass("task-docket-modal-footer");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Pick a priority from the keyboard or by tapping. */
export class PriorityModal extends SuggestModal<Priority> {
	constructor(app: App, private current: Priority, private onPick: (priority: Priority) => void) {
		super(app);
		this.setPlaceholder("Priority");
		this.modalEl.addClass("task-docket-priority-modal");
	}

	getSuggestions(query: string): Priority[] {
		const q = query.trim().toLowerCase();
		return ([5, 4, 3, 2, 1, 0] as Priority[]).filter((p) => PRIORITY_NAMES[p].includes(q));
	}

	renderSuggestion(p: Priority, el: HTMLElement): void {
		el.addClass("task-docket-suggestion");
		const icon = el.createSpan({ cls: "task-docket-suggestion-icon" });
		setIcon(icon, PRIORITY_ICON[p] ?? "circle");
		el.createSpan({ cls: "task-docket-suggestion-label", text: PRIORITY_OPTIONS[String(p)] });
		if (p === this.current) el.createSpan({ cls: "task-docket-suggestion-detail", text: "Current" });
	}

	onChooseSuggestion(p: Priority): void {
		this.onPick(p);
	}
}
