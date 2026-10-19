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
		Code,
		Pencil,
		Trash2
	} from '@lucide/svelte';
	import { editor, type DrawTool } from '#lib/state/editor.svelte.js';
	import { wrapSelection } from '#lib/state/commands.js';
	import { invoke } from '#lib/api.js';
	import IconButton from '#lib/ui/IconButton.svelte';
	import BranchPicker from '#lib/ui/BranchPicker.svelte';
	import type { ShipStatus, SourceBranch } from '@codesigner/protocol';
	import { m } from '#lib/paraglide/messages.js';

	let menu = $state<'main' | 'insert' | 'layout' | 'branch' | 'ship' | null>(null);
	let newBranch = $state('');
	/** "New design branch" view of the branch menu: where it starts from. */
	let creating = $state(false);
	let sources = $state<SourceBranch[]>([]);
	let fromBranch = $state('');

	async function openCreate() {
		creating = true;
		const result = await editor.sourceBranches();
		sources = result.branches;
		// Default to the base of the branch being designed on, so a new idea starts from the same place.
		fromBranch = editor.branch?.baseBranch ?? result.defaultBase;
	}
	$effect(() => {
		if (menu !== 'branch') creating = false;
	});
	// Menu: File › New Design Branch… (⇧⌘B)
	let seenRequest = editor.newBranchRequest;
	$effect(() => {
		if (editor.newBranchRequest === seenRequest) return;
		seenRequest = editor.newBranchRequest;
		if (!editor.project?.isGitRepo) return;
		menu = 'branch';
		void openCreate();
	});
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

	/** Picks a draw tool: the next drag or click on the canvas inserts that layer. */
	function useTool(tool: DrawTool) {
		editor.setMode('design');
		editor.tool = editor.tool === tool ? 'select' : tool;
	}

	function toggle(name: typeof menu) {
		menu = menu === name ? null : name;
	}

	async function createBranch() {
		const name = newBranch.trim();
		if (!name) return;
		const branch = await editor.createBranch(name, false, fromBranch || undefined);
		if (!branch) return; // keep the form open: the toast says why (e.g. the name is taken)
		newBranch = '';
		menu = null;
		await editor.switchWorktree(branch.worktree);
	}

	// ------------------------------------------------- rename / delete
	let renaming = $state<{ name: string; value: string } | null>(null);
	let deleting = $state<{ name: string; unshipped: boolean } | null>(null);
	$effect(() => {
		if (menu !== 'branch') renaming = deleting = null;
		else void editor.refreshBranches(); // fresh unsaved / ahead counts
	});

	async function submitRename() {
		if (!renaming) return;
		const { name, value } = renaming;
		if (await editor.renameBranch(name, value)) renaming = null;
	}

	async function submitDelete() {
		if (!deleting) return;
		const { name } = deleting;
		deleting = null;
		// The confirmation said unshipped changes are lost: that is the consent to force it.
		await editor.deleteBranch(name, true);
	}

	// ------------------------------------------------------------ ship
	let ship = $state<ShipStatus | null>(null);
	let shipBusy = $state(false);
	$effect(() => {
		if (menu !== 'ship') return;
		ship = null;
		void editor.shipStatus().then((status) => (ship = status));
	});
	const shipText = $derived(shipMessage.trim() || m.ship_default_message());
	const nothingToShip = $derived(!!ship && ship.ahead === 0 && !ship.dirty);

	async function shipAction(run: () => Promise<unknown>, close = true) {
		shipBusy = true;
		const result = await run();
		shipBusy = false;
		if (result && close) {
			shipMessage = '';
			menu = null;
		} else if (menu === 'ship') ship = await editor.shipStatus();
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
					{@render item(m.layer_stack(), 'S', () => useTool('stack'), Rows3)}
					{@render item(m.layer_frame(), 'F', () => useTool('frame'), Square)}
					{@render item(m.layer_grid(), '⇧G', () => useTool('grid'), Grid2x2)}
					{@render item(m.layer_text(), 'T', () => useTool('text'), Type)}
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
					{@render item(m.wrap_stack(), '⇧A', () => wrapSelection('stack'), Rows3)}
					{@render item(m.wrap_frame(), '⌘↩', () => wrapSelection('frame'), Square)}
					{@render item(m.wrap_grid(), '', () => wrapSelection('grid'), Grid2x2)}
				</div>
			{/if}
		</div>

		<IconButton label={m.tool_text()} active={editor.tool === 'text'} onclick={() => useTool('text')}>
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
				<div class="absolute top-full left-1/2 mt-1.5 w-[340px] -translate-x-1/2 rounded-popover bg-popover p-1.5 shadow-popover" role="menu">
					<p class="px-2 pt-1 pb-1.5 text-[11px] text-muted">{m.branch_title()}</p>
					<div class="max-h-[50vh] overflow-y-auto">
					{#each editor.branches as branch (branch.worktree)}
						{@const design = !branch.isMainCheckout && branch.name.startsWith('design/')}
						{#if renaming?.name === branch.name}
							<form class="flex h-9 items-center gap-1 px-1" onsubmit={(e) => { e.preventDefault(); void submitRename(); }}>
								<span class="flex h-7 min-w-0 flex-1 items-center rounded-[6px] bg-control px-2">
									<span class="text-muted">design/</span>
									<!-- svelte-ignore a11y_autofocus -->
									<input class="min-w-0 flex-1 bg-transparent outline-none" bind:value={renaming.value} autofocus onkeydown={(e) => e.key === 'Escape' && (renaming = null)} />
								</span>
								<button type="submit" class="h-7 rounded-[6px] bg-accent px-2 text-white disabled:opacity-50" disabled={!renaming.value.trim()}>{m.branch_rename()}</button>
							</form>
						{:else if deleting?.name === branch.name}
							<div class="flex min-h-9 items-center gap-1.5 rounded-[6px] bg-danger/10 px-2 py-1.5">
								<span class="flex-1 text-[11px] text-fg">{deleting.unshipped ? m.branch_delete_unshipped({ name: branch.name }) : m.branch_delete_confirm({ name: branch.name })}</span>
								<button type="button" class="h-6 rounded-[5px] px-2 text-label hover:bg-control" onclick={() => (deleting = null)}>{m.action_cancel()}</button>
								<button type="button" class="h-6 rounded-[5px] bg-danger px-2 text-white" onclick={() => submitDelete()}>{m.branch_delete()}</button>
							</div>
						{:else}
							<div class="group flex h-9 w-full items-center gap-2 rounded-[6px] px-2 hover:bg-control">
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-2 text-left"
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
								</button>
								{#if design}
									<button type="button" class="hidden size-6 items-center justify-center rounded-[5px] text-label group-hover:flex hover:bg-control-hover" title={m.branch_rename()} aria-label={m.branch_rename()}
										onclick={() => (renaming = { name: branch.name, value: branch.name.slice(7) })}>
										<Pencil class="size-3" />
									</button>
									<button type="button" class="hidden size-6 items-center justify-center rounded-[5px] text-label group-hover:flex hover:bg-control-hover hover:text-danger" title={m.branch_delete()} aria-label={m.branch_delete()}
										onclick={() => (deleting = { name: branch.name, unshipped: !!branch.ahead || !!branch.dirty })}>
										<Trash2 class="size-3" />
									</button>
								{/if}
								{#if branch.worktree === editor.worktree}<Check class="size-3.5 shrink-0 text-accent" />{/if}
							</div>
						{/if}
					{/each}
					</div>
					{#if editor.project?.isGitRepo}
						{#if creating}
							<form class="mt-1.5 flex flex-col gap-2 border-t border-divider px-0.5 pt-2" onsubmit={(e) => { e.preventDefault(); void createBranch(); }}>
								<span class="flex h-7 items-center rounded-[6px] bg-control px-2">
									<span class="text-muted">design/</span>
									<!-- svelte-ignore a11y_autofocus -->
									<input class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" placeholder={m.branch_new_placeholder()} bind:value={newBranch} autofocus />
								</span>
								<span class="px-1 text-[11px] font-medium text-label">{m.branch_start_from()}</span>
								<BranchPicker branches={sources} value={fromBranch} onchange={(b) => (fromBranch = b)} height={200} />
								<div class="flex gap-1">
									<button type="button" class="h-7 rounded-[6px] px-2.5 text-label hover:bg-control" onclick={() => (creating = false)}>{m.branch_back()}</button>
									<span class="flex-1"></span>
									<button type="submit" class="h-7 rounded-[6px] bg-accent px-2.5 text-white disabled:opacity-50" disabled={!newBranch.trim() || !fromBranch}>{m.branch_create()}</button>
								</div>
							</form>
						{:else}
							<button type="button" class="mt-1 flex h-8 w-full items-center gap-2 rounded-[6px] border-t border-divider px-2 text-left text-accent hover:bg-control" onclick={openCreate}>
								<Plus class="size-3.5" />
								{m.branch_new()}
							</button>
							<label class="mt-0.5 flex items-center gap-2 px-2 py-1.5 text-[11px] text-label">
								<input
									type="checkbox"
									checked={editor.project?.settings.versioning === 'direct'}
									onchange={(e) => editor.setVersioning((e.currentTarget as HTMLInputElement).checked ? 'direct' : 'branches')}
								/>
								{m.branch_direct_mode()}
							</label>
						{/if}
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
				<div class="absolute top-full right-0 mt-1.5 flex w-[300px] flex-col gap-2.5 rounded-popover bg-popover p-3 shadow-popover" role="dialog" aria-label={m.ship_title()}>
					<div>
						<p class="font-semibold text-fg-strong">{m.ship_title()}</p>
						<p class="mt-0.5 text-[11px] text-label">
							{#if !ship}
								…
							{:else if nothingToShip}
								{m.ship_up_to_date()}
							{:else if ship.ahead === 0}
								{m.ship_changes_since({ base: ship.base ?? '?' })}
							{:else}
								{m.ship_versions_since({ count: ship.ahead, base: ship.base ?? '?' })}{#if ship.dirty} · {m.ship_unsaved()}{/if}
							{/if}
						</p>
					</div>
					{#if ship && ship.behind > 0}
						<div class="flex items-center gap-2 rounded-control bg-warning/10 px-2.5 py-2 text-[11px] text-label">
							<span class="flex-1">{m.ship_behind({ base: ship.base ?? '', count: ship.behind })}</span>
							<button type="button" class="rounded-[5px] bg-control px-2 py-1 font-medium text-fg hover:bg-control-hover disabled:opacity-50" disabled={shipBusy}
								onclick={() => shipAction(() => editor.updateFromBase(), false)}>{m.ship_update()}</button>
						</div>
					{/if}
					<input class="h-[30px] w-full rounded-control bg-control px-2 outline-none placeholder:text-muted" placeholder={m.ship_message_placeholder()} bind:value={shipMessage} />
					{#if ship?.baseIsLocal}
						<button type="button" class="h-[30px] w-full rounded-control bg-accent font-medium text-white hover:bg-accent-strong disabled:opacity-50"
							disabled={shipBusy || nothingToShip || ship.baseDirty} onclick={() => shipAction(() => editor.ship(shipText))}>
							{m.ship_merge({ base: ship.base ?? '' })}
						</button>
						{#if ship.baseDirty}<p class="text-[11px] text-warning">{m.ship_base_dirty({ base: ship.base ?? '' })}</p>{/if}
					{:else if ship?.base}
						<p class="text-[11px] text-label">{m.ship_remote_base({ base: ship.base })}</p>
					{/if}
					{#if ship?.remote}
						<button type="button" class="h-[30px] w-full rounded-control font-medium disabled:opacity-50 {ship.baseIsLocal ? 'bg-control text-fg hover:bg-control-hover' : 'bg-accent text-white hover:bg-accent-strong'}"
							disabled={shipBusy || nothingToShip} onclick={() => shipAction(() => editor.pullRequest(shipText))}>
							{m.ship_pull_request()}
						</button>
					{/if}
					<div class="flex items-center gap-1 border-t border-divider pt-2">
						<button type="button" class="h-7 rounded-[6px] px-2 whitespace-nowrap text-label hover:bg-control disabled:opacity-50" disabled={shipBusy || !ship?.dirty}
							onclick={() => shipAction(() => editor.saveVersion(shipText))}>{m.ship_save_version()}</button>
						<span class="flex-1"></span>
						<button type="button" class="h-7 rounded-[6px] px-2 whitespace-nowrap text-label hover:bg-control" onclick={() => ((menu = null), (editor.historyOpen = true))}>{m.ship_history()} <span class="text-muted">⇧⌘H</span></button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</header>

{#if menu}
	<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (menu = null)}></button>
{/if}
