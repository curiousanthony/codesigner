import {
	BRIDGE_CHANNEL,
	type DropTarget,
	type ElementInfo,
	type GuestToHost,
	type HostToGuest,
	type NodeId,
	type SourceLoc
} from '@codesigner/protocol';

type WebviewLike = HTMLElement & {
	send(channel: string, ...args: unknown[]): void;
	addEventListener(type: 'ipc-message', listener: (event: Event & { channel: string; args: unknown[] }) => void): void;
	removeEventListener(type: 'ipc-message', listener: (event: Event & { channel: string; args: unknown[] }) => void): void;
};

type Pending = { resolve: (value: GuestToHost) => void; timer: ReturnType<typeof setTimeout> };
type Requestable = Extract<HostToGuest, { reqId: number }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Talks to the in-page bridge of one canvas frame. */
export class BridgeClient {
	private seq = 0;
	private pending = new Map<number, Pending>();
	private listeners = new Set<(message: GuestToHost) => void>();
	private onIpc = (event: Event & { channel: string; args: unknown[] }) => {
		if (event.channel !== BRIDGE_CHANNEL) return;
		const message = event.args[0] as GuestToHost;
		if ('reqId' in message) {
			const waiting = this.pending.get(message.reqId);
			if (waiting) {
				clearTimeout(waiting.timer);
				this.pending.delete(message.reqId);
				waiting.resolve(message);
			}
		}
		for (const listener of this.listeners) listener(message);
	};
	ready = false;

	constructor(
		readonly frameId: string,
		private readonly webview: WebviewLike
	) {
		webview.addEventListener('ipc-message', this.onIpc);
	}

	dispose() {
		this.webview.removeEventListener('ipc-message', this.onIpc);
		for (const { timer } of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
		this.listeners.clear();
	}

	subscribe(listener: (message: GuestToHost) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	send(message: HostToGuest) {
		// Messages often carry $state proxies, which structured clone rejects: send plain data.
		const plain = JSON.parse(JSON.stringify(message)) as HostToGuest;
		try {
			this.webview.send(BRIDGE_CHANNEL, plain);
		} catch (error) {
			if (!String(error).includes('attached')) console.warn('[bridge] send failed', message.type, error);
		}
	}

	private request<T extends GuestToHost>(message: DistributiveOmit<Requestable, 'reqId'>, timeout = 1500): Promise<T | null> {
		const reqId = ++this.seq;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(reqId);
				resolve(null);
			}, timeout);
			this.pending.set(reqId, { resolve: (value) => resolve(value as T), timer });
			this.send({ ...message, reqId } as HostToGuest);
		});
	}

	async hit(x: number, y: number): Promise<NodeId[]> {
		const reply = await this.request<Extract<GuestToHost, { type: 'hit-result' }>>({ type: 'hit', x, y }, 800);
		return reply?.path ?? [];
	}

	/** Gives the frame keyboard focus (for typing into a text layer edited in place). */
	focus() {
		this.webview.focus();
	}

	async dropTarget(x: number, y: number): Promise<DropTarget | null> {
		const reply = await this.request<Extract<GuestToHost, { type: 'drop-result' }>>({ type: 'drop-target', x, y }, 800);
		return reply?.target ?? null;
	}

	async describe(ids: NodeId[]): Promise<ElementInfo[]> {
		if (ids.length === 0) return [];
		const reply = await this.request<Extract<GuestToHost, { type: 'described' }>>({ type: 'describe', ids });
		return reply?.elements ?? [];
	}

	async findLoc(loc: SourceLoc): Promise<NodeId[]> {
		const reply = await this.request<Extract<GuestToHost, { type: 'found-loc' }>>({ type: 'find-loc', loc });
		return reply?.ids ?? [];
	}
}
