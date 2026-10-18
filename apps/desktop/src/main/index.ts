import { app, BrowserWindow, Menu, shell } from 'electron';
import fixPath from 'fix-path';
import { resolve } from 'node:path';
import { checkpoint, createDesignBranch, ensureIsolationRoute, listBranches, scanRoutes } from '@codesigner/engine';
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
import { registerSourceHandlers } from './source.js';

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
		isDev
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
	handle('canvas:ensure-isolation', (worktree) => ensureIsolationRoute(worktree));
	handle('canvas:force-states', (id, rules) => forceStates(id, rules));

	handle('branch:list', (root) => listBranches(root));
	handle('branch:create', (root, name, from) => createDesignBranch(root, name, from));
	handle('branch:checkpoint', (worktree, message) => checkpoint(worktree, message));

	handle('devserver:start', (worktree) => startDevServer(worktree));
	handle('devserver:stop', (worktree) => stopDevServer(worktree));
	handle('devserver:state', (worktree) => devServerState(worktree));
	handle('devserver:logs', (worktree) => devServerLogs(worktree));

	registerSourceHandlers(handle, (worktree, files) =>
		broadcast('source:changed', { worktree: resolve(worktree), files, origin: 'editor' })
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
	void previewSession().flushStorageData();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
