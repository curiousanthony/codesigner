<script lang="ts">
	import { onMount } from 'svelte';
	import { editor, isDrawTool, type DrawTool, type LeftTab } from '#lib/state/editor.svelte.js';
	import { copyStyle, deleteSelection, duplicateSelection, pasteStyle, unwrapSelection, wrapSelection } from '#lib/state/commands.js';
	import { invoke } from '#lib/api.js';
	import { on } from '#lib/api.js';
	import Welcome from '#lib/Welcome.svelte';
	import TopBar from '#lib/TopBar.svelte';
	import Toasts from '#lib/Toasts.svelte';
	import StartDesign from '#lib/StartDesign.svelte';
	import VersionHistory from '#lib/VersionHistory.svelte';
	import CreateComponent from '#lib/CreateComponent.svelte';
	import Canvas from '#lib/canvas/Canvas.svelte';
	import CodePanel from '#lib/code/CodePanel.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import PagesPanel from '#lib/panels/PagesPanel.svelte';
	import LayersPanel from '#lib/panels/LayersPanel.svelte';
	import AssetsPanel from '#lib/panels/AssetsPanel.svelte';
	import StylePanel from '#lib/panels/StylePanel.svelte';
	import AgentPanel from '#lib/panels/AgentPanel.svelte';
	import CommentsPanel from '#lib/panels/CommentsPanel.svelte';
	import { m } from '#lib/paraglide/messages.js';

	let canvas: Canvas | undefined = $state();

	const isField = (el: EventTarget | null) => {
		const node = el as HTMLElement | null;
		return !!node?.tagName && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable);
	};
	/** Typing in a field: canvas shortcuts stay off. `target` covers fields that blur themselves on Enter. */
	const isTyping = (event?: Event) => isField(document.activeElement) || (!!event && isField(event.target));

	/** S / F / T / ⇧G pick a draw tool (pressing it again goes back to Select). */
	function useTool(tool: DrawTool) {
		if (editor.editingComponent) return;
		editor.setMode('design');
		editor.tool = editor.tool === tool ? 'select' : tool;
	}

	function runCommand(command: string) {
		switch (command) {
			case 'undo':
				if (editor.codeCommands?.hasFocus()) editor.codeCommands.undo();
				else if (isTyping()) document.execCommand('undo');
				else void editor.undo();
				break;
			case 'redo':
				if (editor.codeCommands?.hasFocus()) editor.codeCommands.redo();
				else if (isTyping()) document.execCommand('redo');
				else void editor.redo();
				break;
			case 'toggle-code':
				editor.codeOpen = !editor.codeOpen;
				break;
			case 'copy-style':
				if (isTyping()) document.execCommand('copy');
				else void copyStyle();
				break;
			case 'paste-style':
				if (isTyping()) document.execCommand('paste');
				else void pasteStyle();
				break;
			case 'create-component':
				if (editor.selected?.editable && !editor.editingComponent) editor.createComponentOpen = true;
				else editor.toast(m.cmd_select_first());
				break;
			case 'version-history':
				if (editor.branch && !editor.branch.isMainCheckout) editor.historyOpen = !editor.historyOpen;
				break;
			case 'new-branch':
				editor.newBranchRequest++;
				break;
			case 'open-in-editor':
				if (editor.worktree) void invoke('project:open-in-editor', editor.worktree);
				break;
			case 'open-project':
				void editor.pickAndOpen();
				break;
			case 'zoom-in':
				canvas?.zoomIn();
				break;
			case 'zoom-out':
				canvas?.zoomOut();
				break;
			case 'zoom-reset':
				canvas?.zoomTo(1);
				break;
			case 'zoom-fit':
				canvas?.zoomToFit();
				break;
			case 'zoom-selection':
				canvas?.zoomToSelection();
				break;
			case 'reload-canvas':
				canvas?.reloadFrames();
				break;
			case 'canvas-devtools':
				canvas?.openFrameDevTools();
				break;
			case 'toggle-interact':
				editor.setMode(editor.mode === 'interact' ? 'design' : 'interact');
				break;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Alt') editor.altHeld = true;
		if (!editor.project || editor.startChoice || editor.historyOpen || editor.createComponentOpen || isTyping(event)) return;
		const mod = event.metaKey || event.ctrlKey;
		if (event.code === 'Space' && !event.repeat) {
			editor.spaceHeld = true;
			event.preventDefault();
			return;
		}
		if (event.altKey && event.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
			editor.leftTab = (['pages', 'layers', 'assets'] as LeftTab[])[Number(event.code.slice(-1)) - 1];
			event.preventDefault();
			return;
		}
		if (mod && event.altKey && event.key === 'Enter') return void wrapSelection('stack');
		if (mod && event.key === 'Enter') return void wrapSelection('frame');
		if (mod && event.key === 'Backspace') return void unwrapSelection();
		if (mod && event.key.toLowerCase() === 'd') {
			event.preventDefault();
			return void duplicateSelection();
		}
		if (mod || event.altKey) return;
		switch (event.key) {
			case 's':
				useTool('stack');
				break;
			case 'f':
				useTool('frame');
				break;
			case 'G':
				if (event.shiftKey) useTool('grid');
				break;
			case 't':
				useTool('text');
				break;
			case 'A':
				// ⇧A: put the selection inside a new Stack
				if (event.shiftKey) void wrapSelection('stack');
				break;
			case 'c':
				editor.setTool(editor.tool === 'comment' ? 'select' : 'comment');
				break;
			case 'Escape':
				if (editor.commentDraft || editor.openComment) ((editor.commentDraft = null), (editor.openComment = null));
				else if (editor.tool === 'comment') editor.setTool('select');
				else if (isDrawTool(editor.tool)) editor.tool = 'select';
				else if (editor.selection.ids.length) void editor.selectParent();
				else if (editor.inPlace) editor.exitInPlace();
				break;
			case 'Enter':
				void editor.selectChildren();
				break;
			case 'Backspace':
			case 'Delete':
				void deleteSelection();
				break;
			case 'e':
				editor.rightTab = 'style';
				break;
			case 'a':
				editor.rightTab = 'agent';
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	function onkeyup(event: KeyboardEvent) {
		if (event.code === 'Space') editor.spaceHeld = false;
		if (event.key === 'Alt') editor.altHeld = false;
	}

	onMount(() => {
		void editor.init();
		return on('menu:command', ({ command }) => runCommand(command));
	});
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => ((editor.spaceHeld = false), (editor.altHeld = false))} />

{#if !editor.project}
	<Welcome />
{:else}
	<div class="flex h-full flex-col">
		<TopBar />
		<div class="flex min-h-0 flex-1">
			<aside class="flex w-[260px] shrink-0 flex-col border-r border-divider bg-panel">
				<div class="px-2.5 py-2.5">
					<Tabs
						tabs={[
							{ value: 'pages', label: m.tab_pages(), hint: '⌥⇧1' },
							{ value: 'layers', label: m.tab_layers(), hint: '⌥⇧2' },
							{ value: 'assets', label: m.tab_assets(), hint: '⌥⇧3' }
						]}
						value={editor.leftTab}
						onchange={(tab) => (editor.leftTab = tab)}
					/>
				</div>
				<div class="min-h-0 flex-1">
					{#if editor.leftTab === 'pages'}
						<PagesPanel />
					{:else if editor.leftTab === 'layers'}
						<LayersPanel />
					{:else}
						<AssetsPanel />
					{/if}
				</div>
				{#if editor.devServer?.status === 'error' || editor.devServer?.status === 'installing' || editor.devServer?.status === 'starting'}
					<div class="max-h-40 overflow-y-auto border-t border-divider p-2.5 font-mono text-[10px] text-label">
						{#each editor.logs.slice(-12) as log, i (i)}
							<div class="break-all whitespace-pre-wrap {log.stream === 'stderr' ? 'text-danger' : ''}">{log.text.trim()}</div>
						{/each}
					</div>
				{/if}
			</aside>

			<div class="flex min-w-0 flex-1 flex-col">
				<main class="relative min-h-0 flex-1">
					{#if editor.editingComponent || editor.inPlace}
						<div class="absolute top-3 left-3 z-40 flex items-center gap-1.5 rounded-control bg-panel px-1.5 py-1 shadow-control">
							<button type="button" class="rounded-[6px] px-2 py-1 hover:bg-control" onclick={() => (editor.editingComponent ? editor.exitComponent() : editor.exitInPlace())}>
								{editor.currentTitle || m.breadcrumb_page()}
							</button>
							<span class="text-muted">›</span>
							<span class="rounded-[6px] bg-component-tint px-2 py-1 font-medium text-component">
								{editor.editingComponent?.component.name ?? editor.components.find((c) => c.file === editor.scope[0])?.name ?? editor.scope[0]?.split('/').at(-1)?.replace('.svelte', '')}
							</span>
						</div>
						{#if editor.editingComponent?.spec.missing.length}
							<p class="absolute top-14 left-3 z-40 max-w-[360px] rounded-control bg-panel px-3 py-2 text-[11px] text-label shadow-control">
								{m.component_needs_data({ name: editor.editingComponent.component.name, props: editor.editingComponent.spec.missing.join(', ') })}
							</p>
						{/if}
					{/if}
					<Canvas bind:this={canvas} />
				</main>
				{#if editor.codeOpen}
					<CodePanel />
				{/if}
			</div>

			<aside class="flex w-[260px] shrink-0 flex-col border-l border-divider bg-panel">
				<div class="px-2.5 py-2.5">
					<Tabs
						tabs={[
							{ value: 'agent', label: m.tab_agent(), hint: 'A' },
							{ value: 'style', label: m.tab_style(), hint: 'E' },
							{ value: 'comments', label: m.tab_comments(), hint: 'C' }
						]}
						value={editor.rightTab}
						onchange={(tab) => (editor.rightTab = tab)}
					/>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					{#if editor.rightTab === 'style'}
						<StylePanel />
					{:else if editor.rightTab === 'comments'}
						<CommentsPanel />
					{:else}
						<AgentPanel />
					{/if}
				</div>
			</aside>
		</div>
	</div>
{/if}

{#if editor.startChoice}
	<StartDesign />
{/if}
{#if editor.historyOpen && editor.project}
	<VersionHistory />
{/if}
{#if editor.createComponentOpen && editor.selected}
	<CreateComponent />
{/if}

<Toasts />
