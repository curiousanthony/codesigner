import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { DevServerLog, DevServerState, PackageManager } from '@codesigner/protocol';

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const LOCAL_URL = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)\/?)/;

export async function findFreePort(start = 5300, end = 5999): Promise<number> {
	for (let port = start; port <= end; port++) {
		const free = await new Promise<boolean>((resolve) => {
			const server = createServer();
			server.once('error', () => resolve(false));
			server.once('listening', () => server.close(() => resolve(true)));
			server.listen(port, 'localhost');
		});
		if (free) return port;
	}
	throw new Error(`No free port between ${start} and ${end}`);
}

/** Command used to run the project's dev script with an explicit port. */
export function devCommand(pm: PackageManager, port: number): { cmd: string; args: string[] } {
	const viteArgs = ['--port', String(port), '--strictPort', '--host', 'localhost'];
	switch (pm) {
		case 'bun':
			return { cmd: 'bun', args: ['run', 'dev', ...viteArgs] };
		case 'pnpm':
			return { cmd: 'pnpm', args: ['run', 'dev', ...viteArgs] };
		case 'yarn':
			return { cmd: 'yarn', args: ['run', 'dev', ...viteArgs] };
		default:
			return { cmd: 'npm', args: ['run', 'dev', '--', ...viteArgs] };
	}
}

export function installCommand(pm: PackageManager): { cmd: string; args: string[] } {
	return { cmd: pm, args: ['install'] };
}

export interface DevServerEvents {
	state: [DevServerState];
	log: [DevServerLog];
}

/** Runs and supervises one project's dev server (one per working copy). */
export class DevServer extends EventEmitter<DevServerEvents> {
	private child: ChildProcess | null = null;
	private logs: DevServerLog[] = [];
	private _state: DevServerState;
	private readyTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly worktree: string,
		private readonly pm: PackageManager,
		private readonly env: NodeJS.ProcessEnv = process.env
	) {
		super();
		this._state = { worktree, status: 'idle', url: null, port: null };
	}

	get state() {
		return this._state;
	}

	get history() {
		return this.logs;
	}

	private setState(patch: Partial<DevServerState>) {
		this._state = { ...this._state, ...patch };
		this.emit('state', this._state);
	}

	private log(stream: DevServerLog['stream'], text: string) {
		const entry: DevServerLog = { worktree: this.worktree, stream, text, at: Date.now() };
		this.logs.push(entry);
		if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
		this.emit('log', entry);
	}

	private run(cmd: string, args: string[]) {
		return spawn(cmd, args, {
			cwd: this.worktree,
			env: { ...this.env, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' },
			// Own process group on POSIX so the whole tree can be killed at once.
			detached: process.platform !== 'win32',
			shell: process.platform === 'win32',
			stdio: ['ignore', 'pipe', 'pipe']
		});
	}

	async ensureDependencies(): Promise<void> {
		if (existsSync(join(this.worktree, 'node_modules'))) return;
		this.setState({ status: 'installing' });
		const { cmd, args } = installCommand(this.pm);
		this.log('system', `$ ${cmd} ${args.join(' ')}`);
		await new Promise<void>((resolve, reject) => {
			const child = this.run(cmd, args);
			child.stdout?.on('data', (d) => this.log('stdout', String(d).replace(ANSI, '')));
			child.stderr?.on('data', (d) => this.log('stderr', String(d).replace(ANSI, '')));
			child.on('error', reject);
			child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} install exited with ${code}`))));
		});
	}

	async start(): Promise<DevServerState> {
		if (this.child && ['starting', 'ready'].includes(this._state.status)) return this._state;
		try {
			await this.ensureDependencies();
		} catch (error) {
			this.setState({ status: 'error', error: (error as Error).message });
			return this._state;
		}

		const port = await findFreePort();
		const { cmd, args } = devCommand(this.pm, port);
		this.setState({ status: 'starting', port, url: null, error: undefined });
		this.log('system', `$ ${cmd} ${args.join(' ')}`);

		const child = this.run(cmd, args);
		this.child = child;

		const onOutput = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
			const text = String(chunk).replace(ANSI, '');
			this.log(stream, text);
			if (this._state.status !== 'ready') {
				const match = text.match(LOCAL_URL);
				if (match) this.markReady(Number(match[2]));
			}
		};
		child.stdout?.on('data', onOutput('stdout'));
		child.stderr?.on('data', onOutput('stderr'));
		child.on('error', (error) => this.setState({ status: 'error', error: error.message }));
		child.on('exit', (code, signal) => {
			if (this.child !== child) return;
			this.child = null;
			const expected = this._state.status === 'stopped';
			this.log('system', `Dev server exited (${signal ?? code})`);
			if (!expected) this.setState({ status: 'error', error: `Dev server exited with ${signal ?? code}` });
		});

		// Fallback when the dev script prints nothing parsable: poll the port.
		this.readyTimer = setTimeout(() => this.pollPort(port, 60), 1500);
		return this._state;
	}

	private markReady(port: number) {
		if (this.readyTimer) clearTimeout(this.readyTimer);
		this.setState({ status: 'ready', port, url: `http://localhost:${port}` });
	}

	private async pollPort(port: number, attempts: number) {
		if (this._state.status !== 'starting') return;
		try {
			await fetch(`http://localhost:${port}/`, { method: 'HEAD', redirect: 'manual' });
			this.markReady(port);
		} catch {
			if (attempts > 0) this.readyTimer = setTimeout(() => this.pollPort(port, attempts - 1), 1000);
		}
	}

	stop() {
		if (this.readyTimer) clearTimeout(this.readyTimer);
		const child = this.child;
		this.setState({ status: 'stopped', url: null });
		if (!child?.pid) return;
		this.child = null;
		killTree(child.pid);
	}
}

export function killTree(pid: number) {
	try {
		if (process.platform === 'win32') {
			spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
		} else {
			process.kill(-pid, 'SIGTERM');
			setTimeout(() => {
				try {
					process.kill(-pid, 'SIGKILL');
				} catch {
					// already gone
				}
			}, 3000).unref();
		}
	} catch {
		// process already exited
	}
}
