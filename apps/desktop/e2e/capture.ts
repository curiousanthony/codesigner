import type { ElectronApplication } from 'playwright-core';
import { writeFileSync } from 'node:fs';

/**
 * Screenshot of the editor window through Electron's own compositor.
 * Playwright's CDP screenshots misrender <webview> guests (blank or cut frames).
 */
export async function nativeShot(app: ElectronApplication, path: string) {
	const png = await app.evaluate(async ({ BrowserWindow }) => {
		const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
		return image.toPNG().toString('base64');
	});
	writeFileSync(path, Buffer.from(png, 'base64'));
}
