import { dialog, shell, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Breakpoint, ProjectInfo, ProjectSettings, RecentProject } from '@codesigner/protocol';
import { detectProject } from '@codesigner/engine';
import { JsonStore } from './store.js';

const DEFAULT_BREAKPOINTS: Breakpoint[] = [
	{ id: 'desktop', name: 'Desktop', width: 1280, height: 800, primary: true },
	{ id: 'tablet', name: 'Tablet', width: 810, height: 1080 },
	{ id: 'phone', name: 'Phone', width: 390, height: 844 }
];

const defaultSettings = (): ProjectSettings => ({
	versioning: 'branches',
	routeParams: {},
	breakpoints: DEFAULT_BREAKPOINTS
});

type AppState = {
	recent: RecentProject[];
	projects: Record<string, ProjectSettings>;
};

const store = new JsonStore<AppState>('codesigner-state', { recent: [], projects: {} });

export function recentProjects(): RecentProject[] {
	return store.get('recent');
}

export async function pickProject(): Promise<string | null> {
	const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	const result = await dialog.showOpenDialog(win, {
		title: 'Open a SvelteKit project',
		properties: ['openDirectory']
	});
	return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function projectSettings(root: string): ProjectSettings {
	const saved = store.get('projects')[resolve(root)];
	return { ...defaultSettings(), ...saved };
}

export function updateProjectSettings(root: string, patch: Partial<ProjectSettings>): ProjectSettings {
	const key = resolve(root);
	const next = { ...projectSettings(key), ...patch };
	store.set('projects', { ...store.get('projects'), [key]: next });
	return next;
}

export function openProject(root: string): ProjectInfo {
	const detected = detectProject(resolve(root));
	const recent = [
		{ root: detected.root, name: detected.name, openedAt: Date.now() },
		...store.get('recent').filter((r) => r.root !== detected.root)
	].slice(0, 12);
	store.set('recent', recent);
	return {
		root: detected.root,
		name: detected.name,
		kit: detected.kit,
		packageManager: detected.packageManager,
		cssEntry: detected.cssEntry,
		isGitRepo: detected.isGitRepo,
		settings: projectSettings(detected.root)
	};
}

export function revealPath(path: string) {
	shell.showItemInFolder(path);
}

/** Opens a file in the user's code editor: $CODESIGNER_EDITOR, then VS Code / Cursor CLIs, then the OS default. */
export function openInEditor(file: string, line?: number, column?: number) {
	const target = line ? `${file}:${line}:${(column ?? 0) + 1}` : file;
	const preferred = process.env.CODESIGNER_EDITOR;
	const candidates = preferred ? [preferred] : ['cursor', 'code'];
	const tryNext = (i: number) => {
		if (i >= candidates.length) {
			void shell.openPath(file);
			return;
		}
		const child = spawn(candidates[i], ['--goto', target], { stdio: 'ignore', detached: true });
		child.on('error', () => tryNext(i + 1));
		child.unref();
	};
	tryNext(0);
}
