import type { DropTarget, SourceLoc } from '@codesigner/protocol';
import { editor, type DrawTool } from './editor.svelte.js';
import { spacing } from '#lib/style/tailwind-map.js';
import { invoke } from '#lib/api.js';
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

/** Wraps the selection in a new Stack (⇧A / ⌘⌥↩) or Frame (⌘↩). */
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

/** Classes for a layer drawn with a tool; `size` is the drawn box in CSS px (null for a click). */
export function drawnMarkup(kind: DrawTool, size: { width: number; height: number } | null): string {
	// Snap to the 4px spacing grid so drawn sizes land on theme steps (w-40, h-24…).
	const snap = (v: number) => Math.max(4, Math.round(v / 4) * 4);
	const dims = size ? `${spacing('h', snap(size.height))} ${spacing('w', snap(size.width))}` : null;
	switch (kind) {
		case 'stack':
			return `<div class="flex ${dims ?? 'min-h-24 w-40'} flex-col gap-2.5 p-2.5"></div>`;
		case 'grid':
			return `<div class="grid ${dims ?? 'min-h-24 w-40'} grid-cols-2 gap-2.5 p-2.5"></div>`;
		case 'frame':
			return `<div class="${dims ?? 'h-24 w-40'} rounded-lg bg-muted"></div>`;
		case 'text':
			return size && size.width >= 24 ? `<p class="${spacing('w', Math.round(size.width / 4) * 4)}">Text</p>` : '<p>Text</p>';
	}
}

/** Inserts a drawn layer into the container under the pointer (Framer's S / F / T tools), then selects it. */
export async function drawLayer(kind: DrawTool, frameId: string, target: DropTarget, size: { width: number; height: number } | null) {
	const result = await editor.editWithResult(m.edit_insert({ kind }), [
		{ type: 'insert', parent: target.parent, index: -1, markup: drawnMarkup(kind, size), anchor: target.anchor ?? undefined }
	]);
	const loc = result?.created?.[0];
	// A new text layer goes straight into typing, like Framer's T tool.
	if (loc) pendingSelect({ ...loc, tag: kind === 'text' ? 'p' : 'div' }, frameId, kind === 'text' ? (id) => void editor.startTextEdit(frameId, id) : undefined);
}

/**
 * Drag to reorder (canvas or Layers panel): moves a layer next to the target's
 * anchor, or to the end of an empty/target container. Defaults to the selection.
 */
export async function moveLayer(frameId: string, target: Pick<DropTarget, 'parent' | 'anchor'>, source?: SourceLoc) {
	const info = editor.selected;
	const from = source ?? (info?.loc && info.editable ? { ...info.loc, tag: info.componentTag ?? info.tag } : null);
	if (!from) return;
	const result = await editor.editWithResult(m.edit_move(), [
		{ type: 'move', target: from, parent: target.parent, index: -1, anchor: target.anchor ?? undefined }
	]);
	const loc = result?.changes.length ? result.created?.[0] : null;
	if (loc) pendingSelect({ ...loc, tag: from.tag }, frameId);
}

/** Static classes written on a layer (what copy/paste style carries). */
async function staticClasses(info: { loc: SourceLoc | null; tag: string; componentTag: string | null; className: string }): Promise<string[]> {
	if (!info.loc || !editor.worktree) return [];
	const source = await invoke('source:inspect', editor.worktree, { ...info.loc, tag: info.componentTag ?? info.tag }).catch(() => null);
	return source?.staticClasses ?? [];
}

let copiedStyle: string[] | null = null;

/** ⌥⌘C: remembers the selected layer's classes. */
export async function copyStyle() {
	const info = editor.selected;
	if (!info?.loc || !info.editable) return void editor.toast(m.cmd_select_first());
	copiedStyle = await staticClasses(info);
	editor.toast(m.style_copied({ count: copiedStyle.length }));
}

/** ⌥⌘V: replaces the selected layers' classes with the copied ones. */
export async function pasteStyle() {
	if (!copiedStyle) return void editor.toast(m.style_nothing_copied());
	if (!requireSelection()) return;
	const add = copiedStyle;
	const infos = editor.selection.infos.filter((i) => i.loc && i.editable);
	const ops = await Promise.all(
		infos.map(async (info) => ({
			type: 'classes' as const,
			target: { ...info.loc!, tag: info.componentTag ?? info.tag },
			remove: (await staticClasses(info)).filter((c) => !add.includes(c)),
			add
		}))
	);
	await editor.edit(m.edit_paste_style(), ops);
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
function pendingSelect(loc: SourceLoc, inFrame?: string, then?: (id: string) => void) {
	const frameId = inFrame ?? editor.selection.frameId ?? editor.primaryFrameId;
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
			setTimeout(async () => {
				await editor.select(frameId, [ids[0]]);
				then?.(ids[0]);
			}, 120);
		}
	});
	setTimeout(off, 4000);
}
