import { _electron as electron } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'codesigner-dbg-'));
const project = join(work, 'kit2-app');
execSync(`cp -cR ${join(repo, 'fixtures/kit2-app')} ${project}`);
const app = await electron.launch({
	args: [join(import.meta.dirname, '..', 'out/main/index.js')],
	env: { ...process.env, CODESIGNER_USER_DATA: join(work, 'ud'), CODESIGNER_EDITOR_URL: `http://localhost:${process.env.CODESIGNER_EDITOR_PORT ?? 5199}` }
});
const page = await app.firstWindow();
await page.waitForFunction(() => (window as any).__editor !== undefined);
await page.evaluate((root) => (window as any).__editor.openProject(root), project);
await page.waitForFunction(() => (window as any).__editor.frameReady.phone === true, null, { timeout: 90_000 });
await page.waitForTimeout(1000);
const sizes = await page.evaluate(async () =>
	Promise.all(
		Array.from(document.querySelectorAll('webview')).map(async (w: any) => ({
			el: [w.offsetWidth, w.offsetHeight],
			guest: await w.executeJavaScript('[innerWidth, innerHeight, devicePixelRatio, location.href]')
		}))
	)
);
console.log(JSON.stringify(sizes));
const r = await page.evaluate(async () => {
	const w = document.querySelector('webview') as any;
	return w.executeJavaScript(`fetch('/login', { method: 'POST', body: new URLSearchParams({ email: 'demo@codesigner.test', password: 'design-demo' }), headers: { 'x-sveltekit-action': 'true' } }).then(async r => [r.status, await r.text(), document.cookie])`);
});
console.log('action', JSON.stringify(r).slice(0, 400));
const cookies = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:preview').cookies.get({})).map((c) => [c.name, c.domain, c.sameSite, c.secure]));
console.log('cookies', JSON.stringify(cookies));
await app.close();
