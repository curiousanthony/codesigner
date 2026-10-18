<script lang="ts">
	import {
		Plus,
		Frame as FrameIcon,
		Type,
		ChevronDown,
		GitBranch,
		Play,
		CodeXml,
		Check,
		FolderOpen,
		RotateCw,
		Square,
		Rows3,
		Grid2x2,
		X,
		Code
	} from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { insertLayer, wrapSelection } from '#lib/state/commands.js';
	import { invoke, errorMessage } from '#lib/api.js';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { m } from '#lib/paraglide/messages.js';

	let menu = $state<'main' | 'insert' | 'layout' | 'branch' | 'ship' | null>(null);
	let newBranch = $state('');
	let shipMessage = $state('');

	const isMac = $derived(editor.appInfo?.platform === 'darwin');
	const status = $derived(editor.devServer?.status ?? 'idle');
	const statusColor = $derived(
		status === 'ready' ? 'bg-success' : status === 'error' ? 'bg-danger' : status === 'stopped' || status === 'idle' ? 'bg-faint' : 'bg-warning animate-pulse'
	);
	const statusText = $derived(
		status === 'ready'
			? m.server_ready({ port: String(editor.devServer?.port ?? '') })
			: status === 'installing'
				? m.server_installing()
				: status === 'starting'
					? m.server_starting()
					: status === 'error'
						? m.server_error()
						: m.server_stopped()
	);
	const branchLabel = $derived(editor.branch?.name ?? (editor.project?.isGitRepo ? '…' : m.branch_no_git()));

	function toggle(name: typeof menu) {
		menu = menu === name ? null : name;
	}

	async function createBranch() {
		const name = newBranch.trim();
		if (!name) return;
		const branch = await editor.createBranch(name);
		newBranch = '';
		menu = null;
		if (branch) await editor.switchWorktree(branch.worktree);
	}

	async function checkpoint() {
		if (!editor.worktree) return;
		try {
			const sha = await invoke('branch:checkpoint', editor.worktree, shipMessage.trim() || m.ship_default_message());
			editor.toast(sha ? m.ship_saved({ sha: sha.slice(0, 7) }) : m.ship_nothing(), sha ? 'success' : 'info');
			shipMessage = '';
			menu = null;
			if (editor.project) editor.branches = await invoke('branch:list', editor.project.root);
		} catch (error) {
			editor.toast(errorMessage(error), 'error');
		}
	}
</script>

{#snippet item(label: string, keys: string, run: () => void, Icon?: typeof Plus)}
	<button
		type="button"
		role="menuitem"
		class="flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left hover:bg-accent hover:text-white"
		onclick={() => {
			menu = null;
			run();
		}}
	>
		{#if Icon}<Icon class="size-3.5" strokeWidth={1.75} />{/if}
		<span class="flex-1">{label}</span>
		<span class="opacity-60">{keys}</span>
	</button>
{/snippet}

<header class="drag relative z-50 flex h-12 shrink-0 items-center border-b border-divider bg-panel pr-2.5 {isMac ? 'pl-[84px]' : 'pl-2.5'}">
	<!-- Left: main menu + tools -->
	<div class="no-drag flex items-center gap-1.5">
		<div class="relative">
			<button type="button" class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2.5 font-medium hover:bg-control-hover" onclick={() => toggle('main')}>
				<span class="flex size-4 items-center justify-center rounded-[4px] bg-fg-strong text-[9px] font-bold text-panel">C</span>
				{m.view_canvas()}
				<ChevronDown class="size-3 text-muted" />
			</button>
			{#if menu === 'main'}
				<div class="absolute top-full left-0 mt-1.5 w-60 rounded-popover bg-popover p-1 shadow-popover" role="menu">
					{@render item(m.menu_open_project(), '⌘O', () => editor.pickAndOpen(), FolderOpen)}
					{@render item(m.menu_reveal(), '', () => editor.project && invoke('project:reveal', editor.worktree ?? editor.project.root), FolderOpen)}
					{@render item(m.menu_open_editor(), '', () => editor.worktree && invoke('project:open-in-editor', editor.worktree), Code)}
					{@render item(m.menu_restart_server(), '', () => editor.restartDevServer(), RotateCw)}
					<div class="my-1 h-px bg-divider"></div>
					{@render item(m.menu_close_project(), '', () => editor.closeProject(), X)}
				</div>
			{/if}
		</div>

		<div class="relative">
			<IconButton label={m.tool_insert()} active={menu === 'insert'} onclick={() => toggle('insert')}>
				<Plus class="size-[18px]" strokeWidth={1.5} />
			</IconButton>
			{#if menu === 'insert'}
				<div class="absolute top-full left-0 mt-1.5 w-56 rounded-popover bg-popover p-1 shadow-popover" role="menu">
					<p class="px-2.5 pt-1.5 pb-1 text-[11px] text-muted">{m.insert_hint()}</p>
					{@render item(m.layer_stack(), 'S', () => insertLayer('stack'), Rows3)}
					{@render item(m.layer_frame(), 'F', () => insertLayer('frame'), Square)}
					{@render item(m.layer_grid(), '⇧G', () => insertLayer('grid'), Grid2x2)}
					{@render item(m.layer_text(), 'T', () => insertLayer('text'), Type)}
				</div>
			{/if}
		</div>

		<div class="relative">
			<IconButton label={m.tool_layout()} active={menu === 'layout'} onclick={() => toggle('layout')}>
				<FrameIcon class="size-[18px]" strokeWidth={1.5} />
			</IconButton>
			{#if menu === 'layout'}
				<div class="absolute top-full left-0 mt-1.5 w-60 rounded-popover bg-popover p-1 shadow-popover" role="menu">
					<p class="px-2.5 pt-1.5 pb-1 text-[11px] text-muted">{m.wrap_hint()}</p>
					{@render item(m.wrap_stack(), 'S', () => wrapSelection('stack'), Rows3)}
					{@render item(m.wrap_frame(), '⌘↩', () => wrapSelection('frame'), Square)}
					{@render item(m.wrap_grid(), '', () => wrapSelection('grid'), Grid2x2)}
				</div>
			{/if}
		</div>

		<IconButton label={m.tool_text()} onclick={() => insertLayer('text')}>
			<Type class="size-[18px]" strokeWidth={1.5} />
		</IconButton>
	</div>

	<!-- Center: project · branch -->
	<div class="no-drag absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5">
		<span class="font-medium text-fg-strong">{editor.project?.name}</span>
		<span class="text-muted">·</span>
		<div class="relative">
			<button type="button" class="flex h-6 items-center gap-1 rounded-[5px] bg-black/[0.05] px-1.5 text-[11px] text-label hover:bg-black/[0.08] dark:bg-white/[0.06]" onclick={() => toggle('branch')}>
				<GitBranch class="size-3" />
				<span class="max-w-48 truncate">{branchLabel}</span>
				<ChevronDown class="size-3" />
			</button>
			{#if menu === 'branch'}
				<div class="absolute top-full left-1/2 mt-1.5 w-80 -translate-x-1/2 rounded-popover bg-popover p-1.5 shadow-popover" role="menu">
					<p class="px-2 pt-1 pb-1.5 text-[11px] text-muted">{m.branch_title()}</p>
					{#each editor.branches as branch (branch.worktree)}
						<button
							type="button"
							class="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left hover:bg-control"
							onclick={() => {
								menu = null;
								if (branch.worktree !== editor.worktree) void editor.switchWorktree(branch.worktree);
							}}
						>
							<GitBranch class="size-3.5 shrink-0 {branch.isMainCheckout ? 'text-label' : 'text-accent'}" />
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate">{branch.name}</span>
								<span class="truncate text-[10px] text-muted">
									{branch.isMainCheckout ? m.branch_main_checkout() : m.branch_from({ base: branch.baseBranch ?? '?' })}
									{#if branch.ahead}· {m.branch_ahead({ count: branch.ahead })}{/if}
									{#if branch.dirty}· {m.branch_unsaved()}{/if}
								</span>
							</span>
							{#if branch.worktree === editor.worktree}<Check class="size-3.5 text-accent" />{/if}
						</button>
					{/each}
					{#if editor.project?.isGitRepo}
						<form class="mt-1.5 flex gap-1 border-t border-divider pt-1.5" onsubmit={(e) => { e.preventDefault(); void createBranch(); }}>
							<input class="h-7 min-w-0 flex-1 rounded-[6px] bg-control px-2 outline-none" placeholder={m.branch_new_placeholder()} bind:value={newBranch} />
							<button type="submit" class="h-7 rounded-[6px] bg-accent px-2.5 text-white disabled:opacity-50" disabled={!newBranch.trim()}>{m.branch_create()}</button>
						</form>
						<label class="mt-1.5 flex items-center gap-2 px-2 py-1.5 text-[11px] text-label">
							<input
								type="checkbox"
								checked={editor.project?.settings.versioning === 'direct'}
								onchange={(e) => editor.updateSettings({ versioning: (e.currentTarget as HTMLInputElement).checked ? 'direct' : 'branches' })}
							/>
							{m.branch_direct_mode()}
						</label>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Right: server status, preview, ship -->
	<div class="no-drag ml-auto flex items-center gap-1.5">
		<button
			type="button"
			class="flex h-[30px] items-center gap-2 rounded-control px-2.5 text-label hover:bg-control"
			title={editor.devServer?.error ?? statusText}
			onclick={() => (editor.leftTab = 'pages')}
		>
			<span class="size-2 rounded-full {statusColor}"></span>
			<span class="max-w-40 truncate">{statusText}</span>
		</button>
		<IconButton label={m.code_toggle()} active={editor.codeOpen} onclick={() => (editor.codeOpen = !editor.codeOpen)}>
			<CodeXml class="size-4" strokeWidth={1.75} />
		</IconButton>
		<IconButton label={m.action_preview()} disabled={!editor.devServer?.url} onclick={() => editor.frameUrl() && invoke('app:open-external', editor.frameUrl()!)}>
			<Play class="size-4" strokeWidth={1.75} />
		</IconButton>
		<div class="relative">
			<button
				type="button"
				class="h-[30px] rounded-control bg-accent px-3 font-medium text-white hover:bg-accent-strong disabled:opacity-50"
				disabled={!editor.worktree || !editor.project?.isGitRepo}
				onclick={() => toggle('ship')}
			>
				{m.action_ship()}
			</button>
			{#if menu === 'ship'}
				<div class="absolute top-full right-0 mt-1.5 w-80 rounded-popover bg-popover p-3 shadow-popover" role="dialog">
					<p class="font-semibold text-fg-strong">{m.ship_title()}</p>
					<p class="mt-1 text-[11px] text-label">{m.ship_description({ branch: editor.branch?.name ?? '' })}</p>
					<input class="mt-2.5 h-[30px] w-full rounded-control bg-control px-2 outline-none" placeholder={m.ship_default_message()} bind:value={shipMessage} />
					<button type="button" class="mt-2 h-[30px] w-full rounded-control bg-accent font-medium text-white hover:bg-accent-strong" onclick={checkpoint}>
						{m.ship_save_version()}
					</button>
					<p class="mt-2.5 text-[11px] text-muted">{m.ship_pr_soon()}</p>
				</div>
			{/if}
		</div>
	</div>
</header>

{#if menu}
	<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (menu = null)}></button>
{/if}
