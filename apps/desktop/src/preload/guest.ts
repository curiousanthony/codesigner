/**
 * Preload for canvas <webview>s (sandboxed, isolated world). It injects the
 * bridge into the page's main world and relays messages between the page and
 * the editor (host) over the webview IPC channel.
 */
import { ipcRenderer, webFrame } from 'electron';
import { BRIDGE_CHANNEL } from '@codesigner/protocol';
import { bridgeMain, type BridgeConfig } from './bridge-main';

const config: BridgeConfig = {
	toHost: 'codesigner:to-host',
	toGuest: 'codesigner:to-guest'
};

document.addEventListener(config.toHost, (event) => {
	const detail = (event as CustomEvent<string>).detail;
	if (typeof detail !== 'string') return;
	try {
		ipcRenderer.sendToHost(BRIDGE_CHANNEL, JSON.parse(detail));
	} catch {
		// malformed message from the page; ignore
	}
});

ipcRenderer.on(BRIDGE_CHANNEL, (_event, message) => {
	document.dispatchEvent(new CustomEvent(config.toGuest, { detail: JSON.stringify(message) }));
});

const inject = () => {
	void webFrame.executeJavaScript(`(${bridgeMain.toString()})(${JSON.stringify(config)});`);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true });
else inject();
