import { contextBridge, ipcRenderer } from 'electron';
import {
	EVENT_CHANNELS,
	INVOKE_CHANNELS,
	type CodesignerApi,
	type EventMap,
	type InvokeMap
} from '@codesigner/protocol';

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api: CodesignerApi = {
	invoke(channel, ...args) {
		if (!invokeChannels.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
		return ipcRenderer.invoke(channel, ...args);
	},
	on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void) {
		if (!eventChannels.has(channel)) throw new Error(`Unknown event ${channel}`);
		const wrapped = (_event: Electron.IpcRendererEvent, payload: EventMap[K]) => listener(payload);
		ipcRenderer.on(channel, wrapped);
		return () => ipcRenderer.off(channel, wrapped);
	}
};

contextBridge.exposeInMainWorld('codesigner', api);

export type { InvokeMap };
