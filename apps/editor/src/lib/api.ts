import { m } from '#lib/paraglide/messages.js';
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

const TAG = /\s*\[cs:([a-z-]+)(?: (\{.*\}))?\]\s*$/;

/** The code of an engine error a designer may see (`[cs:code]` at the end of its message), if any. */
export function errorCode(error: unknown): string | null {
	const text = error instanceof Error ? error.message : String(error);
	return text.match(TAG)?.[1] ?? null;
}

/**
 * Error text without Electron's "Error invoking remote method 'x': Error:"
 * prefix; engine errors with a code are shown in the user's language.
 */
export function errorMessage(error: unknown): string {
	const text = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
	const tag = text.match(TAG);
	if (!tag) return text;
	const message = (m as unknown as Record<string, ((params: Record<string, string>) => string) | undefined>)[`err_${tag[1].replace(/-/g, '_')}`];
	let params: Record<string, string> = {};
	try {
		params = tag[2] ? JSON.parse(tag[2]) : {};
	} catch {
		// keep the English text
	}
	return message ? message(params) : text.replace(TAG, '');
}
