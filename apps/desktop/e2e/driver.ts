/**
 * Interactive driver: launches the Electron app and exposes a tiny local HTTP
 * API so a developer (or an agent) can use the app step by step.
 *
 *   node e2e/driver.ts [projectDir]        (editor dev server must be running)
 *   curl -s localhost:7457/shot?name=a      → screenshot path
 *   curl -s localhost:7457/eval -d 'window.__editor.mode'
 *   curl -s localhost:7457/click -d '{"x":10,"y":20,"meta":true}'
 *
 * Every request needs the `x-driver-token` header (the token is written to
 * $DRIVER_HOME/token) and requests carrying an Origin are refused, so web pages
 * can't reach this API. The profile lives in $DRIVER_HOME (default: a temp dir)
 * so logins persist between driver runs.
 */
import { _electron as electron, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..', '..');
const home = process.env.DRIVER_HOME ?? join(tmpdir(), 'codesigner-driver');
const shots = join(home, 'shots');
mkdirSync(shots, { recursive: true });

let project = process.argv[2];
if (!project) {
	project = join(home, 'kit2-app');
	if (!existsSync(project)) {
		execSync(`cp -cR ${join(repo, 'fixtures/kit2-app')} ${project}`);
		execSync('git init -q -b main && git add -A && git commit -qm init', { cwd: project });
	}
}

const port = Number(process.env.DRIVER_PORT ?? 7457);
const token = randomBytes(24).toString('hex');
writeFileSync(join(home, 'token'), token, { mode: 0o600 });
const app = await electron.launch({
	args: [...(process.env.DRIVER_ARGS?.split(' ').filter(Boolean) ?? []), join(import.meta.dirname, '..', 'out/main/index.js')],
	env: {
		...process.env,
		CODESIGNER_USER_DATA: process.env.DRIVER_USER_DATA ?? join(home, 'user-data'),
		CODESIGNER_EDITOR_URL: `http://localhost:${process.env.CODESIGNER_EDITOR_PORT ?? 5199}`
	}
});
const page: Page = await app.firstWindow();
const consoleLog: string[] = [];
page.on('console', (msg) => {
	consoleLog.push(`[${msg.type()}] ${msg.text()}`);
	if (consoleLog.length > 300) consoleLog.shift();
});
await page.waitForFunction(() => (window as any).__editor !== undefined);
if (process.env.DRIVER_NO_OPEN !== '1') {
	await page.evaluate((root) => (window as any).__editor.openProject(root), project);
}

async function body(req: import('node:http').IncomingMessage): Promise<string> {
	let data = '';
	for await (const chunk of req) data += chunk;
	return data;
}

/** Native input to the focused guest (Playwright's keyboard targets the host page). */
async function guestInput(text: string | undefined, key: string | undefined, frame = 0) {
	const id = await page.evaluate((i) => (document.querySelectorAll('webview')[i] as any).getWebContentsId(), frame);
	await app.evaluate(
		({ webContents }, { id, text, key }) => {
			const guest = webContents.fromId(id);
			if (text) guest?.insertText(text);
			if (key) {
				guest?.sendInputEvent({ type: 'keyDown', keyCode: key });
				guest?.sendInputEvent({ type: 'char', keyCode: key === 'Enter' ? '\r' : key });
				guest?.sendInputEvent({ type: 'keyUp', keyCode: key });
			}
		},
		{ id, text, key }
	);
}

const server = createServer(async (req, res) => {
	// A custom header forces a CORS preflight (which we never answer) and browsers always send Origin.
	if (req.headers.origin || req.headers['x-driver-token'] !== token) {
		res.statusCode = 403;
		res.end('forbidden');
		return;
	}
	const url = new URL(req.url ?? '/', 'http://x');
	try {
		let out: unknown = 'ok';
		const raw = req.method === 'POST' ? await body(req) : '';
		const json = () => (raw ? JSON.parse(raw) : {});
		switch (url.pathname) {
			case '/shot': {
				const name = url.searchParams.get('name') ?? `shot-${Date.now()}`;
				const path = join(shots, `${name}.png`);
				// Native capture: Playwright's CDP screenshots misrender <webview> guests under zoom.
				const clip = url.searchParams.get('clip')?.split(',').map(Number);
				const png = await app.evaluate(async ({ BrowserWindow }, clip) => {
					const win = BrowserWindow.getAllWindows()[0];
					const image = await win.webContents.capturePage(clip ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } : undefined);
					return image.toPNG().toString('base64');
				}, clip ?? null);
				writeFileSync(path, Buffer.from(png, 'base64'));
				out = path;
				break;
			}
			case '/eval':
				out = await page.evaluate(`(async () => (${raw}))()`);
				break;
			case '/run':
				out = await page.evaluate(`(async () => { ${raw} })()`);
				break;
			case '/main':
				out = await app.evaluate(new Function('electron', `return (async () => { ${raw} })()`) as any);
				break;
			case '/click':
			case '/dblclick':
			case '/move': {
				const { x, y, meta, shift, alt } = json();
				const mods = [meta && 'Meta', shift && 'Shift', alt && 'Alt'].filter(Boolean) as string[];
				for (const m of mods) await page.keyboard.down(m);
				if (url.pathname === '/move') await page.mouse.move(x, y);
				else if (url.pathname === '/click') await page.mouse.click(x, y);
				else await page.mouse.dblclick(x, y);
				for (const m of mods.reverse()) await page.keyboard.up(m);
				break;
			}
			case '/press':
				await page.keyboard.press(raw.trim());
				break;
			case '/type':
				await page.keyboard.type(raw);
				break;
			case '/guest-type':
				await guestInput(raw, undefined, Number(url.searchParams.get('frame') ?? 0));
				break;
			case '/guest-key':
				await guestInput(undefined, raw.trim(), Number(url.searchParams.get('frame') ?? 0));
				break;
			case '/locate': {
				// Bounding box of a host element by CSS selector or aria-label.
				const box = await page.locator(raw.trim()).first().boundingBox();
				out = box;
				break;
			}
			case '/console':
				out = consoleLog.splice(0);
				break;
			case '/quit':
				res.end('bye');
				await app.close();
				process.exit(0);
			default:
				res.statusCode = 404;
				out = 'unknown';
		}
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(out, null, 1));
	} catch (error) {
		res.statusCode = 500;
		res.end(String((error as Error)?.stack ?? error));
	}
});
server.listen(port, '127.0.0.1', () => console.log(`[driver] listening on http://127.0.0.1:${port} — project ${project}, shots in ${shots}`));
app.on('close', () => process.exit(0));
