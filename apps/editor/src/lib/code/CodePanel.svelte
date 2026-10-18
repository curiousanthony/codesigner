<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorView } from '@codemirror/view';
	import type { EditorState } from '@codemirror/state';
	import { ExternalLink, FileCode, TriangleAlert, X } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { errorMessage, invoke } from '#lib/api.js';
	import { m } from '#lib/paraglide/messages.js';
	import { createState, offsetOf, openTagEnd, redo, replaceFromDisk, setHighlight, undo } from './setup';

	type Tab = { file: string; role: 'selection' | 'component' | 'page' | 'layout' };

	let host: HTMLDivElement;
	let view: EditorView | null = null;

	/** File shown in the editor; follows the selection until the user picks a tab. */
	let file = $state<string | null>(null);
	let pinned = $state(false);
	/** Text on disk when we last loaded or saved: the base for conflict detection. */
	let base = '';
	let dirty = $state(false);
	let saving = $state(false);
	let error = $state<{ message: string; line?: number } | null>(null);
	let conflict = $state<string | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const selected = $derived(editor.selected);
	const route = $derived(editor.currentRoute);

	const tabs = $derived.by((): Tab[] => {
		const out: Tab[] = [];
		const add = (f: string | null | undefined, role: Tab['role']) => {
			if (f && !out.some((t) => t.file === f)) out.push({ file: f, role });
		};
		add(selected?.loc?.file, 'selection');
		if (selected?.kind === 'instance') add(selected.definitionFile, 'component');
		add(route?.page, 'page');
		for (const layout of [...(route?.layouts ?? [])].reverse()) add(layout, 'layout');
		return out;
	});

	// Follow the selection (or the page) unless a tab was picked by hand.
	$effect(() => {
		const target = selected?.loc?.file ?? route?.page ?? route?.layouts.at(-1) ?? null;
		if (!pinned && target && target !== file) void open(target);
	});
	$effect(() => {
		// A new selection releases a pinned tab.
		void selected;
		pinned = false;
	});

	// Highlight the selected element's opening tag in the open file.
	$effect(() => {
		const loc = selected?.loc;
		const component = selected?.kind === 'instance';
		void file;
		if (!view) return;
		if (!loc || loc.file !== file) {
			view.dispatch({ effects: setHighlight.of(null) });
			return;
		}
		const doc = view.state.doc.toString();
		const from = offsetOf(doc, loc.line, loc.column);
		const to = Math.max(from, openTagEnd(doc, from) - 1);
		view.dispatch({
			effects: [setHighlight.of({ from, to, component }), EditorView.scrollIntoView(from, { y: 'center' })]
		});
	});

	async function open(next: string, byUser = false) {
		if (!editor.worktree) return;
		if (dirty) await flush();
		try {
			const text = await invoke('source:read', editor.worktree, next);
			file = next;
			pinned = byUser;
			base = text;
			dirty = false;
			error = null;
			conflict = null;
			view?.setState(createState(text, next, onChange));
		} catch (e) {
			editor.toast(errorMessage(e), 'error');
		}
	}

	function onChange(_state: EditorState, user: boolean) {
		if (!user) return;
		dirty = true;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void flush(), 600);
	}

	async function flush() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		if (!view || !file || !editor.worktree || !dirty) return;
		const content = view.state.doc.toString();
		saving = true;
		try {
			const result = await invoke('source:write', editor.worktree, { file, content, base });
			if (result.ok) {
				base = content;
				dirty = view.state.doc.toString() !== content;
				error = null;
			} else if (result.conflict) {
				conflict = result.current ?? null;
			} else {
				error = { message: result.error ?? 'Invalid code', line: result.errorLine };
			}
		} catch (e) {
			error = { message: errorMessage(e) };
		} finally {
			saving = false;
		}
	}

	// Visual edits, undo, agents and other editors change files on disk: reload when we have nothing unsaved.
	async function onSourceChanged(files: string[]) {
		if (!file || !files.includes(file) || !editor.worktree || !view) return;
		const text = await invoke('source:read', editor.worktree, file);
		if (text === view.state.doc.toString()) {
			base = text;
			return;
		}
		if (dirty) {
			conflict = text;
			return;
		}
		base = text;
		replaceFromDisk(view, text);
	}

	function useDisk() {
		if (!view || conflict === null) return;
		base = conflict;
		replaceFromDisk(view, conflict);
		dirty = false;
		conflict = null;
		error = null;
	}

	async function keepMine() {
		if (conflict === null) return;
		base = conflict;
		conflict = null;
		await flush();
	}

	onMount(() => {
		view = new EditorView({ parent: host, state: createState('', 'x.svelte', onChange) });
		editor.codeCommands = {
			undo: () => view && undo(view),
			redo: () => view && redo(view),
			hasFocus: () => !!view?.hasFocus
		};
		editor.sourceListeners.add(onSourceChanged);
		return () => {
			void flush();
			editor.sourceListeners.delete(onSourceChanged);
			editor.codeCommands = null;
			view?.destroy();
			view = null;
		};
	});

	// ------------------------------------------------------------ resize
	let drag: { y: number; height: number } | null = null;
	function onResizeStart(event: PointerEvent) {
		drag = { y: event.clientY, height: editor.codeHeight };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function onResizeMove(event: PointerEvent) {
		if (!drag) return;
		editor.codeHeight = Math.min(window.innerHeight - 160, Math.max(120, drag.height + drag.y - event.clientY));
	}

	const name = (f: string) => f.split('/').at(-1) ?? f;
	const dir = (f: string) => f.split('/').slice(-2, -1)[0] ?? '';
	const roleLabel = (role: Tab['role']) =>
		role === 'selection' ? m.code_tab_selection() : role === 'component' ? m.code_tab_component() : role === 'page' ? m.code_tab_page() : m.code_tab_layout();
</script>

<section class="relative flex shrink-0 flex-col border-t border-divider bg-panel" style="height:{editor.codeHeight}px" aria-label={m.code_panel()}>
	<div
		class="absolute -top-1 right-0 left-0 z-10 h-2 cursor-row-resize"
		role="separator"
		aria-orientation="horizontal"
		onpointerdown={onResizeStart}
		onpointermove={onResizeMove}
		onpointerup={() => (drag = null)}
	></div>

	<div class="flex h-9 shrink-0 items-center gap-1 border-b border-divider px-2">
		<FileCode class="mx-1 size-3.5 shrink-0 text-label" strokeWidth={1.75} />
		<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
			{#each tabs as tab (tab.file)}
				<button
					type="button"
					class="flex h-[26px] shrink-0 items-center gap-1.5 rounded-control px-2 {tab.file === file ? 'bg-control text-fg' : 'text-label hover:bg-row-hover'}"
					title={tab.file}
					onclick={() => open(tab.file, true)}
				>
					<span class={tab.role === 'component' ? 'text-component' : ''}>{name(tab.file)}</span>
					<span class="text-[11px] text-muted">{dir(tab.file)} · {roleLabel(tab.role)}</span>
				</button>
			{/each}
		</div>
		<span class="shrink-0 px-1.5 text-[11px] text-muted">
			{saving ? m.code_saving() : dirty ? m.code_unsaved() : file ? m.code_saved() : ''}
		</span>
		<button
			type="button"
			class="flex size-6 shrink-0 items-center justify-center rounded-control text-label hover:bg-control"
			title={m.action_open_in_code()}
			aria-label={m.action_open_in_code()}
			onclick={() => file && editor.worktree && invoke('project:open-in-editor', `${editor.worktree}/${file}`, selected?.loc?.file === file ? selected.loc.line : undefined, selected?.loc?.file === file ? selected.loc.column : undefined)}
		>
			<ExternalLink class="size-3.5" />
		</button>
		<button
			type="button"
			class="flex size-6 shrink-0 items-center justify-center rounded-control text-label hover:bg-control"
			title={m.code_close()}
			aria-label={m.code_close()}
			onclick={() => (editor.codeOpen = false)}
		>
			<X class="size-3.5" />
		</button>
	</div>

	{#if conflict !== null}
		<div class="flex shrink-0 items-center gap-2 bg-warning/10 px-3 py-1.5 text-[12px]">
			<TriangleAlert class="size-3.5 shrink-0 text-warning" />
			<span class="flex-1">{m.code_conflict()}</span>
			<button type="button" class="rounded-control bg-control px-2 py-0.5 hover:bg-control-hover" onclick={useDisk}>{m.code_use_disk()}</button>
			<button type="button" class="rounded-control bg-control px-2 py-0.5 hover:bg-control-hover" onclick={keepMine}>{m.code_keep_mine()}</button>
		</div>
	{:else if error}
		<div class="flex shrink-0 items-center gap-2 bg-danger/10 px-3 py-1.5 text-[12px] text-danger">
			<TriangleAlert class="size-3.5 shrink-0" />
			<span class="min-w-0 flex-1 truncate">{error.line ? m.code_error_line({ line: error.line }) : ''} {error.message}</span>
			<span class="shrink-0 text-[11px] opacity-70">{m.code_not_saved()}</span>
		</div>
	{/if}

	<div bind:this={host} class="min-h-0 flex-1 overflow-hidden"></div>
</section>
