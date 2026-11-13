import { App, CachedMetadata, Component, TAbstractFile, TFile, debounce } from "obsidian";
import { parseTasks, Task } from "./task";

/** True when a path is inside one of the excluded folders (or their subfolders). */
export function isExcluded(path: string, excluded: string[]): boolean {
	return excluded.some((folder) => {
		const f = folder.trim().replace(/^\/+|\/+$/g, "");
		return f !== "" && (path === f || path.startsWith(f + "/"));
	});
}

/**
 * Every task in the vault, kept current incrementally. Obsidian's metadata cache already knows which
 * list items are tasks, so only notes that contain tasks are read, and an edited note is re-parsed
 * from the text the cache hands over with its "changed" event (no extra file read).
 */
export class TaskIndex extends Component {
	private byPath = new Map<string, Task[]>();
	private listeners = new Set<() => void>();
	private ready = false;
	private notify = debounce(() => this.listeners.forEach((fn) => fn()), 150, true);

	constructor(private app: App, private getExcluded: () => string[]) {
		super();
	}

	onload(): void {
		const { metadataCache, vault, workspace } = this.app;
		workspace.onLayoutReady(() => void this.rebuild());
		this.registerEvent(
			metadataCache.on("changed", (file: TFile, data: string, cache: CachedMetadata) => {
				if (!this.ready) return;
				this.update(file, data, cache);
			})
		);
		this.registerEvent(
			vault.on("delete", (file: TAbstractFile) => {
				if (this.byPath.delete(file.path)) this.notify();
			})
		);
		this.registerEvent(
			vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				const tasks = this.byPath.get(oldPath);
				if (!tasks) return;
				this.byPath.delete(oldPath);
				if (file instanceof TFile && !isExcluded(file.path, this.getExcluded())) {
					this.byPath.set(file.path, tasks.map((t) => ({ ...t, path: file.path })));
				}
				this.notify();
			})
		);
	}

	onunload(): void {
		this.notify.cancel();
		this.listeners.clear();
	}

	/** Subscribe to changes; returns an unsubscribe function. */
	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	get isReady(): boolean {
		return this.ready;
	}

	all(): Task[] {
		return [...this.byPath.values()].flat();
	}

	/** Full scan: on load and when the excluded folders change. */
	async rebuild(): Promise<void> {
		const next = new Map<string, Task[]>();
		const excluded = this.getExcluded();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isExcluded(file.path, excluded)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache && !cache.listItems?.some((li) => li.task !== undefined)) continue;
			try {
				const tasks = parseTasks(await this.app.vault.cachedRead(file), file.path);
				if (tasks.length) next.set(file.path, tasks);
			} catch {
				// unreadable file
			}
		}
		this.byPath = next;
		this.ready = true;
		this.notify();
	}

	private update(file: TFile, data: string, cache: CachedMetadata): void {
		if (file.extension !== "md" || isExcluded(file.path, this.getExcluded())) return;
		const had = this.byPath.has(file.path);
		if (!cache.listItems?.some((li) => li.task !== undefined)) {
			if (had) {
				this.byPath.delete(file.path);
				this.notify();
			}
			return;
		}
		const tasks = parseTasks(data, file.path);
		if (tasks.length) this.byPath.set(file.path, tasks);
		else this.byPath.delete(file.path);
		this.notify();
	}
}
