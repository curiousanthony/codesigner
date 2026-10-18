import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const isDev = !app.isPackaged;

/** The editor UI's Vite dev server (apps/editor). */
export const EDITOR_DEV_URL = process.env.CODESIGNER_EDITOR_URL ?? 'http://localhost:5199';

/** Origin the packaged editor is served from (see protocol.ts). */
export const EDITOR_APP_URL = 'app://editor/';

/** Partition shared by every canvas webview so one login covers all frames and branches. */
export const PREVIEW_PARTITION = 'persist:preview';

export const preloadPath = (name: 'index' | 'guest') => join(here, '../preload', `${name}.cjs`);

/** Built editor (adapter-static output) copied next to the app in packaged builds. */
export const editorBuildDir = () =>
	isDev ? join(here, '../../../editor/build') : join(process.resourcesPath, 'editor');

/** App version: Electron's in packaged builds, apps/desktop/package.json in dev. */
export function appVersion(): string {
	if (app.isPackaged) return app.getVersion();
	try {
		return (JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')) as { version: string }).version;
	} catch {
		return app.getVersion();
	}
}
