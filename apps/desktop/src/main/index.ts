import { app, BrowserWindow, Menu, shell } from 'electron';
import fixPath from 'fix-path';
import { resolve } from 'node:path';
import {
	createDesignBranch,
	defaultBaseBranch,
	deleteDesignBranch,
	listVersions,
	openPullRequest,
	renameDesignBranch,
	restoreVersion,
	saveVersion,
	shipStatus,
	shipToBase,
	updateFromBase,
	ensureIsolationRoute,
	listBranches,
	listSourceBranches,
	removeIsolationRoute,
	scanRoutes
} from '@codesigner/engine';
import { EDITOR_APP_URL, EDITOR_DEV_URL, appVersion, isDev, preloadPath } from './env.js';
import { handle, broadcast } from './ipc.js';
import { handleAppScheme, registerAppScheme } from './protocol.js';
import { configurePreviewSession, hardenWebviews, previewSession } from './webviews.js';
import {
	openInEditor,
	openProject,
	pickProject,
	recentProjects,
	revealPath,
	updateProjectSettings
} from './projects.js';
import { devServerLogs, devServerState, startDevServer, stopAllDevServers, stopDevServer } from './devservers.js';
import { checkForUpdate } from './updates.js';
import { buildMenu } from './menu.js';
import { forceStates } from './states.js';
import { registerSourceHandlers, stopWatchingSources } from './source.js';

/** Working copies holding the component canvas route, removed on quit. */
const isolated = new Set<string>();

// GUI apps launched from Finder don't inherit the login shell's PATH (bun, node, git…).
fixPath();

app.setName('Codesigner');
// Isolated profiles for tests and side-by-side instances.
if (process.env.CODESIGNER_USER_DATA) app.setPath('userData', process.env.CODESIGNER_USER_DATA);
registerAppScheme();

function createWindow() {
	const win = new BrowserWindow({
		width: 1600,
		height: 1000,
		minWidth: 960,
		minHeight: 600,
		title: 'Codesigner',
		titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
		trafficLightPosition: { x: 14, y: 16 },
		backgroundColor: '#f5f5f5',
		show: false,
		webPreferences: {
			preload: preloadPath('index'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webviewTag: true,
			spellcheck: false
		}
	});

	hardenWebviews(win.webContents);
	win.once('ready-to-show', () => win.show());

	// Links clicked in the editor UI open in the system browser.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (event, url) => {
		const allowed = isDev ? url.startsWith(EDITOR_DEV_URL) : url.startsWith(EDITOR_APP_URL);
		if (!allowed) event.preventDefault();
	});

	void win.loadURL(isDev ? EDITOR_DEV_URL : EDITOR_APP_URL);
	return win;
}

function registerHandlers() {
	handle('app:info', () => ({
		version: appVersion(),
		platform: process.platform,
		arch: process.arch,
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		locale: app.getLocale(),
		guestPreload: `file://${preloadPath('guest')}`,
		isDev,
		noAutosave: process.env.CODESIGNER_NO_AUTOSAVE === '1'
	}));
	handle('app:check-update', () => checkForUpdate());
	handle('app:open-external', (url) => {
		// The web, or the project's own dev server (the Preview button).
		if (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) void shell.openExternal(url);
	});

	handle('project:pick', () => pickProject());
	handle('project:recent', () => recentProjects());
	handle('project:open', (root) => openProject(root));
	handle('project:update-settings', (root, patch) => updateProjectSettings(root, patch));
	handle('project:routes', (worktree) => scanRoutes(worktree));
	handle('project:reveal', (path) => revealPath(path));
	handle('project:open-in-editor', (file, line, column) => openInEditor(file, line, column));
	handle('canvas:remove-isolation', (worktree) => {
		removeIsolationRoute(worktree);
		isolated.delete(worktree);
	});
	handle('canvas:ensure-isolation', async (worktree, serverUrl) => {
		const path = ensureIsolationRoute(worktree);
		isolated.add(worktree);
		// A route created a moment ago 404s until the dev server registers it.
		if (serverUrl && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(serverUrl)) {
			const url = new URL(path, serverUrl).toString();
			for (let i = 0; i < 40; i++) {
				const status = await previewSession()
					.fetch(url, { redirect: 'manual' })
					.then((r) => r.status)
					.catch(() => 0);
				if (status !== 404 && status !== 0) break;
				await new Promise((r) => setTimeout(r, 200));
			}
		}
		return path;
	});
	handle('canvas:force-states', (id, rules) => forceStates(id, rules));

	handle('branch:list', (root) => listBranches(root));
	handle('branch:sources', (root) => ({ branches: listSourceBranches(root), defaultBase: defaultBaseBranch(root) }));
	handle('branch:create', (root, name, from) => createDesignBranch(root, name, from));
	handle('branch:checkpoint', (worktree, message, auto) => saveVersion(worktree, message, auto));
	handle('branch:versions', (worktree) => listVersions(worktree));
	handle('branch:restore', (worktree, sha, label) => restoreVersion(worktree, sha, label));
	handle('branch:ship-status', (worktree) => shipStatus(worktree));
	handle('branch:ship', (worktree, message) => shipToBase(worktree, message));
	handle('branch:update-from-base', (worktree) => updateFromBase(worktree));
	handle('branch:pull-request', (worktree, title, body) => openPullRequest(worktree, title, body));
	handle('branch:rename', (root, from, to) => renameDesignBranch(root, from, to));
	handle('branch:delete', async (root, name, force) => {
		const branch = listBranches(root).find((b) => b.name === name);
		if (branch) await stopDevServer(branch.worktree);
		deleteDesignBranch(root, name, force);
	});

	handle('devserver:start', (worktree) => startDevServer(worktree));
	handle('devserver:stop', (worktree) => stopDevServer(worktree));
	handle('devserver:state', (worktree) => devServerState(worktree));
	handle('devserver:logs', (worktree) => devServerLogs(worktree));

	registerSourceHandlers(
		handle,
		(worktree, files) => broadcast('source:changed', { worktree: resolve(worktree), files, origin: 'editor' }),
		(worktree, files) => broadcast('source:changed', { worktree, files, origin: 'external' })
	);
}

app.whenReady().then(() => {
	handleAppScheme();
	configurePreviewSession();
	registerHandlers();
	Menu.setApplicationMenu(buildMenu((command) => broadcast('menu:command', { command })));
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('before-quit', () => {
	stopAllDevServers();
	for (const worktree of isolated) removeIsolationRoute(worktree);
	stopWatchingSources();
	void previewSession().flushStorageData();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
