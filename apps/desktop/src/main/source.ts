import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Workspace } from '@codesigner/engine';
import type { handle as handleFn } from './ipc.js';

const workspaces = new Map<string, Workspace>();

export function workspaceFor(worktree: string): Workspace {
	const key = resolve(worktree);
	let ws = workspaces.get(key);
	if (!ws) {
		ws = new Workspace(key);
		workspaces.set(key, ws);
	}
	return ws;
}

/** IPC handlers for reading and editing source files through the engine. */
export function registerSourceHandlers(
	handle: typeof handleFn,
	onChanged: (worktree: string, files: string[]) => void
) {
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
