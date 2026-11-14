import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
	setIcon,
} from "obsidian";
import type TaskDocketPlugin from "./main";
import { InlineChoice, findTrigger, inlineChoices, normaliseTrigger, removeTrigger } from "./inline";
import { isoDate } from "./arrange";
import { Task, parseTaskLine, setDueLine, setPriorityLine } from "./task";
import { DueDateModal, PRIORITY_ICON } from "./modals";

/** The task on a given editor line, or null when the line is not a task. */
export function taskOnLine(editor: Editor, line: number): Task | null {
	return parseTaskLine(editor.getLine(line), "", line);
}

/** Is this line inside a code block or the frontmatter? Uses the cached note structure. */
export function inCodeOrFrontmatter(app: App, file: TFile | null, line: number): boolean {
	if (!file) return false;
	const section = app.metadataCache
		.getFileCache(file)
		?.sections?.find((s) => s.position.start.line <= line && s.position.end.line >= line);
	return section?.type === "code" || section?.type === "yaml";
}

/**
 * Rewrite one editor line in a single edit (one undo step) and put the cursor at its end, after the
 * metadata, ready for the next property. Skips the edit when the line is no longer a task.
 */
export function rewriteTaskLine(editor: Editor, line: number, transform: (raw: string) => string): void {
	if (line >= editor.lineCount()) return;
	const raw = editor.getLine(line);
	if (!parseTaskLine(raw, "", line)) return;
	const next = transform(raw);
	if (next !== raw) editor.replaceRange(next, { line, ch: 0 }, { line, ch: raw.length });
	editor.setCursor({ line, ch: next.length });
}

const CHOICE_ICON: Record<InlineChoice["kind"], string> = {
	due: "calendar",
	priority: "flag",
	pick: "calendar-clock",
	clear: "calendar-x",
};

/** Typing the trigger ("@" by default) on a task line offers due dates, times and priorities. */
export class TaskPropertySuggest extends EditorSuggest<InlineChoice> {
	constructor(private plugin: TaskDocketPlugin) {
		super(plugin.app);
		this.limit = 20;
		this.setInstructions([
			{ command: "↑↓", purpose: "to choose" },
			{ command: "↵", purpose: "to set" },
			{ command: "esc", purpose: "to keep typing" },
		]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.inlineSuggest) return null;
		const found = findTrigger(editor.getLine(cursor.line).slice(0, cursor.ch), normaliseTrigger(this.plugin.settings.inlineTrigger));
		if (!found || inCodeOrFrontmatter(this.app, file, cursor.line)) return null;
		if (!inlineChoices(found.query, isoDate(new Date()), { hasDue: true }).length) return null;
		return { start: { line: cursor.line, ch: found.start }, end: cursor, query: found.query };
	}

	getSuggestions(context: EditorSuggestContext): InlineChoice[] {
		const task = taskOnLine(context.editor, context.start.line);
		return inlineChoices(context.query, isoDate(new Date()), { hasDue: !!task?.due });
	}

	renderSuggestion(choice: InlineChoice, el: HTMLElement): void {
		el.addClass("task-docket-suggestion");
		const icon = el.createSpan({ cls: "task-docket-suggestion-icon" });
		setIcon(icon, choice.kind === "priority" ? (PRIORITY_ICON[choice.priority] ?? "circle") : CHOICE_ICON[choice.kind]);
		el.createSpan({ cls: "task-docket-suggestion-label", text: choice.label });
		if (choice.kind === "due") el.createSpan({ cls: "task-docket-suggestion-detail", text: choice.detail });
	}

	selectSuggestion(choice: InlineChoice): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor, start, end } = ctx;
		this.close();
		const { metadataFormat } = this.plugin.settings;
		const dropTrigger = (raw: string) => removeTrigger(raw, start.ch, end.ch);
		switch (choice.kind) {
			case "due":
				rewriteTaskLine(editor, start.line, (raw) => setDueLine(dropTrigger(raw), choice.date, choice.time, metadataFormat));
				break;
			case "priority":
				rewriteTaskLine(editor, start.line, (raw) => setPriorityLine(dropTrigger(raw), choice.priority, metadataFormat));
				break;
			case "clear":
				rewriteTaskLine(editor, start.line, (raw) => setDueLine(dropTrigger(raw), null, null, metadataFormat));
				break;
			case "pick": {
				rewriteTaskLine(editor, start.line, dropTrigger);
				const task = taskOnLine(editor, start.line);
				new DueDateModal(this.app, task ?? {}, (date, time) =>
					rewriteTaskLine(editor, start.line, (raw) => setDueLine(raw, date, time, metadataFormat))
				).open();
				break;
			}
		}
	}
}
