/**
 * Dogfooding run against a real SvelteKit app.
 * Opens it in design-branch mode, logs in with the account documented in the
 * project's supabase/seed.sql ("-- email / password" comment),
 * navigates, selects layers, applies one edit and undoes it.
 * Run: TARGET=/path/to/app [PAGE=/some/route] node e2e/real-app.ts
 */
import { nativeShot } from './capture.ts';
import { _electron as electron, type Page } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.env.TARGET;
if (!target) throw new Error('Set TARGET=/path/to/your/sveltekit-app');
const shots = process.env.SHOTS ?? join(tmpdir(), 'codesigner-real-shots');
mkdirSync(shots, { recursive: true });
const userData = process.env.USER_DATA ?? join(tmpdir(), 'codesigner-real-ud');

// Local QA account documented in the project's own seed file ("-- email / password").
const seed = readFileSync(join(target, 'supabase/seed.sql'), 'utf8').match(/--\s*(\S+@\S+)\s*\/\s*(\S+)/);
if (!seed) throw new Error('No QA account found in supabase/seed.sql');
const [, email, password] = seed;

const log = (...args: unknown[]) => console.log('[real]', ...args);
const app = await electron.launch({
	args: [join(import.meta.dirname, '..', 'out/main/index.js')],
	env: { ...process.env, CODESIGNER_USER_DATA: userData, CODESIGNER_EDITOR_URL: `http://localhost:${process.env.CODESIGNER_EDITOR_PORT ?? 5199}` }
});
const page: Page = await app.firstWindow();
page.on('console', (msg) => msg.type() === 'error' && log('console error:', msg.text().slice(0, 200)));
await page.waitForFunction(() => (window as any).__editor !== undefined);
const shot = (name: string) => nativeShot(app, join(shots, `${name}.png`));
const E = <T>(fn: string) => page.evaluate(`(async () => { const e = window.__editor; ${fn} })()`) as Promise<T>;

const t0 = Date.now();
await page.evaluate((root) => (window as any).__editor.openProject(root), target);
// No design branch yet: start one from the default base (develop/main).
await E('if (e.startChoice) await e.startDesign(e.startChoice.defaultBase, "design-session")');
log('worktree', await E<string>('return e.worktree'));
await page.waitForFunction(() => ['ready', 'error'].includes((window as any).__editor.devServer?.status), null, { timeout: 420_000 });
log('dev server', await E('return e.devServer'), `${Math.round((Date.now() - t0) / 1000)}s`);
await page.waitForFunction(() => (window as any).__editor.frameReady.desktop === true, null, { timeout: 120_000 });
await page.waitForTimeout(2500);
log('desktop url', await page.evaluate(() => (document.querySelector('webview') as any).getURL()));
await shot('r01-first-load');

async function guestPoint(selector: string) {
	return page.evaluate(async (selector) => {
		const webview = document.querySelector('webview') as any;
		const r = await webview.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
		if (!r) return null;
		const host = webview.getBoundingClientRect();
		const scale = (window as any).__editor.camera.scale;
		return { x: host.left + r.x * scale, y: host.top + r.y * scale };
	}, selector);
}

const isLogin = await page.evaluate(() => (document.querySelector('webview') as any).getURL().includes('/auth'));
if (isLogin) {
	const guestId = await page.evaluate(() => (document.querySelector('webview') as any).getWebContentsId());
	const typeInGuest = (text: string) => app.evaluate(({ webContents }, { id, text }) => webContents.fromId(id)?.insertText(text), { id: guestId, text });
	await E('e.setMode("interact")');
	const emailPt = await guestPoint('input[type=email]');
	const passPt = await guestPoint('input[type=password]');
	if (!emailPt || !passPt) throw new Error('login inputs not found');
	await page.mouse.click(emailPt.x, emailPt.y);
	await typeInGuest(email);
	await page.mouse.click(passPt.x, passPt.y);
	await typeInGuest(password);
	await app.evaluate(({ webContents }, id) => {
		const g = webContents.fromId(id);
		g?.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
		g?.sendInputEvent({ type: 'char', keyCode: '\r' });
		g?.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
	}, guestId);
	await page.waitForFunction(() => !(document.querySelector('webview') as any).getURL().includes('/auth'), null, { timeout: 30_000 });
	await E('e.setMode("design")');
	log('logged in →', await page.evaluate(() => (document.querySelector('webview') as any).getURL()));
}
await page.waitForTimeout(3000);
await shot('r02-logged-in');

const route = process.env.PAGE ?? '/';
await page.evaluate((route) => (window as any).__editor.goTo(route), route);
await page.waitForFunction((route) => Array.from(document.querySelectorAll('webview')).every((w: any) => new URL(w.getURL()).pathname === route), route, { timeout: 30_000 });
await page.waitForTimeout(3000);
log('all frames on', await page.evaluate(() => Array.from(document.querySelectorAll('webview')).map((w: any) => new URL(w.getURL()).pathname)));
await E('await e.refreshTree()');
await page.waitForTimeout(1500);
log('routes', await E<number>('return e.routes.length'), 'components', await E<number>('return e.components.length'), 'tokens', await E<number>('return e.tokens?.tokens.length'));
const top = await E<string[]>('return (e.tree?.children ?? []).map(n => n.name + (n.isInstance ? "◇" : ""))');
log('top layers', top);
await shot('r03-page');

// Deep-select the page heading area and inspect it.
const heading = await guestPoint('main h1, h1');
if (heading) {
	await page.keyboard.down('Meta');
	await page.mouse.click(heading.x, heading.y);
	await page.keyboard.up('Meta');
	await page.waitForTimeout(800);
	log('heading path', await page.evaluate(async ({ x, y }) => {
		const e = (window as any).__editor;
		const webview = document.querySelector('webview') as any;
		const host = webview.getBoundingClientRect();
		const path = await e.frames.get('desktop').hit((x - host.left) / e.camera.scale, (y - host.top) / e.camera.scale);
		return (await e.frames.get('desktop').describe(path)).map((i: any) => i.name + ':' + i.kind + '@' + i.loc?.file + ':' + i.loc?.line);
	}, heading));
	log('deep selected', await E('return e.selection.infos.map(i => ({ name: i.name, kind: i.kind, loc: i.loc, cls: i.className.slice(0, 80) }))'));
	await shot('r04-heading-selected');
}

// Select a layout element from a route file and change its gap, then undo.
const candidate = await E<any>(`
	const find = (n) => { if (n.loc && n.loc.file.startsWith('src/routes') && (n.kind === 'stack-v' || n.kind === 'stack-h') && !n.isInstance) return n; for (const c of n.children) { const f = find(c); if (f) return f; } return null; };
	const node = e.tree ? find(e.tree) : null;
	if (!node) return null;
	await e.select('desktop', [node.id]);
	return { name: node.name, loc: node.loc };
`);
log('edit candidate', candidate);
if (candidate) {
	await page.waitForTimeout(600);
	await shot('r05-stack-selected');
	const worktree = await E<string>('return e.worktree');
	const info = await E<any>('return e.selected');
	const ok = await page.evaluate(
		(info) => (window as any).__editor.edit('Change gap', [{ type: 'classes', target: { ...info.loc, tag: info.tag }, remove: [], add: ['gap-[13px]'] }]),
		info
	);
	await page.waitForTimeout(2500);
	log('edit ok', ok, '\n', execSync('git diff --stat && git diff -U0 | head -20', { cwd: worktree, encoding: 'utf8' }));
	await shot('r06-after-edit');
	await E('await e.undo()');
	await page.waitForTimeout(1500);
	log('after undo, git status:', JSON.stringify(execSync('git status --porcelain', { cwd: worktree, encoding: 'utf8' })));
}

await app.close();
log('screenshots in', shots);
