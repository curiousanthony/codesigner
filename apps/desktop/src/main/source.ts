import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { Workspace } from '@codesigner/engine';
import type { handle as handleFn } from './ipc.js';

const workspaces = new Map<string, Workspace>();
const watchers = new Map<string, FSWatcher>();
/** Files the engine wrote recently: their watcher events are ours, not external. */
const ownWrites = new Map<string, number>();
let notifyExternal: ((worktree: string, files: string[]) => void) | null = null;

export function workspaceFor(worktree: string): Workspace {
	const key = resolve(worktree);
	let ws = workspaces.get(key);
	if (!ws) {
		ws = new Workspace(key);
		workspaces.set(key, ws);
		watchSources(key);
	}
	return ws;
}

const IGNORED = /(^|\/)(node_modules|\.svelte-kit|__codesigner|paraglide)(\/|$)/;

/** Reports changes made outside Codesigner (editors, agents, git) under src/, debounced. */
function watchSources(root: string) {
	if (watchers.has(root)) return;
	let pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		const watcher = watch(join(root, 'src'), { recursive: true }, (_event, name) => {
			if (!name) return;
			const file = `src/${String(name).split('\\').join('/')}`;
			if (IGNORED.test(file)) return;
			if (Date.now() - (ownWrites.get(`${root}:${file}`) ?? 0) < 1500) return;
			pending.add(file);
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				const files = [...pending];
				pending = new Set();
				notifyExternal?.(root, files);
			}, 150);
		});
		watchers.set(root, watcher);
	} catch {
		// no src/ folder or the platform can't watch recursively: external changes just aren't live
	}
}

export function stopWatchingSources() {
	for (const watcher of watchers.values()) watcher.close();
	watchers.clear();
}

/** IPC handlers for reading and editing source files through the engine. */
export function registerSourceHandlers(
	handle: typeof handleFn,
	changed: (worktree: string, files: string[]) => void,
	external: (worktree: string, files: string[]) => void
) {
	notifyExternal = external;
	const onChanged = (worktree: string, files: string[]) => {
		const root = resolve(worktree);
		for (const file of files) ownWrites.set(`${root}:${file}`, Date.now());
		changed(worktree, files);
	};
	handle('source:read', (worktree, file) => {
		const full = resolve(worktree, file);
		if (!full.startsWith(resolve(worktree))) throw new Error('Path escapes the project');
		return readFileSync(full, 'utf8');
	});

	handle('source:edit', async (worktree, request) => {
		const result = await workspaceFor(worktree).apply(request);
		if (result.ok) onChanged(worktree, result.changes.map((c) => c.file));
		return result;
	});

	handle('source:write', (worktree, request) => {
		const result = workspaceFor(worktree).writeText(request);
		if (result.changes.length) onChanged(worktree, result.changes.map((c) => c.file));
		return result;
	});

	handle('source:inspect', (worktree, loc) => workspaceFor(worktree).inspect(loc));

	handle('source:undo', (worktree) => {
		const changes = workspaceFor(worktree).undo();
		if (changes) onChanged(worktree, changes.map((c) => c.file));
		return changes;
	});

	handle('source:redo', (worktree) => {
		const changes = workspaceFor(worktree).redo();
		if (changes) onChanged(worktree, changes.map((c) => c.file));
		return changes;
	});

	handle('source:preview-css', (worktree, classes) => workspaceFor(worktree).previewCss(classes));

	handle('tokens:read', (worktree) => workspaceFor(worktree).readTokens());
	handle('tokens:edit', (worktree, edit) => {
		const tokens = workspaceFor(worktree).editToken(edit);
		if (tokens.file) onChanged(worktree, [tokens.file]);
		return tokens;
	});

	handle('project:components', (worktree) => workspaceFor(worktree).components());
}
