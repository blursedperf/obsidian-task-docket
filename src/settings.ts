import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type TaskDocketPlugin from "./main";
import type { GroupMode, SortMode } from "./arrange";
import type { MetadataFormat } from "./task";

export interface TaskDocketSettings {
	/** Note new tasks are added to (created if missing). */
	inboxPath: string;
	/** One folder per line; tasks in these folders (and subfolders) are ignored. */
	excludedFolders: string;
	/** Stamp today's date (✅ or [completion:: ]) when a task is checked off. */
	stampDoneDate: boolean;
	/** Format for dates and priorities the plugin writes on lines that do not have one yet. */
	metadataFormat: MetadataFormat;
	defaultSort: SortMode;
	defaultGroup: GroupMode;
	/** Overdue / due-today counts in the status bar (desktop). */
	showStatusBar: boolean;
	/** Where the docket opens. */
	openIn: "tab" | "sidebar";
	/** Typing the trigger on a task line offers dates, times and priorities. */
	inlineSuggest: boolean;
	/** The character that opens those suggestions. */
	inlineTrigger: string;
	/** Due date and priority items in the editor's right-click menu on task lines. */
	editorMenu: boolean;
}

export const DEFAULT_SETTINGS: TaskDocketSettings = {
	inboxPath: "Tasks.md",
	excludedFolders: "",
	stampDoneDate: true,
	metadataFormat: "emoji",
	defaultSort: "urgency",
	defaultGroup: "when",
	showStatusBar: true,
	openIn: "tab",
	inlineSuggest: true,
	inlineTrigger: "@",
	editorMenu: true,
};

export const SORT_OPTIONS: Record<SortMode, string> = {
	urgency: "Urgency",
	due: "Due date and time",
	priority: "Priority",
	note: "Note",
};

export const GROUP_OPTIONS: Record<GroupMode, string> = {
	when: "Due date",
	priority: "Priority",
	note: "Note",
	tag: "Tag",
	none: "No grouping",
};

type Key = keyof TaskDocketSettings;

export class TaskDocketSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TaskDocketPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		return [
			{
				type: "group",
				heading: "Tasks",
				items: [
					{
						name: "Inbox note",
						desc: "Where tasks added from the docket are written. Created if it does not exist.",
						aliases: ["add task", "new task"],
						control: { type: "text", key: "inboxPath", placeholder: "Tasks.md" },
					},
					{
						name: "Excluded folders",
						desc: "Tasks in these folders (and their subfolders) are not collected. One folder path per line.",
						aliases: ["ignore", "archive", "templates"],
						control: { type: "textarea", key: "excludedFolders", placeholder: "Templates\nArchive", rows: 3 },
					},
					{
						name: "Stamp the completion date",
						desc: "When a task is checked off, add today's date (✅ 2026-11-13 or [completion:: 2026-11-13]). Reopening it removes the date.",
						aliases: ["done date"],
						control: { type: "toggle", key: "stampDoneDate" },
					},
					{
						name: "Date and priority format",
						desc: "How new dates and priorities are written. A task that already uses one format keeps it.",
						aliases: ["emoji", "dataview", "tasks plugin"],
						control: {
							type: "dropdown",
							key: "metadataFormat",
							options: { emoji: "Tasks emoji (📅 2026-11-13 ⏫)", dataview: "Dataview fields ([due:: 2026-11-13])" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Writing tasks",
				items: [
					{
						name: "Suggest dates and priorities while typing",
						desc: "On a checklist line, type @ to set a due date, time or priority: @tomorrow, @fri 9am, @17:00, @3d, @high, @!!.",
						aliases: ["inline", "autocomplete", "due date", "natural language"],
						control: { type: "toggle", key: "inlineSuggest" },
					},
					{
						name: "Trigger character",
						desc: "What opens the suggestions. It only works at the start of a word on a checklist line, so e-mail addresses are safe.",
						control: { type: "text", key: "inlineTrigger", placeholder: "@" },
					},
					{
						name: "Task actions in the editor menu",
						desc: "Right-click a checklist line to set its due date or priority.",
						aliases: ["context menu", "right click"],
						control: { type: "toggle", key: "editorMenu" },
					},
				],
			},
			{
				type: "group",
				heading: "Docket",
				items: [
					{
						name: "Default sort",
						desc: "How tasks are ordered when the docket opens.",
						control: { type: "dropdown", key: "defaultSort", options: SORT_OPTIONS },
					},
					{
						name: "Default grouping",
						desc: "How tasks are grouped when the docket opens.",
						control: { type: "dropdown", key: "defaultGroup", options: GROUP_OPTIONS },
					},
					{
						name: "Open the docket in",
						control: { type: "dropdown", key: "openIn", options: { tab: "A new tab", sidebar: "The right sidebar" } },
					},
					{
						name: "Show due counts in the status bar",
						desc: "Overdue and due-today counts at the bottom of the window (desktop). Click to open the docket.",
						control: { type: "toggle", key: "showStatusBar" },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as Key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		if (key === "excludedFolders") this.plugin.requestRebuild();
		if (key === "showStatusBar") this.plugin.refreshStatusBar();
	}
}
