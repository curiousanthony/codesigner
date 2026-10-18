import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { EventMap, InvokeArgs, InvokeMap, InvokeResult } from '@codesigner/protocol';
import { EDITOR_DEV_URL, isDev } from './env.js';

type Handler<K extends keyof InvokeMap> = (
	...args: InvokeArgs<K>
) => InvokeResult<K> | Promise<InvokeResult<K>>;

/** Only the editor UI may call into the main process — never a canvas webview. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
	const url = event.senderFrame?.url;
	if (!url) return false;
	const { protocol, origin } = new URL(url);
	if (protocol === 'app:') return true;
	return isDev && origin === new URL(EDITOR_DEV_URL).origin;
}

export function handle<K extends keyof InvokeMap>(channel: K, handler: Handler<K>) {
	ipcMain.handle(channel, async (event, ...args) => {
		if (!isTrustedSender(event)) throw new Error(`Blocked IPC call to ${channel} from untrusted frame`);
		return handler(...(args as InvokeArgs<K>));
	});
}

export function broadcast<K extends keyof EventMap>(channel: K, payload: EventMap[K]) {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(channel, payload);
	}
}
