import type {
	AppInfo,
	Breakpoint,
	CanvasMode,
	ComponentInfo,
	DesignBranch,
	DesignTokens,
	DevServerLog,
	DevServerState,
	EditOp,
	EditRequest,
	ElementInfo,
	LayerNode,
	NodeId,
	ProjectInfo,
	ProjectSettings,
	Rect,
	RecentProject,
	RouteInfo,
	UpdateInfo
} from '@codesigner/protocol';
import { errorMessage, inDesktop, invoke, on } from '#lib/api.js';
import type { BridgeClient } from '#lib/canvas/bridge-client.js';
import { parentOf, pickLayer } from '#lib/canvas/selection.js';
import { buildUrl, matchRoute } from './routes';

export type LeftTab = 'pages' | 'layers' | 'assets';
export type RightTab = 'agent' | 'style';
export type Tool = 'select' | 'hand' | 'comment';

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
	/** Working copy the canvas shows and edits (main checkout or a design worktree). */
	worktree = $state<string | null>(null);
	devServer = $state<DevServerState | null>(null);
	logs = $state<DevServerLog[]>([]);

	routes = $state<RouteInfo[]>([]);
	components = $state<ComponentInfo[]>([]);
	tokens = $state<DesignTokens | null>(null);
	currentPath = $state('/');
	currentTitle = $state('');

	leftTab = $state<LeftTab>('layers');
	rightTab = $state<RightTab>('style');
	tool = $state<Tool>('select');
	spaceHeld = $state(false);
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
	/** Files that the editor scopes selection to (routes by default; a component file when editing it). */
	scope = $state<string[]>(['src/routes/']);

	/** Code panel under the canvas. */
	codeOpen = $state(false);
	codeHeight = $state(320);
	/** Set while the code editor has focus, so menu undo/redo go to it instead of the visual journal. */
	codeCommands: { undo: () => void; redo: () => void; hasFocus: () => boolean } | null = null;
	/** Called with the files (relative to the working copy) that changed, whoever changed them. */
	readonly sourceListeners = new Set<(files: string[]) => void>();

	busy = $state(false);
	toasts = $state<Toast[]>([]);

	readonly frames = new Map<string, BridgeClient>();
	private toastSeq = 0;
	private pendingHmr = new Set<string>();
	private hmrWaiters: (() => void)[] = [];
	private editChain: Promise<unknown> = Promise.resolve();

	get breakpoints(): Breakpoint[] {
		return this.project?.settings.breakpoints ?? [];
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
		on('source:changed', ({ worktree, files }) => {
			if (worktree === this.worktree) for (const listener of this.sourceListeners) listener(files);
			for (const file of files) this.pendingHmr.add(file);
			if (this.project?.cssEntry && files.includes(this.project.cssEntry)) void this.loadTokens();
		});
		const [info, recent] = await Promise.all([invoke('app:info'), invoke('project:recent')]);
		this.appInfo = info;
		this.recent = recent;
		void invoke('app:check-update').then((u) => (this.update = u));
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
			this.recent = await invoke('project:recent');
			this.branches = project.isGitRepo ? await invoke('branch:list', project.root) : [];
			let worktree = project.root;
			if (project.settings.versioning === 'branches' && project.isGitRepo) {
				const design = this.branches.find((b) => !b.isMainCheckout && b.name.startsWith('design/'));
				worktree = design ? design.worktree : (await this.createBranch('design-session', true))?.worktree ?? project.root;
			}
			await this.switchWorktree(worktree);
		} catch (error) {
			this.openError = errorMessage(error);
			this.project = null;
		} finally {
			this.opening = false;
		}
	}

	closeProject() {
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

	async createBranch(name: string, silent = false): Promise<DesignBranch | null> {
		if (!this.project) return null;
		try {
			const branch = await invoke('branch:create', this.project.root, name);
			this.branches = await invoke('branch:list', this.project.root);
			if (!silent) this.toast(`Created ${branch.name}`, 'success');
			return branch;
		} catch (error) {
			const message = errorMessage(error);
			if (/already exists/.test(message) && silent) {
				this.branches = await invoke('branch:list', this.project.root);
				return this.branches.find((b) => b.name.endsWith(name)) ?? null;
			}
			this.toast(message, 'error');
			return null;
		}
	}

	async switchWorktree(worktree: string) {
		if (this.worktree && this.worktree !== worktree) void invoke('devserver:stop', this.worktree);
		this.worktree = worktree;
		this.selection = EMPTY_SELECTION;
		this.trees = {};
		this.logs = await invoke('devserver:logs', worktree);
		this.devServer = await invoke('devserver:state', worktree);
		const [routes] = await Promise.all([invoke('project:routes', worktree), this.loadTokens(), this.loadComponents()]);
		this.routes = routes;
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
	}

	async refreshRoutes() {
		if (this.worktree) this.routes = await invoke('project:routes', this.worktree);
	}

	restartDevServer() {
		if (!this.worktree) return;
		const worktree = this.worktree;
		void invoke('devserver:stop', worktree).then(() => invoke('devserver:start', worktree));
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
		this.mirrors = {};
		this.syncHighlights();
	}

	revealInTree(id: NodeId, frameId: string) {
		const path = this.pathOf(id, frameId);
		this.setExpanded(frameId, ['@frame', ...path.slice(0, -1)], true);
	}

	/** Choose what a click on `hitPath` in `frameId` selects (Framer levels). */
	pick(hitPath: NodeId[], gesture: 'click' | 'double' | 'deep', frameId?: string): NodeId | null {
		const sameFrame = !frameId || frameId === this.selection.frameId;
		const current = sameFrame ? this.selection.ids[0] : frameId ? this.mirrors[frameId]?.[0] : undefined;
		const selectedPath = !current ? null : sameFrame ? (this.selection.paths[current] ?? null) : this.pathOf(current, frameId);
		return pickLayer(hitPath, selectedPath, gesture);
	}

	async selectFromHit(frameId: string, hitPath: NodeId[], gesture: 'click' | 'double' | 'deep', additive = false) {
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
			frame.send({
				type: 'highlight',
				hover: this.hover?.frameId === frameId ? this.hover.id : null,
				selected: this.selection.frameId === frameId ? this.selection.ids : (this.mirrors[frameId] ?? [])
			});
		}
	}

	setRects(frameId: string, hover: Rect | null, selected: Record<NodeId, Rect>) {
		this.hoverRect = hover && this.hover?.frameId === frameId ? { frameId, rect: hover } : this.hoverRect?.frameId === frameId ? null : this.hoverRect;
		this.selectedRects = { ...this.selectedRects, [frameId]: selected };
	}

	/** After HMR or DOM changes: re-find the selected layers by source location. */
	async reresolveSelection() {
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
	edit(label: string, ops: EditOp[], options: { coalesce?: boolean } = {}): Promise<boolean> {
		const run = async () => {
			if (!this.worktree || ops.length === 0) return false;
			await this.waitForHmr();
			const request: EditRequest = { label, ops, coalesce: options.coalesce };
			try {
				const result = await invoke('source:edit', this.worktree, request);
				if (!result.ok) {
					this.toast(result.error ?? 'Edit failed', 'error');
					return false;
				}
				for (const warning of result.warnings ?? []) this.toast(warning, 'info');
				return result.changes.length > 0;
			} catch (error) {
				this.toast(errorMessage(error), 'error');
				return false;
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
	}

	setScope(files: string[]) {
		this.scope = files;
		this.selection = EMPTY_SELECTION;
		this.mirrors = {};
		for (const frame of this.frames.values()) frame.send({ type: 'set-scope', files });
	}
}

export const editor = new EditorState();

// Exposed for end-to-end tests and debugging from DevTools.
if (typeof window !== 'undefined') (window as unknown as { __editor: EditorState }).__editor = editor;
