/**
 * Dev loop: the editor UI (SvelteKit) runs its own Vite server on :5199 with HMR;
 * electron-vite builds and hot-restarts the main process and preloads.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
// CODESIGNER_EDITOR_PORT lets several checkouts run side by side.
const EDITOR_PORT = process.env.CODESIGNER_EDITOR_PORT ?? '5199';
const EDITOR_URL = `http://localhost:${EDITOR_PORT}`;
const children: ChildProcess[] = [];

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
	const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
	children.push(child);
	child.on('exit', (code) => {
		if (code !== 0 && code !== null) console.error(`${cmd} ${args.join(' ')} exited with ${code}`);
		shutdown();
	});
	return child;
}

async function waitFor(url: string, timeoutMs = 60_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			await fetch(url);
			return;
		} catch {
			await Bun.sleep(300);
		}
	}
	throw new Error(`Timed out waiting for ${url}`);
}

let stopping = false;
function shutdown() {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill('SIGTERM');
	process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('bun', ['run', 'dev'], join(root, 'apps', 'editor'), { CODESIGNER_EDITOR_PORT: EDITOR_PORT });
await waitFor(EDITOR_URL);
run('bunx', ['electron-vite', 'dev', '--watch'], join(root, 'apps', 'desktop'), { CODESIGNER_EDITOR_URL: EDITOR_URL });
