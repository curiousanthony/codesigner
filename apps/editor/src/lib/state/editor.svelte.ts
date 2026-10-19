import type {
	AppInfo,
	Breakpoint,
	CanvasMode,
	ComponentInfo,
	ImageAsset,
	DesignBranch,
	DesignTokens,
	DevServerLog,
	DevServerState,
	EditOp,
	EditRequest,
	EditResult,
	ElementInfo,
	LayerNode,
	NodeId,
	ProjectInfo,
	ProjectSettings,
	Rect,
	RecentProject,
	RouteInfo,
	Comment,
	CommentAnchor,
	ShipStatus,
	SourceBranch,
	SourceLoc,
	Version,
	UpdateInfo
} from '@codesigner/protocol';
import { errorCode, errorMessage, inDesktop, invoke, on } from '#lib/api.js';
import type { BridgeClient } from '#lib/canvas/bridge-client.js';
import { parentOf, pickLayer } from '#lib/canvas/selection.js';
import { buildUrl, matchRoute } from './routes';
import { buildCanvasSpec, type CanvasSpec } from './component-canvas';
import { agentPrompt } from './comments';
import { m } from '#lib/paraglide/messages.js';

/** The project open in this window, kept across reloads of the window (not across launches). */
const session = {
	get: () => {
		try {
			return sessionStorage.getItem('codesigner:project');
		} catch {
			return null;
		}
	},
	set: (root: string | null) => {
		try {
			if (root) sessionStorage.setItem('codesigner:project', root);
			else sessionStorage.removeItem('codesigner:project');
		} catch {
			// storage unavailable
		}
	}
};

export type LeftTab = 'pages' | 'layers' | 'assets';
export type RightTab = 'agent' | 'style' | 'comments';
export type DrawTool = 'stack' | 'frame' | 'grid' | 'text';
export type PaddingSide = 'all' | 'top' | 'right' | 'bottom' | 'left';
/** Interaction state being designed on the page (Style panel's state picker). */
export type EditState = 'default' | 'hover' | 'active' | 'focus';
const FORCE_RULES = [
	{ selector: '[data-codesigner-force="none"]', states: [] },
	{ selector: '[data-codesigner-force="hover"]', states: ['hover'] },
	{ selector: '[data-codesigner-force="active"]', states: ['hover', 'active'] },
	{ selector: '[data-codesigner-force="focus"]', states: ['focus', 'focus-visible'] }
];
export type Tool = 'select' | 'hand' | 'comment' | DrawTool;
export const DRAW_TOOLS: readonly DrawTool[] = ['stack', 'frame', 'grid', 'text'];
export const isDrawTool = (tool: Tool): tool is DrawTool => (DRAW_TOOLS as readonly Tool[]).includes(tool);

export interface Selection {
	frameId: string | null;
	ids: NodeId[];
	/** Layer path (root → node) per selected id, for Framer selection levels. */
	paths: Record<NodeId, NodeId[]>;
	infos: ElementInfo[];
	/** Which occurrence of its source location each id is (3rd card of an each → 2), to find it again. */
	occurrence: Record<NodeId, number>;
}

export interface Toast {
	id: number;
	kind: 'info' | 'error' | 'success';
	text: string;
}

const EMPTY_SELECTION: Selection = { frameId: null, ids: [], paths: {}, infos: [], occurrence: {} };

class EditorState {
	appInfo = $state<AppInfo | null>(null);
	update = $state<UpdateInfo | null>(null);
	recent = $state<RecentProject[]>([]);

	project = $state<ProjectInfo | null>(null);
	opening = $state(false);
	openError = $state<string | null>(null);
	branches = $state<DesignBranch[]>([]);
	/** Set when a project opens with no design branch yet: the user picks where to start from. */
	startChoice = $state<{ branches: SourceBranch[]; defaultBase: string } | null>(null);
	/** Working copy the canvas shows and edits (main checkout or a design worktree). */
	worktree = $state<string | null>(null);
	devServer = $state<DevServerState | null>(null);
	logs = $state<DevServerLog[]>([]);

	routes = $state<RouteInfo[]>([]);
	components = $state<ComponentInfo[]>([]);
	images = $state<ImageAsset[]>([]);
	tokens = $state<DesignTokens | null>(null);
	currentPath = $state('/');
	currentTitle = $state('');

	leftTab = $state<LeftTab>('layers');
	rightTab = $state<RightTab>('style');
	tool = $state<Tool>('select');
	spaceHeld = $state(false);
	/** A component or image being dragged from the Assets panel onto the canvas. */
	draggingAsset = $state<{ component: ComponentInfo } | { image: ImageAsset } | null>(null);
	/** ⌥ held: measure from the selection to the hovered layer. */
	altHeld = $state(false);
	mode = $state<CanvasMode>('design');
	darkPreview = $state(false);

	camera = $state({ x: 80, y: 90, scale: 0.6 });
	activeFrameId = $state<string | null>(null);
	frameReady = $state<Record<string, boolean>>({});

	/** Layer tree of every breakpoint frame: responsive markup can differ between them. */
	trees = $state<Record<string, LayerNode | null>>({});
	/** Expanded rows in the Layers panel, keyed by `frameId:nodeId` (node ids are per frame). */
	expanded = $state<Record<string, boolean>>({});
	selection = $state<Selection>(EMPTY_SELECTION);
	/** The selection's counterparts in the other breakpoint frames. */
	mirrors = $state<Record<string, NodeId[]>>({});
	hover = $state<{ frameId: string; id: NodeId } | null>(null);
	hoverRect = $state<{ frameId: string; rect: Rect } | null>(null);
	selectedRects = $state<Record<string, Record<NodeId, Rect>>>({});
	/** Parents of the selection per frame, outlined faintly so you can see what a layer sits in. */
	parentRects = $state<Record<string, Record<NodeId, Rect>>>({});
	/** Editing a component in place: rects of its instances per frame (the rest is dimmed). */
	focusRects = $state<Record<string, Rect[]>>({});
	/** Files that the editor scopes selection to (routes by default; a component file when editing it). */
	scope = $state<string[]>(['src/routes/']);

	/** Component canvas (Framer's "Edit component"): the component's variants and states, isolated. */
	editingComponent = $state<{ component: ComponentInfo; spec: CanvasSpec; path: string } | null>(null);

	/** Code panel under the canvas. */
	codeOpen = $state(false);
	codeHeight = $state(320);
	/** Set while the code editor has focus, so menu undo/redo go to it instead of the visual journal. */
	codeCommands: { undo: () => void; redo: () => void; hasFocus: () => boolean } | null = null;
	/** Registered by the Style panel: canvas handles preview (`commit` false) and write padding / gap through it. */
	styleCommands = $state.raw<{ padding: (side: PaddingSide, value: number, commit: boolean) => void; gap: (value: number, commit: boolean) => void } | null>(null);
	/** Called with the files (relative to the working copy) that changed, whoever changed them. */
	readonly sourceListeners = new Set<(files: string[]) => void>();

	/** Hover / Pressed / Focus: shown forced on the selection, edits write `hover:` … classes. */
	editState = $state<EditState>('default');
	private forcedKey = '';

	// Comments (C): pinned on elements, stored in .codesigner/comments of the working copy.
	comments = $state<Comment[]>([]);
	/** Pin positions per frame (guest px); null when the element can't be found ("outdated"). */
	pinRects = $state<Record<string, Record<string, Rect | null>>>({});
	/** A comment being written at a point of a frame. */
	commentDraft = $state<{ frameId: string; anchor: CommentAnchor } | null>(null);
	openComment = $state<string | null>(null);
	/** Frame the open thread shows in (pins show everywhere, the thread once). */
	openCommentFrame = $state<string | null>(null);
	showResolved = $state(false);

	/** "Create component" naming dialog (⌥⌘K). */
	createComponentOpen = $state(false);

	/** Version history dialog (⇧⌘H). */
	historyOpen = $state(false);

	/** Bumped by the menu's "New Design Branch…" to open that form in the branch menu. */
	newBranchRequest = $state(0);

	/** A text layer being edited in place on the canvas. */
	textEditing = $state<{ frameId: string; id: NodeId; loc: SourceLoc } | null>(null);

	busy = $state(false);
	toasts = $state<Toast[]>([]);

	readonly frames = new Map<string, BridgeClient>();
	private toastSeq = 0;
	private pendingHmr = new Set<string>();
	private hmrWaiters: (() => void)[] = [];
	private editChain: Promise<unknown> = Promise.resolve();

	get breakpoints(): Breakpoint[] {
		if (this.editingComponent) {
			// Tall enough to show every row of the component canvas (~96px per row) without scrolling.
			const height = Math.min(4000, Math.max(640, 200 + this.editingComponent.spec.sections.length * 96));
			return [{ id: 'component', name: this.editingComponent.component.name, width: 1200, height, primary: true }];
		}
		return this.project?.settings.breakpoints ?? [];
	}

	/** What the canvas frames load: the current page, or the component canvas. */
	get canvasUrl(): string | null {
		if (!this.devServer?.url) return null;
		if (!this.editingComponent) return this.frameUrl();
		const { path, spec } = this.editingComponent;
		return new URL(`${path}?spec=${encodeURIComponent(JSON.stringify(spec))}`, this.devServer.url).toString();
	}

	get primaryFrameId(): string | null {
		return this.breakpoints.find((b) => b.primary)?.id ?? this.breakpoints[0]?.id ?? null;
	}

	/** Layer tree of the primary frame. */
	get tree(): LayerNode | null {
		const id = this.primaryFrameId;
		return id ? (this.trees[id] ?? null) : null;
	}

	isExpanded(frameId: string, id: string): boolean {
		return !!this.expanded[`${frameId}:${id}`];
	}

	setExpanded(frameId: string, ids: string[], open: boolean) {
		const next = { ...this.expanded };
		for (const id of ids) next[`${frameId}:${id}`] = open;
		this.expanded = next;
	}

	/** A page that needs parameters before it can open: the Pages tab asks for them. */
	paramsRequest = $state<string | null>(null);

	/** Opens a page with its saved parameters, or asks for them in the Pages tab. */
	openRoute(route: RouteInfo): boolean {
		const saved = this.project?.settings.routeParams[route.id] ?? {};
		if (this.navigate(route, saved)) return true;
		this.leftTab = 'pages';
		this.paramsRequest = route.id;
		return false;
	}

	get currentRoute(): RouteInfo | null {
		return matchRoute(this.routes, this.currentPath);
	}

	get branch(): DesignBranch | null {
		return this.branches.find((b) => b.worktree === this.worktree) ?? null;
	}

	get selected(): ElementInfo | null {
		return this.selection.infos[0] ?? null;
	}

	get activeFrame(): BridgeClient | null {
		const id = this.selection.frameId ?? this.activeFrameId ?? this.primaryFrameId;
		return id ? (this.frames.get(id) ?? null) : null;
	}

	get effectiveTool(): Tool {
		return this.spaceHeld ? 'hand' : this.tool;
	}

	// ------------------------------------------------------------ boot
	async init() {
		if (!inDesktop) return;
		on('devserver:state', (state) => {
			if (state.worktree === this.worktree) this.devServer = state;
		});
		on('devserver:log', (log) => {
			if (log.worktree !== this.worktree) return;
			this.logs.push(log);
			if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
		});
		on('source:changed', ({ worktree, files, origin }) => {
			if (worktree === this.worktree) for (const listener of this.sourceListeners) listener(files);
			// Only our own writes gate the next edit on a hot reload.
			if (origin === 'editor') for (const file of files) this.pendingHmr.add(file);
			if (this.project?.cssEntry && files.includes(this.project.cssEntry)) void this.loadTokens();
		});
		const [info, recent] = await Promise.all([invoke('app:info'), invoke('project:recent')]);
		this.appInfo = info;
		this.recent = recent;
		void invoke('app:check-update').then((u) => (this.update = u));
		// The window reloaded (e.g. a dev hot reload): reopen what was open.
		const reopen = session.get();
		if (reopen) void this.openProject(reopen);
	}

	toast(text: string, kind: Toast['kind'] = 'info') {
		const id = ++this.toastSeq;
		this.toasts.push({ id, kind, text });
		setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
	}

	// --------------------------------------------------------- project
	async pickAndOpen() {
		const root = await invoke('project:pick');
		if (root) await this.openProject(root);
	}

	async openProject(root: string) {
		this.opening = true;
		this.openError = null;
		try {
			const project = await invoke('project:open', root);
			this.project = project;
			session.set(root);
			this.recent = await invoke('project:recent');
			this.branches = project.isGitRepo ? await invoke('branch:list', project.root) : [];
			this.startChoice = null;
			if (project.settings.versioning === 'branches' && project.isGitRepo) {
				const designs = this.branches.filter((b) => !b.isMainCheckout && b.name.startsWith('design/'));
				const design = designs.find((b) => b.name === project.settings.lastBranch) ?? designs[0];
				if (!design) {
					// First design session: ask which branch to start from (see StartDesign.svelte).
					this.startChoice = await invoke('branch:sources', project.root);
					return;
				}
				await this.switchWorktree(design.worktree);
				return;
			}
			await this.switchWorktree(project.root);
		} catch (error) {
			this.openError = errorMessage(error);
			this.project = null;
		} finally {
			this.opening = false;
		}
	}

	closeProject() {
		void this.flushAutosave();
		session.set(null);
		this.exitComponent();
		this.startChoice = null;
		if (this.worktree) void invoke('devserver:stop', this.worktree);
		this.project = null;
		this.worktree = null;
		this.devServer = null;
		this.routes = [];
		this.trees = {};
		this.selection = EMPTY_SELECTION;
		this.frames.clear();
	}

	async updateSettings(patch: Partial<ProjectSettings>) {
		if (!this.project) return;
		const settings = await invoke('project:update-settings', this.project.root, patch);
		this.project = { ...this.project, settings };
	}

	/** Starts designing on a new design branch cut from `base` (the first-open choice). */
	async startDesign(base: string, name: string): Promise<boolean> {
		const branch = await this.createBranch(name, false, base);
		if (!branch) return false;
		this.startChoice = null;
		await this.switchWorktree(branch.worktree);
		return true;
	}

	/** Edits the main checkout directly, on whatever branch it has checked out. */
	async startDirect() {
		if (!this.project) return;
		this.startChoice = null;
		await this.updateSettings({ versioning: 'direct' });
		await this.switchWorktree(this.project.root);
	}

	// --------------------------------------------------- versions & ship
	/** Labels of edits not saved as a version yet (they become the checkpoint's message). */
	private unsaved: string[] = [];
	private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

	/** Design branches save a version on their own once editing pauses (never the main checkout). */
	get autosaves(): boolean {
		if (this.appInfo?.noAutosave) return false;
		return this.project?.settings.versioning === 'branches' && !!this.branch && !this.branch.isMainCheckout;
	}

	noteChange(label: string) {
		if (!this.autosaves) return;
		this.unsaved.push(label);
		if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
		this.autosaveTimer = setTimeout(() => void this.flushAutosave(), 20_000);
	}

	private async flushAutosave() {
		if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
		this.autosaveTimer = null;
		const labels = [...new Set(this.unsaved)];
		this.unsaved = [];
		if (!labels.length || !this.worktree || !this.autosaves) return;
		const message = labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}` : labels.join(', ');
		await invoke('branch:checkpoint', this.worktree, message, true).catch(() => null);
	}

	async saveVersion(message: string): Promise<string | null> {
		if (!this.worktree) return null;
		this.unsaved = [];
		try {
			const sha = await invoke('branch:checkpoint', this.worktree, message);
			this.toast(sha ? m.ship_saved() : m.ship_nothing(), sha ? 'success' : 'info');
			await this.refreshBranches();
			return sha;
		} catch (error) {
			this.toast(errorMessage(error), 'error');
			return null;
		}
	}

	async versions(): Promise<Version[]> {
		if (!this.worktree) return [];
		await this.flushAutosave();
		return invoke('branch:versions', this.worktree).catch(() => []);
	}

	async restoreVersion(version: Version) {
		if (!this.worktree) return;
		try {
			await invoke('branch:restore', this.worktree, version.sha, m.history_restored_label({ name: version.subject }));
			this.toast(m.history_restored(), 'success');
			await this.refreshBranches();
		} catch (error) {
			this.toast(errorMessage(error), 'error');
		}
	}

	async shipStatus(): Promise<ShipStatus | null> {
		if (!this.worktree) return null;
		await this.flushAutosave();
		return invoke('branch:ship-status', this.worktree).catch(() => null);
	}

	/** Runs a git action that changes files under the dev server, reporting errors as toasts. */
	private async gitAction<T>(run: () => Promise<T>): Promise<T | null> {
		this.unsaved = [];
		try {
			return await run();
		} catch (error) {
			this.toast(errorMessage(error), 'error');
			return null;
		} finally {
			await this.refreshBranches();
		}
	}

	async ship(message: string): Promise<boolean> {
		const worktree = this.worktree;
		if (!worktree) return false;
		const base = this.branch?.baseBranch ?? '';
		const sha = await this.gitAction(() => invoke('branch:ship', worktree, message));
		if (sha) this.toast(m.ship_done({ base }), 'success');
		return !!sha;
	}

	async updateFromBase(): Promise<boolean> {
		const worktree = this.worktree;
		if (!worktree) return false;
		const ok = await this.gitAction(() => invoke('branch:update-from-base', worktree).then(() => true));
		if (ok) this.toast(m.ship_updated(), 'success');
		return !!ok;
	}

	async pullRequest(title: string): Promise<string | null> {
		const worktree = this.worktree;
		if (!worktree) return null;
		const result = await this.gitAction(() => invoke('branch:pull-request', worktree, title, m.ship_pr_body()));
		if (!result) return null;
		this.toast(result.created ? m.ship_pr_created() : m.ship_pr_opened(), 'success');
		void invoke('app:open-external', result.url);
		return result.url;
	}

	async renameBranch(from: string, to: string): Promise<boolean> {
		const root = this.project?.root;
		if (!root || !to.trim()) return false;
		const name = await this.gitAction(() => invoke('branch:rename', root, from, to.trim()));
		if (name && this.project?.settings.lastBranch === from) void this.updateSettings({ lastBranch: name });
		return !!name;
	}

	async deleteBranch(name: string, force = false): Promise<boolean> {
		const root = this.project?.root;
		if (!root) return false;
		if (this.branch?.name === name) {
			// Leave it first: another design branch, else the start dialog.
			const next = this.branches.find((b) => !b.isMainCheckout && b.name.startsWith('design/') && b.name !== name);
			if (next) await this.switchWorktree(next.worktree);
			else {
				if (this.worktree) void invoke('devserver:stop', this.worktree);
				this.worktree = null;
			}
		}
		const ok = await this.gitAction(() => invoke('branch:delete', root, name, force).then(() => true));
		if (ok && !this.worktree) this.startChoice = await invoke('branch:sources', root);
		return !!ok;
	}

	async refreshBranches() {
		if (this.project?.isGitRepo) this.branches = await invoke('branch:list', this.project.root).catch(() => this.branches);
	}

	/** Dismisses the start dialog: back to what was open, or closes a project that never opened. */
	cancelStart() {
		this.startChoice = null;
		if (!this.worktree) this.closeProject();
		else if (this.worktree === this.project?.root) void this.updateSettings({ versioning: 'direct' });
	}

	/** Switches between design branches and editing the main checkout, and moves there. */
	async setVersioning(mode: ProjectSettings['versioning']) {
		if (!this.project) return;
		await this.updateSettings({ versioning: mode });
		if (mode === 'direct') return void (await this.switchWorktree(this.project.root));
		const design = this.branches.find((b) => !b.isMainCheckout && b.name.startsWith('design/'));
		if (design) await this.switchWorktree(design.worktree);
		else this.startChoice = await invoke('branch:sources', this.project.root);
	}

	/** Branches a new design branch can start from. */
	async sourceBranches(): Promise<{ branches: SourceBranch[]; defaultBase: string }> {
		if (!this.project?.isGitRepo) return { branches: [], defaultBase: '' };
		return invoke('branch:sources', this.project.root);
	}

	async createBranch(name: string, silent = false, from?: string): Promise<DesignBranch | null> {
		if (!this.project) return null;
		try {
			const branch = await invoke('branch:create', this.project.root, name, from);
			this.branches = await invoke('branch:list', this.project.root);
			if (!silent) this.toast(m.branch_created({ name: branch.name.replace(/^design\//, '') }), 'success');
			return branch;
		} catch (error) {
			const message = errorMessage(error);
			if ((errorCode(error) === 'folder-exists' || errorCode(error) === 'name-taken') && silent) {
				this.branches = await invoke('branch:list', this.project.root);
				return this.branches.find((b) => b.name.endsWith(name)) ?? null;
			}
			this.toast(message, 'error');
			return null;
		}
	}

	async switchWorktree(worktree: string) {
		await this.flushAutosave();
		this.exitComponent();
		if (this.worktree && this.worktree !== worktree) void invoke('devserver:stop', this.worktree);
		this.worktree = worktree;
		this.selection = EMPTY_SELECTION;
		const branch = this.branches.find((b) => b.worktree === worktree && !b.isMainCheckout);
		if (branch && branch.name !== this.project?.settings.lastBranch) void this.updateSettings({ lastBranch: branch.name });
		this.trees = {};
		this.logs = await invoke('devserver:logs', worktree);
		this.devServer = await invoke('devserver:state', worktree);
		const [routes] = await Promise.all([invoke('project:routes', worktree), this.loadTokens(), this.loadComponents()]);
		this.routes = routes;
		void this.loadComments();
		this.devServer = await invoke('devserver:start', worktree);
	}

	async loadTokens() {
		if (!this.worktree) return;
		try {
			this.tokens = await invoke('tokens:read', this.worktree);
		} catch {
			this.tokens = null;
		}
	}

	async loadComponents() {
		if (!this.worktree) return;
		try {
			this.components = await invoke('project:components', this.worktree);
		} catch {
			this.components = [];
		}
		this.images = await invoke('project:images', this.worktree).catch(() => []);
	}

	async refreshRoutes() {
		if (this.worktree) this.routes = await invoke('project:routes', this.worktree);
	}

	restartDevServer() {
		if (!this.worktree) return;
		const worktree = this.worktree;
		void invoke('devserver:stop', worktree).then(() => invoke('devserver:start', worktree));
	}

	// ------------------------------------------------- component canvas
	async editComponent(component: ComponentInfo) {
		if (!this.worktree) return;
		try {
			const path = await invoke('canvas:ensure-isolation', this.worktree, this.devServer?.url ?? undefined);
			this.selection = EMPTY_SELECTION;
			this.mirrors = {};
			this.trees = {};
			this.hover = null;
			this.scope = [component.file];
			this.editingComponent = { component, spec: buildCanvasSpec(component), path };
			this.leftTab = 'layers';
		} catch (error) {
			this.toast(errorMessage(error), 'error');
		}
	}

	exitComponent() {
		if (!this.editingComponent) return;
		this.editingComponent = null;
		if (this.worktree) void invoke('canvas:remove-isolation', this.worktree);
		this.selection = EMPTY_SELECTION;
		this.mirrors = {};
		this.trees = {};
		this.hover = null;
		this.scope = ['src/routes/'];
	}

	/** Adds a value to a variant axis (copying the default's classes) and shows it on the component canvas. */
	async addVariant(axis: string, value: string) {
		const current = this.editingComponent;
		if (!current) return;
		const ok = await this.edit(`Add ${value} variant`, [{ type: 'add-variant', file: current.component.file, axis, value }]);
		if (!ok) return;
		await this.loadComponents();
		const component = this.components.find((c) => c.file === current.component.file) ?? current.component;
		this.editingComponent = { ...current, component, spec: buildCanvasSpec(component) };
		const url = this.canvasUrl;
		if (url) this.frames.get('component')?.send({ type: 'navigate', url });
	}

	// ----------------------------------------------------- breakpoints
	/** Adds a breakpoint frame (kept sorted widest first, like Framer). */
	async addBreakpoint(width: number, name?: string) {
		const width_ = Math.round(Math.min(3840, Math.max(240, width)));
		if (this.breakpoints.some((b) => b.width === width_)) return;
		let id = name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `bp-${width_}`;
		if (this.breakpoints.some((b) => b.id === id)) id = `${id}-${width_}`;
		const height = width_ < 600 ? 844 : width_ < 1024 ? 1080 : 800;
		const next = [...this.breakpoints, { id, name: name ?? `${width_}`, width: width_, height }].sort((a, b) => b.width - a.width);
		await this.updateSettings({ breakpoints: next });
	}

	async removeBreakpoint(id: string) {
		const bp = this.breakpoints.find((b) => b.id === id);
		if (!bp || bp.primary || this.breakpoints.length <= 1) return;
		if (this.selection.frameId === id) this.clearSelection();
		const { [id]: _tree, ...trees } = this.trees;
		this.trees = trees;
		await this.updateSettings({ breakpoints: this.breakpoints.filter((b) => b.id !== id) });
	}

	async resizeBreakpoint(id: string, width: number) {
		const width_ = Math.round(Math.min(3840, Math.max(240, width)));
		if (this.breakpoints.some((b) => b.id !== id && b.width === width_)) return;
		const next = this.breakpoints.map((b) => (b.id === id ? { ...b, width: width_ } : b)).sort((a, b) => b.width - a.width);
		await this.updateSettings({ breakpoints: next });
	}

	async setPrimaryBreakpoint(id: string) {
		await this.updateSettings({ breakpoints: this.breakpoints.map((b) => ({ ...b, primary: b.id === id })) });
	}

	// ------------------------------------------------------ navigation
	frameUrl(path = this.currentPath): string | null {
		if (!this.devServer?.url) return null;
		return new URL(path, this.devServer.url).toString();
	}

	navigate(route: RouteInfo, values?: Record<string, string>) {
		const params = values ?? this.project?.settings.routeParams[route.id] ?? {};
		const path = buildUrl(route, params);
		if (!path) return false;
		this.goTo(path);
		return true;
	}

	goTo(path: string) {
		if (this.inPlace) this.exitInPlace(); // another page: back to editing the page
		this.currentPath = path;
		this.selection = EMPTY_SELECTION;
		this.mirrors = {};
		this.hover = null;
		const url = this.frameUrl(path);
		if (!url) return;
		for (const frame of this.frames.values()) frame.send({ type: 'navigate', url });
	}

	async saveRouteParams(routeId: string, values: Record<string, string>) {
		if (!this.project) return;
		await this.updateSettings({ routeParams: { ...this.project.settings.routeParams, [routeId]: values } });
	}

	// ---------------------------------------------------------- frames
	registerFrame(id: string, client: BridgeClient) {
		this.frames.set(id, client);
	}

	unregisterFrame(id: string) {
		this.frames.get(id)?.dispose();
		this.frames.delete(id);
	}

	/** Last URL each frame reported. */
	private frameUrls: Record<string, string> = {};

	onFrameNavigated(frameId: string, url: string, title: string) {
		if (this.editingComponent) return; // the component canvas isn't a page of the app
		const previous = this.frameUrls[frameId];
		this.frameUrls[frameId] = url;
		const primary = this.primaryFrameId;
		if (frameId !== primary) {
			// A breakpoint that loaded on its own (e.g. still on the login page) follows the primary frame.
			const primaryUrl = primary ? this.frameUrls[primary] : null;
			if (primaryUrl && primaryUrl !== url) this.frames.get(frameId)?.send({ type: 'navigate', url: primaryUrl });
			return;
		}
		// Breakpoints show the same page: keep them in sync with the primary frame.
		for (const [id, frame] of this.frames) {
			if (id !== frameId && this.frameUrls[id] !== url) frame.send({ type: 'navigate', url });
		}
		try {
			const u = new URL(url);
			this.currentPath = u.pathname + u.search;
		} catch {
			// ignore
		}
		this.currentTitle = title;
		this.syncAnchors();
		// Re-announcements of the same page (hydration, reconnects) keep the selection.
		if (previous !== url) {
			this.selection = EMPTY_SELECTION;
			this.mirrors = {};
		}
	}

	async refreshTree() {
		const id = this.primaryFrameId;
		const frame = id ? this.frames.get(id) : null;
		frame?.send({ type: 'request-tree' });
	}

	setTree(frameId: string, root: LayerNode | null) {
		this.trees = { ...this.trees, [frameId]: root };
	}

	private treeOf(frameId?: string | null): LayerNode | null {
		const id = frameId ?? this.selection.frameId ?? this.primaryFrameId;
		return id ? (this.trees[id] ?? null) : null;
	}

	pathOf(id: NodeId, frameId?: string | null): NodeId[] {
		const path: NodeId[] = [];
		const walk = (node: LayerNode, trail: NodeId[]): boolean => {
			for (const child of node.children) {
				const next = [...trail, child.id];
				if (child.id === id) {
					path.push(...next);
					return true;
				}
				if (walk(child, next)) return true;
			}
			return false;
		};
		const tree = this.treeOf(frameId);
		if (tree) walk(tree, []);
		return path;
	}

	// ------------------------------------------------------- selection
	async select(frameId: string, ids: NodeId[], paths?: Record<NodeId, NodeId[]>, occurrence?: Record<NodeId, number>) {
		const frame = this.frames.get(frameId);
		if (!frame) return;
		const infos = await frame.describe(ids);
		const resolvedPaths: Record<NodeId, NodeId[]> = {};
		for (const id of ids) resolvedPaths[id] = paths?.[id] ?? this.pathOf(id, frameId);
		const resolvedOccurrence: Record<NodeId, number> = {};
		for (const info of infos) {
			if (occurrence?.[info.id] !== undefined) resolvedOccurrence[info.id] = occurrence[info.id];
			else if (info.loc) {
				const twins = await frame.findLoc({ ...info.loc, tag: info.componentTag ?? info.tag });
				resolvedOccurrence[info.id] = Math.max(0, twins.indexOf(info.id));
			}
		}
		this.selection = { frameId, ids: infos.map((i) => i.id), paths: resolvedPaths, infos, occurrence: resolvedOccurrence };
		this.activeFrameId = frameId;
		this.mirrors = {};
		for (const info of infos) this.revealInTree(info.id, frameId);
		this.syncHighlights();
		await this.updateMirrors();
	}

	/** Finds the selected layers in the other breakpoint frames (same source location and occurrence). */
	async updateMirrors() {
		const { frameId, infos, occurrence } = this.selection;
		const mirrors: Record<string, NodeId[]> = {};
		await Promise.all(
			[...this.frames].map(async ([id, frame]) => {
				if (id === frameId) return;
				const ids: NodeId[] = [];
				for (const info of infos) {
					if (!info.loc) continue;
					const found = await frame.findLoc({ ...info.loc, tag: info.componentTag ?? info.tag });
					const pick = found[occurrence[info.id] ?? 0] ?? found[0];
					if (pick && !ids.includes(pick)) ids.push(pick);
				}
				mirrors[id] = ids;
			})
		);
		if (this.selection.frameId !== frameId || this.selection.infos !== infos) return; // superseded
		this.mirrors = mirrors;
		this.syncHighlights();
	}

	clearSelection() {
		this.selection = EMPTY_SELECTION;
		this.editState = 'default';
		this.mirrors = {};
		this.syncHighlights();
	}

	revealInTree(id: NodeId, frameId: string) {
		const path = this.pathOf(id, frameId);
		this.setExpanded(frameId, ['@frame', ...path.slice(0, -1)], true);
	}

	/** Choose what a click on `hitPath` in `frameId` selects: the innermost layer, or with ⌘ the container at the current level. */
	pick(hitPath: NodeId[], gesture: 'click' | 'container', frameId?: string): NodeId | null {
		const sameFrame = !frameId || frameId === this.selection.frameId;
		const current = sameFrame ? this.selection.ids[0] : frameId ? this.mirrors[frameId]?.[0] : undefined;
		const selectedPath = !current ? null : sameFrame ? (this.selection.paths[current] ?? null) : this.pathOf(current, frameId);
		return pickLayer(hitPath, selectedPath, gesture);
	}

	async selectFromHit(frameId: string, hitPath: NodeId[], gesture: 'click' | 'container', additive = false) {
		const id = this.pick(hitPath, gesture, frameId);
		if (!id) {
			if (!additive) this.clearSelection();
			return;
		}
		const path = hitPath.slice(0, hitPath.indexOf(id) + 1);
		if (additive && this.selection.frameId === frameId) {
			const has = this.selection.ids.includes(id);
			const ids = has ? this.selection.ids.filter((x) => x !== id) : [...this.selection.ids, id];
			await this.select(frameId, ids, { ...this.selection.paths, [id]: path });
		} else {
			await this.select(frameId, [id], { [id]: path });
		}
	}

	/** Edits a text layer in place (double-click, or right after drawing it with T). Static text only. */
	async startTextEdit(frameId: string, id: NodeId): Promise<boolean> {
		const frame = this.frames.get(frameId);
		const info = this.selection.frameId === frameId ? this.selection.infos.find((i) => i.id === id) : null;
		if (!frame || !this.worktree || !info?.loc || !info.textEditable) return false;
		const loc = { ...info.loc, tag: info.tag };
		// `<p>{user.name}</p>` renders plain text too: only text written in the markup can be typed over.
		const source = await invoke('source:inspect', this.worktree, loc).catch(() => null);
		if (source?.text == null) {
			this.toast(m.text_dynamic());
			return false;
		}
		this.textEditing = { frameId, id, loc };
		frame.focus();
		frame.send({ type: 'edit-text', id });
		return true;
	}

	endTextEdit(cancel = false) {
		if (!this.textEditing) return;
		this.frames.get(this.textEditing.frameId)?.send({ type: 'end-edit-text', cancel });
	}

	async onTextEdited(frameId: string, id: NodeId, text: string, original: string, cancelled: boolean) {
		const editing = this.textEditing;
		if (!editing || editing.frameId !== frameId || editing.id !== id) return;
		this.textEditing = null;
		// Give the keyboard back to the editor, or shortcuts would keep going to the frame.
		if (document.activeElement?.tagName === 'WEBVIEW') (document.activeElement as HTMLElement).blur();
		if (cancelled) return;
		const ok = await this.edit(m.edit_text(), [{ type: 'text', target: editing.loc, text }]);
		if (!ok) this.frames.get(frameId)?.send({ type: 'set-text', id, text: original });
	}

	async selectParent() {
		const id = this.selection.ids[0];
		if (!id || !this.selection.frameId) return;
		const path = this.selection.paths[id] ?? this.pathOf(id, this.selection.frameId);
		const parent = parentOf(path);
		if (parent) await this.select(this.selection.frameId, [parent], { [parent]: path.slice(0, -1) });
		else this.clearSelection();
	}

	async selectChildren() {
		const id = this.selection.ids[0];
		const frameId = this.selection.frameId;
		if (!id || !frameId) return;
		const node = this.findNode(id, frameId);
		if (!node?.children.length) return;
		const path = this.selection.paths[id] ?? this.pathOf(id, frameId);
		const paths: Record<NodeId, NodeId[]> = {};
		for (const child of node.children) paths[child.id] = [...path, child.id];
		await this.select(frameId, node.children.map((c) => c.id), paths);
	}

	findNode(id: NodeId, frameId?: string | null): LayerNode | null {
		let found: LayerNode | null = null;
		const walk = (node: LayerNode) => {
			if (node.id === id) found = node;
			else node.children.forEach(walk);
		};
		const tree = this.treeOf(frameId);
		if (tree) walk(tree);
		return found;
	}

	setHover(frameId: string, id: NodeId | null) {
		const next = id ? { frameId, id } : null;
		if (next?.id === this.hover?.id && next?.frameId === this.hover?.frameId) return;
		this.hover = next;
		this.syncHighlights();
	}

	syncHighlights() {
		for (const [frameId, frame] of this.frames) {
			const selected = this.selection.frameId === frameId ? this.selection.ids : (this.mirrors[frameId] ?? []);
			const parents = selected
				.map((id) => parentOf(this.selection.frameId === frameId ? (this.selection.paths[id] ?? this.pathOf(id, frameId)) : this.pathOf(id, frameId)))
				.filter((id): id is NodeId => !!id && !selected.includes(id));
			frame.send({ type: 'highlight', hover: this.hover?.frameId === frameId ? this.hover.id : null, selected, parents });
		}
		this.syncForcedState();
	}

	setEditState(state: EditState) {
		this.editState = state;
		this.syncForcedState(true);
	}

	/** Forces the picked state on the selection and its mirrors in every breakpoint (page frames only). */
	syncForcedState(always = false) {
		const state = this.editingComponent || this.selection.ids.length === 0 ? 'default' : this.editState;
		const idsIn = (frameId: string) => (state === 'default' ? [] : this.selection.frameId === frameId ? this.selection.ids : (this.mirrors[frameId] ?? []));
		const key = state + [...this.frames.keys()].map((f) => `${f}:${idsIn(f).join(',')}`).join('|');
		if (key === this.forcedKey && !always) return;
		this.forcedKey = key;
		for (const [frameId, frame] of this.frames) {
			if (frameId === 'component') continue;
			frame.send({ type: 'force-state', ids: idsIn(frameId), state: state === 'default' ? 'none' : state });
			const id = frame.webContentsId();
			if (!id) continue;
			setTimeout(async () => {
				await invoke('canvas:force-states', id, FORCE_RULES);
				if (frameId === this.selection.frameId) await this.refreshSelectionInfo();
			}, 60);
		}
	}

	/** Re-reads the selected layers' computed styles (e.g. once a state is forced on them). */
	private async refreshSelectionInfo() {
		const { frameId, ids } = this.selection;
		const frame = frameId ? this.frames.get(frameId) : null;
		if (!frame || !ids.length) return;
		const infos = await frame.describe(ids);
		if (this.selection.frameId === frameId && infos.length === ids.length && infos.every((info, i) => info.id === this.selection.ids[i])) {
			this.selection = { ...this.selection, infos };
		}
	}

	// --------------------------------------------------------- comments
	get pagePath(): string {
		return this.currentPath.split('?')[0] || '/';
	}

	/** Comments pinned on the page the canvas shows. */
	get pageComments(): Comment[] {
		return this.comments.filter((c) => c.path === this.pagePath && (this.showResolved || !c.resolved));
	}

	async loadComments() {
		if (!this.worktree) return;
		this.comments = await invoke('comments:list', this.worktree).catch(() => []);
		this.syncAnchors();
	}

	/** Tells every frame which pins to track (their rects come back with highlights). */
	syncAnchors(onlyFrame?: string) {
		const anchors = this.editingComponent
			? []
			: this.pageComments.map((c) => ({ id: c.id, loc: { file: c.anchor.file, line: c.anchor.line, column: c.anchor.column, tag: c.anchor.tag }, occurrence: c.anchor.occurrence, text: c.anchor.text }));
		for (const [id, frame] of this.frames) if (!onlyFrame || id === onlyFrame) frame.send({ type: 'set-anchors', anchors });
	}

	private async persist(comment: Comment) {
		if (!this.worktree) return;
		try {
			await invoke('comments:save', this.worktree, comment);
			this.comments = [...this.comments.filter((c) => c.id !== comment.id), comment].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
			this.syncAnchors();
		} catch (error) {
			this.toast(errorMessage(error), 'error');
		}
	}

	async addComment(body: string) {
		const draft = this.commentDraft;
		if (!draft || !this.worktree || !body.trim()) return;
		const { id, author } = await invoke('comments:new', this.worktree);
		const at = new Date().toISOString();
		this.commentDraft = null;
		await this.persist({ id, createdAt: at, path: this.pagePath, frame: draft.frameId, anchor: draft.anchor, messages: [{ author, at, body: body.trim() }], resolved: false });
		this.openCommentFrame = draft.frameId;
		this.openComment = id;
	}

	async replyComment(id: string, body: string) {
		const comment = this.comments.find((c) => c.id === id);
		if (!comment || !this.worktree || !body.trim()) return;
		const { author } = await invoke('comments:new', this.worktree);
		await this.persist({ ...comment, messages: [...comment.messages, { author, at: new Date().toISOString(), body: body.trim() }] });
	}

	async resolveComment(id: string, resolved = true) {
		const comment = this.comments.find((c) => c.id === id);
		if (comment) await this.persist({ ...comment, resolved });
		if (resolved && this.openComment === id) this.openComment = null;
	}

	async deleteComment(id: string) {
		if (!this.worktree) return;
		await invoke('comments:delete', this.worktree, id).catch(() => undefined);
		this.comments = this.comments.filter((c) => c.id !== id);
		if (this.openComment === id) this.openComment = null;
		this.syncAnchors();
	}

	/** Copies comments as a prompt for a coding agent (until the Agent tab lands). */
	async copyForAgent(list: Comment[]) {
		if (!list.length) return;
		await navigator.clipboard.writeText(agentPrompt(list));
		this.toast(m.comment_copied({ count: list.length }), 'success');
	}

	/** Opens a comment from the list: goes to its page first. */
	showComment(id: string) {
		const comment = this.comments.find((c) => c.id === id);
		if (!comment) return;
		this.setTool('comment');
		if (comment.path !== this.pagePath) this.goTo(comment.path);
		this.openCommentFrame = this.frames.has(comment.frame) ? comment.frame : this.primaryFrameId;
		this.openComment = id;
	}

	setTool(tool: Tool) {
		this.tool = tool;
		if (tool === 'comment') {
			this.setMode('design');
			this.rightTab = 'comments';
			void this.loadComments(); // an agent may have resolved some
		} else {
			this.commentDraft = null;
			this.openComment = null;
			if (this.rightTab === 'comments') this.rightTab = 'style';
		}
	}

	setRects(frameId: string, hover: Rect | null, selected: Record<NodeId, Rect>, parents?: Record<NodeId, Rect>, focus?: Rect[], anchors?: Record<string, Rect | null>) {
		this.parentRects = { ...this.parentRects, [frameId]: parents ?? {} };
		if (focus || this.focusRects[frameId]) this.focusRects = { ...this.focusRects, [frameId]: focus ?? [] };
		if (anchors) this.pinRects = { ...this.pinRects, [frameId]: anchors };
		this.hoverRect = hover && this.hover?.frameId === frameId ? { frameId, rect: hover } : this.hoverRect?.frameId === frameId ? null : this.hoverRect;
		this.selectedRects = { ...this.selectedRects, [frameId]: selected };
	}

	/** After HMR or DOM changes: re-find the selected layers by source location. */
	async reresolveSelection(attempt = 0): Promise<void> {
		const { frameId, infos, occurrence } = this.selection;
		const frame = frameId ? this.frames.get(frameId) : null;
		if (!frame || infos.length === 0) return;
		const ids: NodeId[] = [];
		const nextOccurrence: Record<NodeId, number> = {};
		for (const info of infos) {
			if (info.loc) {
				const found = await frame.findLoc({ ...info.loc, tag: info.componentTag ?? info.tag });
				const index = Math.min(occurrence[info.id] ?? 0, found.length - 1);
				const pick = index >= 0 ? found[index] : null;
				if (pick && !ids.includes(pick)) {
					ids.push(pick);
					nextOccurrence[pick] = index;
				}
			}
		}
		if (ids.length === 0) {
			// Mid hot-reload the old DOM may be gone and the new one not mounted yet: look again shortly.
			if (attempt < 3 && this.selection.infos === infos) {
				await new Promise((r) => setTimeout(r, 250));
				if (this.selection.infos === infos) return this.reresolveSelection(attempt + 1);
				return;
			}
			this.clearSelection();
			return;
		}
		await this.refreshTreeNow(frameId!);
		await this.select(frameId!, ids, undefined, nextOccurrence);
	}

	private async refreshTreeNow(frameId: string) {
		const frame = this.frames.get(frameId);
		if (!frame) return;
		await new Promise<void>((resolve) => {
			const off = frame.subscribe((message) => {
				if (message.type === 'tree') {
					off();
					resolve();
				}
			});
			frame.send({ type: 'request-tree' });
			setTimeout(() => {
				off();
				resolve();
			}, 800);
		});
	}

	onHmr() {
		this.pendingHmr.clear();
		const waiters = this.hmrWaiters;
		this.hmrWaiters = [];
		waiters.forEach((w) => w());
	}

	private waitForHmr(timeout = 1500): Promise<void> {
		if (this.pendingHmr.size === 0) return Promise.resolve();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingHmr.clear();
				resolve();
			}, timeout);
			this.hmrWaiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	// ----------------------------------------------------------- edits
	/** Serializes edits and waits for the page to hot-reload between them. */
	async edit(label: string, ops: EditOp[], options: { coalesce?: boolean } = {}): Promise<boolean> {
		const result = await this.editWithResult(label, ops, options);
		return !!result && result.changes.length > 0;
	}

	/** Like `edit`, returning the engine's result (e.g. where inserted layers landed); null on failure. */
	editWithResult(label: string, ops: EditOp[], options: { coalesce?: boolean } = {}): Promise<EditResult | null> {
		const run = async (): Promise<EditResult | null> => {
			if (!this.worktree || ops.length === 0) return null;
			await this.waitForHmr();
			const request: EditRequest = { label, ops, coalesce: options.coalesce };
			try {
				const result = await invoke('source:edit', this.worktree, request);
				if (!result.ok) {
					this.toast(result.error ?? 'Edit failed', 'error');
					return null;
				}
				for (const warning of result.warnings ?? []) this.toast(warning, 'info');
				if (result.changes.length) this.noteChange(label);
				return result;
			} catch (error) {
				this.toast(errorMessage(error), 'error');
				return null;
			}
		};
		const next = this.editChain.then(run, run);
		this.editChain = next;
		return next;
	}

	async undo() {
		if (!this.worktree) return;
		try {
			const changes = await invoke('source:undo', this.worktree);
			if (!changes) this.toast('Nothing to undo');
		} catch (error) {
			this.toast(errorMessage(error), 'error');
		}
	}

	async redo() {
		if (!this.worktree) return;
		try {
			const changes = await invoke('source:redo', this.worktree);
			if (!changes) this.toast('Nothing to redo');
		} catch (error) {
			this.toast(errorMessage(error), 'error');
		}
	}

	async previewCss(classes: string[]): Promise<string> {
		if (!this.worktree || classes.length === 0) return '';
		try {
			return await invoke('source:preview-css', this.worktree, classes);
		} catch {
			return '';
		}
	}

	/** Optimistically shows class changes on every frame before the file write lands. */
	async previewClasses(remove: string[], add: string[]) {
		const { frameId, ids } = this.selection;
		const frame = frameId ? this.frames.get(frameId) : null;
		if (!frame) return;
		const css = await this.previewCss(add);
		frame.send({ type: 'preview-classes', ids, remove, add, css });
	}

	clearPreview() {
		for (const frame of this.frames.values()) frame.send({ type: 'clear-preview' });
	}

	setMode(mode: CanvasMode) {
		this.mode = mode;
		for (const frame of this.frames.values()) frame.send({ type: 'set-mode', mode });
		if (mode === 'interact') {
			this.hover = null;
			this.syncHighlights();
		}
	}

	setDarkPreview(dark: boolean) {
		this.darkPreview = dark;
		for (const frame of this.frames.values()) frame.send({ type: 'set-dark', dark });
		setTimeout(() => void this.refreshSelectionInfo(), 120); // colors shown in the panel follow the theme
	}

	/** Editing a component inside the page (scope is that component only, no route folder). */
	get inPlace(): boolean {
		return !this.editingComponent && this.scope.length > 0 && !this.scope.some((s) => s.endsWith('/'));
	}

	exitInPlace() {
		this.setScope(['src/routes/']);
	}

	/** Edits a component inside the page, with the page's real data (the rest of the page is dimmed). */
	editInPlace(file: string) {
		this.setScope([file]);
		this.leftTab = 'layers';
	}

	setScope(files: string[]) {
		this.scope = files;
		this.selection = EMPTY_SELECTION;
		this.mirrors = {};
		this.syncHighlights();
		for (const frame of this.frames.values()) frame.send({ type: 'set-scope', files });
	}
}

export const editor = new EditorState();

// Exposed for end-to-end tests and debugging from DevTools.
if (typeof window !== 'undefined') (window as unknown as { __editor: EditorState }).__editor = editor;
