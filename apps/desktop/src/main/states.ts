import { webContents } from 'electron';

type Rule = { selector: string; states: string[] };
const ALLOWED = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within']);

/** Nodes forced in each guest, by DevTools node id (valid until the next DOM.getDocument). */
const forced = new Map<number, number[]>();

/**
 * Forces CSS pseudo-classes on elements of a canvas frame through the DevTools
 * protocol, so the component canvas can show Hover / Pressed cells side by side.
 * Only canvas guests (webviews) are accepted. Returns false when the debugger
 * can't attach (e.g. the frame's DevTools are open).
 */
export async function forceStates(id: number, rules: Rule[]): Promise<boolean> {
	const guest = webContents.fromId(id);
	if (!guest || guest.getType() !== 'webview') return false;
	const dbg = guest.debugger;
	try {
		if (!dbg.isAttached()) dbg.attach('1.3');
		await dbg.sendCommand('DOM.enable');
		await dbg.sendCommand('CSS.enable');
		// Getting the document again invalidates node ids: clear what we forced while they're still valid,
		// or those elements would stay stuck in :hover.
		for (const nodeId of forced.get(id) ?? []) {
			await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => undefined);
		}
		forced.set(id, []);
		const { root } = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
		const now: number[] = [];
		for (const rule of rules) {
			const states = rule.states.filter((s) => ALLOWED.has(s));
			const { nodeIds } = (await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: rule.selector })) as { nodeIds: number[] };
			for (const nodeId of nodeIds) {
				await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
				if (states.length) now.push(nodeId);
			}
		}
		forced.set(id, now);
		return true;
	} catch {
		forced.delete(id);
		return false;
	}
}
