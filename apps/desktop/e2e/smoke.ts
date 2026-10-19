/**
 * End-to-end smoke test: launches the real Electron app against a copy of the
 * Kit 2 fixture, logs in inside the canvas, selects layers and edits styles.
 * Run: node e2e/smoke.ts  (requires the editor dev server on :5199)
 */
import { nativeShot } from './capture.ts';
import { _electron as electron, type Page } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..', '..');
const shots = process.env.SHOTS ?? join(tmpdir(), 'codesigner-shots');
execSync(`mkdir -p ${shots}`);

const work = mkdtempSync(join(tmpdir(), 'codesigner-e2e-'));
const project = join(work, 'kit2-app');
execSync(`cp -cR ${join(repo, 'fixtures/kit2-app')} ${project}`);
const userData = join(work, 'user-data');

const app = await electron.launch({
	args: [join(import.meta.dirname, '..', 'out/main/index.js')],
	env: { ...process.env, CODESIGNER_USER_DATA: userData, CODESIGNER_EDITOR_URL: `http://localhost:${process.env.CODESIGNER_EDITOR_PORT ?? 5199}` }
});

const log = (...args: unknown[]) => console.log('[e2e]', ...args);
const page: Page = await app.firstWindow();
page.on('console', (msg) => msg.type() === 'error' && log('console error:', msg.text()));
await page.waitForFunction(() => (window as any).__editor !== undefined);
const shot = (name: string) => nativeShot(app, join(shots, `${name}.png`));
await shot('01-welcome');

await page.evaluate((root) => (window as any).__editor.openProject(root), project);
// First open: pick the branch to start designing from (the fixture repo only has `main`).
await page.waitForSelector('[aria-labelledby="start-design-title"]', { timeout: 15_000 });
log('start dialog branches:', await page.locator('[data-branch]').evaluateAll((els) => els.map((e) => e.getAttribute('data-branch'))));
await shot('01b-start-design');
await page.getByRole('button', { name: 'Start designing' }).click();
log('opened project, waiting for dev server');
await page.waitForFunction(() => (window as any).__editor.devServer?.status === 'ready', null, { timeout: 90_000 });
await page.waitForFunction(() => (window as any).__editor.frameReady.desktop === true, null, { timeout: 30_000 });
await page.waitForTimeout(800);
await shot('02-login-page');

async function guestRect(selector: string, frameIndex = 0) {
	return page.evaluate(
		async ({ selector, frameIndex }) => {
			const webview = document.querySelectorAll('webview')[frameIndex] as any;
			const r = await webview.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
			const host = webview.getBoundingClientRect();
			const scale = (window as any).__editor.camera.scale;
			return { x: host.left + (r.x + r.w / 2) * scale, y: host.top + (r.y + r.h / 2) * scale };
		},
		{ selector, frameIndex }
	);
}

// Log in inside the desktop frame like a user: Interact mode, click the fields, type.
await page.evaluate(() => (window as any).__editor.setMode('interact'));
const email = await guestRect('#email');
// Playwright's keyboard targets the host page; real typing goes to the focused guest,
// so send native input events to the desktop frame's webContents instead.
const guestId = await page.evaluate(() => (document.querySelector('webview') as any).getWebContentsId());
const typeInGuest = (text: string) =>
	app.evaluate(({ webContents }, { id, text }) => webContents.fromId(id)?.insertText(text), { id: guestId, text });
const pressInGuest = (keyCode: string) =>
	app.evaluate(({ webContents }, { id, keyCode }) => {
		const guest = webContents.fromId(id);
		guest?.sendInputEvent({ type: 'keyDown', keyCode });
		guest?.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode });
		guest?.sendInputEvent({ type: 'keyUp', keyCode });
	}, { id: guestId, keyCode });
await page.mouse.click(email.x, email.y);
await typeInGuest('demo@codesigner.test');
const password = await guestRect('#password');
await page.mouse.click(password.x, password.y);
await typeInGuest('design-demo');
await shot('02b-typed');
log('typed values', await page.evaluate(() => (document.querySelector('webview') as any).executeJavaScript(`[document.querySelector('#email').value, document.querySelector('#password').value.length, document.activeElement?.id]`)));
await pressInGuest('Enter');
await page.waitForFunction(
	() => !(document.querySelector('webview') as any).getURL().includes('/login'),
	null,
	{ timeout: 15_000 }
);
await page.evaluate(() => (window as any).__editor.setMode('design'));
log('logged in, desktop frame at', await page.evaluate(() => (document.querySelector('webview') as any).getURL()));
// The other breakpoints share the session: reload them and check they are past the login wall.
await page.evaluate(() => (window as any).__editor.goTo('/'));
await page.waitForTimeout(2500);
const urls = await page.evaluate(() => Array.from(document.querySelectorAll('webview')).map((w: any) => w.getURL()));
log('frame urls after login', urls);
await shot('03-logged-in');

// Hover + select the sidebar NavItem through the real gesture layer.

const nav = await guestRect('nav a');
log('nav point', nav, await page.evaluate(async ({ x, y }) => {
	const e = (window as any).__editor;
	const webview = document.querySelector('webview') as any;
	const host = webview.getBoundingClientRect();
	const gx = (x - host.left) / e.camera.scale, gy = (y - host.top) / e.camera.scale;
	const path = await e.frames.get('desktop').hit(gx, gy);
	const infos = await e.frames.get('desktop').describe(path);
	const at = await webview.executeJavaScript('(() => { const el = document.elementFromPoint(' + gx + ',' + gy + '); return el ? el.outerHTML.slice(0, 120) + " meta:" + JSON.stringify(el.__svelte_meta && el.__svelte_meta.loc) : null })()');
	return { gx, gy, host: [host.left, host.top, host.width], scale: e.camera.scale, names: infos.map((i: any) => i.name + ':' + i.kind), at };
}, nav));
await page.mouse.move(nav.x, nav.y);
await page.keyboard.down('Meta');
await page.mouse.click(nav.x, nav.y);
await page.keyboard.up('Meta');
await page.waitForTimeout(600);
const selected = await page.evaluate(() => {
	const e = (window as any).__editor;
	return e.selection.infos.map((i: any) => ({ kind: i.kind, name: i.name, loc: i.loc, tag: i.tag }));
});
log('deep-selected', JSON.stringify(selected));
await shot('04-select-navitem');

// Framer levels: plain click selects the top level, double click drills.
await page.evaluate(() => (window as any).__editor.clearSelection());
await page.mouse.click(nav.x, nav.y);
await page.waitForTimeout(400);
const level1 = await page.evaluate(() => (window as any).__editor.selection.infos.map((i: any) => i.name));
await page.mouse.dblclick(nav.x, nav.y);
await page.waitForTimeout(400);
const level2 = await page.evaluate(() => (window as any).__editor.selection.infos.map((i: any) => i.name));
log('click →', level1, ' double-click →', level2);

// Select the <nav> element and change its gap in the Style panel.
const navEl = await guestRect('nav');
await page.evaluate(() => (window as any).__editor.clearSelection());
const navHit = await page.evaluate(async ({ x, y }) => {
	const e = (window as any).__editor;
	const webview = document.querySelector('webview') as any;
	const host = webview.getBoundingClientRect();
	const path = await e.frames.get('desktop').hit((x - host.left) / e.camera.scale, (y - host.top) / e.camera.scale);
	return path;
}, navEl);
// Deep-select nav by walking the path for a 'Nav' layer.
await page.evaluate(async (path) => {
	const e = (window as any).__editor;
	const infos = await e.frames.get('desktop').describe(path);
	const navInfo = infos.find((i: any) => i.tag === 'nav');
	await e.select('desktop', [navInfo.id], { [navInfo.id]: path.slice(0, path.indexOf(navInfo.id) + 1) });
}, navHit);
await page.waitForTimeout(400);
await shot('05-nav-selected');

const layout = join(project, 'src/routes/(app)/+layout.svelte');
const before = readFileSync(layout, 'utf8');
const gapField = page.locator('input[aria-label="Gap"]');
const box = await gapField.boundingBox();
if (!box) throw new Error('Gap field not found');
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.press('Meta+A');
await page.keyboard.type('12');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const after = readFileSync(layout, 'utf8');
const changed = after.split('\n').filter((line, i) => line !== before.split('\n')[i]);
log('layout diff lines:', changed);
await shot('06-gap-changed');

// Wrap two cards in a Stack with S.
await page.evaluate(() => (window as any).__editor.goTo('/'));
await page.waitForTimeout(2000);
const page1 = join(project, 'src/routes/(app)/+page.svelte');
const beforePage = readFileSync(page1, 'utf8');
await page.evaluate(async () => {
	const e = (window as any).__editor;
	await e.refreshTree();
	await new Promise((r) => setTimeout(r, 500));
	const find = (n: any, pred: (n: any) => boolean): any => (pred(n) ? n : n.children.map((c: any) => find(c, pred)).find(Boolean));
	const header = find(e.tree, (n: any) => n.tag === 'header');
	await e.select('desktop', header.children.map((c: any) => c.id));
});
await page.waitForTimeout(400);
await page.keyboard.press('Shift+A');
await page.waitForTimeout(1500);
const afterPage = readFileSync(page1, 'utf8');
log('wrapped:', afterPage.includes('<div class="flex flex-col gap-2">'));
log(afterPage.split('\n').slice(9, 18).join('\n'));
await shot('07-wrapped');

// Undo via menu command path.
await page.evaluate(() => (window as any).__editor.undo());
await page.waitForTimeout(800);
log('undo restored bytes:', readFileSync(page1, 'utf8') === beforePage);

await page.evaluate(() => ((window as any).__editor.leftTab = 'pages'));
await page.waitForTimeout(300);
await shot('08-pages');
await page.evaluate(() => ((window as any).__editor.leftTab = 'assets'));
await page.waitForTimeout(300);
await shot('09-assets');

// Pages panel: open the dynamic route by entering a sample value.
await page.evaluate(() => ((window as any).__editor.leftTab = 'pages'));
await page.waitForTimeout(300);
await page.getByText('/projects/', { exact: false }).filter({ hasText: '[slug]' }).first().click();
await page.waitForTimeout(300);
const slugInput = page.locator('form input').first();
await slugInput.fill('billing-revamp');
await shot('10a-slug-form');
log('slug form inputs', await page.locator('form input').count(), 'value', await slugInput.inputValue());
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.waitForTimeout(2000);
log('urls after Open', await page.evaluate(() => Array.from(document.querySelectorAll('webview')).map((w: any) => w.getURL())), 'currentPath', await page.evaluate(() => (window as any).__editor.currentPath));
await page.waitForFunction(() => Array.from(document.querySelectorAll('webview')).every((w: any) => w.getURL().endsWith('/projects/billing-revamp')), null, { timeout: 15_000 });
log('slug route opened in all frames:', true);
await shot('10-slug-route');

// --- Framer parity checks (layers ↔ canvas, breakpoints, code panel, component canvas)
await page.evaluate(() => (window as any).__editor.goTo('/'));
await page.waitForTimeout(2500);
const parity = await page.evaluate(async () => {
	const e = (window as any).__editor;
	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const out: Record<string, unknown> = {};
	// Every breakpoint has its own layer tree.
	out.trees = Object.keys(e.trees).sort().join(',');
	// Selecting from the Phone tree outlines it in Phone and mirrors it into the other frames.
	const find = (n: any, pred: (n: any) => boolean): any => (pred(n) ? n : n.children.map((c: any) => find(c, pred)).find(Boolean));
	const header = find(e.trees.phone, (n: any) => n.tag === 'header');
	await e.select('phone', [header.id]);
	await wait(800);
	out.rects = Object.entries(e.selectedRects).map(([f, r]: any) => `${f}:${Object.keys(r).length}`).sort().join(',');
	return out;
});
log('parity', JSON.stringify(parity));

// Phone edit through the Style panel: Framer cascade → base for Phone, md: pin for larger frames.
const pagePath = join(project, 'src/routes/(app)/+page.svelte');
const pageBefore = readFileSync(pagePath, 'utf8');
await page.evaluate(async () => {
	const e = (window as any).__editor;
	const ids = await e.frames.get('phone').findLoc({ file: 'src/routes/(app)/+page.svelte', line: 17, column: 1, tag: 'section' });
	await e.select('phone', ids.slice(0, 1));
});
await page.waitForTimeout(600);
const gap2 = await page.locator('input[aria-label="Gap"]').boundingBox();
if (gap2) {
	await page.mouse.click(gap2.x + gap2.width / 2, gap2.y + gap2.height / 2);
	await page.keyboard.press('Meta+A');
	await page.keyboard.type('8');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(1500);
}
log('phone edit:', readFileSync(pagePath, 'utf8').split('\n').find((l) => l.includes('<section')));
log('selection kept after Enter:', await page.evaluate(() => (window as any).__editor.selected?.tag));
await page.evaluate(() => (window as any).__editor.undo());
await page.waitForTimeout(800);
log('phone edit undone:', readFileSync(pagePath, 'utf8') === pageBefore);

// Code panel follows the selection.
await page.evaluate(() => ((window as any).__editor.codeOpen = true));
await page.waitForTimeout(800);
log('code panel line:', await page.evaluate(() => document.querySelector('.cm-cd-selected')?.textContent?.trim()));
await page.evaluate(() => ((window as any).__editor.codeOpen = false));

// Component canvas for the shadcn Button.
await page.evaluate(async () => {
	const e = (window as any).__editor;
	await e.editComponent(e.components.find((c: any) => c.name === 'Button'));
});
await page.waitForFunction(() => ((window as any).__editor.trees.component?.children.length ?? 0) > 10, null, { timeout: 20_000 });
log('component cells:', await page.evaluate(() => (window as any).__editor.trees.component.children.length));
await shot('11-component-canvas');
await page.evaluate(() => (window as any).__editor.exitComponent());
await page.waitForTimeout(1500);

await app.close();

// Restart with the same profile: the session must survive.
const app2 = await electron.launch({
	args: [join(import.meta.dirname, '..', 'out/main/index.js')],
	env: { ...process.env, CODESIGNER_USER_DATA: userData, CODESIGNER_EDITOR_URL: `http://localhost:${process.env.CODESIGNER_EDITOR_PORT ?? 5199}` }
});
const page2 = await app2.firstWindow();
await page2.waitForFunction(() => (window as any).__editor?.appInfo);
await page2.evaluate((root) => (window as any).__editor.openProject(root), project);
await page2.waitForFunction(() => (window as any).__editor.frameReady.desktop === true, null, { timeout: 90_000 });
await page2.waitForTimeout(1500);
const restartedUrl = await page2.evaluate(() => (document.querySelector('webview') as any).getURL());
log('after restart, desktop frame at', restartedUrl, '→ still logged in:', !restartedUrl.includes('/login'));
await app2.close();
log('screenshots in', shots);
