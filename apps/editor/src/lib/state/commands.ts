import type { SourceLoc } from '@codesigner/protocol';
import { editor } from './editor.svelte.js';
import { m } from '#lib/paraglide/messages.js';

/** Default markup for inserted layers (Framer's defaults, as Tailwind). */
export const INSERT_MARKUP = {
	stack: '<div class="flex flex-col gap-2.5 p-2.5"></div>',
	frame: '<div class="h-24 w-40 rounded-lg bg-muted"></div>',
	grid: '<div class="grid grid-cols-2 gap-2.5 p-2.5"></div>',
	text: '<p>Text</p>'
} as const;

const targets = (): (SourceLoc & { tag: string })[] =>
	editor.selection.infos.filter((i) => i.loc && i.editable).map((i) => ({ ...i.loc!, tag: i.componentTag ?? i.tag }));

function requireSelection(): boolean {
	if (targets().length === 0) {
		editor.toast(m.cmd_select_first());
		return false;
	}
	return true;
}

/** Wraps the selection in a new Stack (S / ⌘⌥↩) or Frame (⌘↩). */
export async function wrapSelection(kind: 'stack' | 'frame' | 'grid' = 'stack') {
	if (!requireSelection()) return;
	const list = targets();
	const className = kind === 'stack' ? 'flex flex-col gap-2' : kind === 'grid' ? 'grid grid-cols-2 gap-2' : 'relative';
	const first = [...list].sort((a, b) => a.line - b.line || a.column - b.column)[0];
	const ok = await editor.edit(kind === 'stack' ? m.edit_wrap_stack() : m.edit_wrap_frame(), [
		{ type: 'wrap', targets: list, tag: 'div', className }
	]);
	if (ok) pendingSelect({ file: first.file, line: first.line, column: first.column, tag: 'div' });
}

/** Inserts a new layer inside the selected container (or after the selection for leaf layers). */
export async function insertLayer(kind: keyof typeof INSERT_MARKUP) {
	const info = editor.selected;
	if (!info?.loc || !info.editable) {
		editor.toast(m.cmd_select_container());
		return;
	}
	const container = info.kind === 'element' && !/^(img|input|br|hr|svg|p|span|h[1-6]|a|button|label)$/.test(info.tag);
	const label = m.edit_insert({ kind });
	if (container) {
		await editor.edit(label, [{ type: 'insert', parent: { ...info.loc, tag: info.tag }, index: -1, markup: INSERT_MARKUP[kind] }]);
	} else {
		// Leaf: duplicate-free sibling insert isn't addressable yet, so insert into its parent's end.
		editor.toast(m.cmd_select_container());
	}
}

export async function unwrapSelection() {
	const info = editor.selected;
	if (!info?.loc || info.kind !== 'element') return;
	await editor.edit(m.edit_unwrap(), [{ type: 'unwrap', target: { ...info.loc, tag: info.tag } }]);
}

export async function deleteSelection() {
	if (!requireSelection()) return;
	const list = targets();
	const ok = await editor.edit(m.edit_delete(), [{ type: 'remove', targets: list }]);
	if (ok) editor.clearSelection();
}

export async function duplicateSelection() {
	if (!requireSelection()) return;
	await editor.edit(m.edit_duplicate(), [{ type: 'duplicate', targets: targets() }]);
}

/** After an edit that creates a layer, select it once the page has hot-reloaded. */
function pendingSelect(loc: SourceLoc) {
	const frameId = editor.selection.frameId ?? editor.primaryFrameId;
	if (!frameId) return;
	const frame = editor.frames.get(frameId);
	if (!frame) return;
	const off = frame.subscribe(async (message) => {
		if (message.type !== 'dom-changed' || message.reason !== 'hmr') return;
		off();
		await new Promise((r) => setTimeout(r, 60));
		const ids = await frame.findLoc(loc);
		if (ids.length) {
			await editor.refreshTree();
			setTimeout(() => void editor.select(frameId, [ids[0]]), 120);
		}
	});
	setTimeout(off, 4000);
}
