import { resolve } from 'node:path';
import type { DevServerState } from '@codesigner/protocol';
import { DevServer, detectPackageManager } from '@codesigner/engine';
import { broadcast } from './ipc.js';

const servers = new Map<string, DevServer>();

function serverFor(worktree: string): DevServer {
	const key = resolve(worktree);
	let server = servers.get(key);
	if (!server) {
		server = new DevServer(key, detectPackageManager(key));
		server.on('state', (state) => broadcast('devserver:state', state));
		server.on('log', (log) => broadcast('devserver:log', log));
		servers.set(key, server);
	}
	return server;
}

export function startDevServer(worktree: string): Promise<DevServerState> {
	return serverFor(worktree).start();
}

export function stopDevServer(worktree: string) {
	servers.get(resolve(worktree))?.stop();
}

export function devServerState(worktree: string): DevServerState {
	return serverFor(worktree).state;
}

export function devServerLogs(worktree: string) {
	return serverFor(worktree).history;
}

export function stopAllDevServers() {
	for (const server of servers.values()) server.stop();
}
