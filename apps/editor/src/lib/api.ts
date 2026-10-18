import type { CodesignerApi, EventMap, InvokeArgs, InvokeMap, InvokeResult } from '@codesigner/protocol';

/** True when running inside the Electron shell (window.codesigner is exposed by the preload). */
export const inDesktop = typeof window !== 'undefined' && !!window.codesigner;

function bridge(): CodesignerApi {
	if (!window.codesigner) throw new Error('Codesigner desktop APIs are unavailable (running in a plain browser).');
	return window.codesigner;
}

export function invoke<K extends keyof InvokeMap>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>> {
	// Svelte $state values are Proxies, which Electron's structured clone rejects;
	// every IPC payload is plain JSON, so round-trip it.
	const plain = JSON.parse(JSON.stringify(args)) as InvokeArgs<K>;
	return bridge().invoke(channel, ...plain);
}

export function on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void): () => void {
	if (!inDesktop) return () => {};
	return bridge().on(channel, listener);
}

/** Error text without Electron's "Error invoking remote method 'x': Error:" prefix. */
export function errorMessage(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
