// Renders icon.html to icon.png (1024×1024, transparent): `electron build/icon/render.cjs`.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
	const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
	const preview = process.argv.includes('--preview');
	await win.loadFile(join(__dirname, 'icon.html'), preview ? { hash: 'preview' } : {});
	await new Promise((r) => setTimeout(r, 800));
	const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
	writeFileSync(join(__dirname, preview ? 'preview.png' : 'icon.png'), image.toPNG());
	app.quit();
});
