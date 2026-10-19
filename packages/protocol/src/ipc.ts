import type {
	DesignBranch,
	DevServerLog,
	DevServerState,
	ProjectInfo,
	ProjectSettings,
	RecentProject,
	RouteInfo,
	SourceBranch
} from './project.js';
import type { CodeWriteRequest, CodeWriteResult, EditRequest, EditResult, ElementSource, FileChange } from './edits.js';
import type { DesignTokens, TokenEdit } from './tokens.js';
import type { ComponentInfo } from './components.js';
import type { SourceLoc } from './bridge.js';

export interface AppInfo {
	version: string;
	platform: string;
	arch: string;
	electron: string;
	chrome: string;
	locale: string;
	/** Absolute path of the bridge preload, needed as the webview `preload` attribute. */
	guestPreload: string;
	isDev: boolean;
}

export interface UpdateInfo {
	current: string;
	latest: string;
	url: string;
	notes: string;
	publishedAt: string;
}

/** Request/response calls from the editor to the main process. */
export interface InvokeMap {
	'app:info': () => AppInfo;
	'app:check-update': () => UpdateInfo | null;
	'app:open-external': (url: string) => void;

	'project:pick': () => string | null;
	'project:recent': () => RecentProject[];
	'project:open': (root: string) => ProjectInfo;
	'project:update-settings': (root: string, patch: Partial<ProjectSettings>) => ProjectSettings;
	'project:routes': (worktree: string) => RouteInfo[];
	'project:components': (worktree: string) => ComponentInfo[];
	'project:reveal': (path: string) => void;
	'project:open-in-editor': (file: string, line?: number, column?: number) => void;
	/**
	 * Writes the component canvas route into the working copy (git-ignored) and,
	 * given the dev server URL, waits until the server serves it. Returns its URL path.
	 */
	'canvas:ensure-isolation': (worktree: string, serverUrl?: string) => string;
	/** Deletes the component canvas route from the working copy. */
	'canvas:remove-isolation': (worktree: string) => void;
	/** Forces :hover / :active / :focus-visible on elements of a canvas frame (DevTools protocol). */
	'canvas:force-states': (webContentsId: number, rules: { selector: string; states: string[] }[]) => boolean;

	'branch:list': (root: string) => DesignBranch[];
	/** Branches to start a design from, most recently committed first, plus the suggested default. */
	'branch:sources': (root: string) => { branches: SourceBranch[]; defaultBase: string };
	'branch:create': (root: string, name: string, from?: string) => DesignBranch;
	'branch:checkpoint': (worktree: string, message: string) => string | null;

	'devserver:start': (worktree: string) => DevServerState;
	'devserver:stop': (worktree: string) => void;
	'devserver:state': (worktree: string) => DevServerState;
	'devserver:logs': (worktree: string) => DevServerLog[];

	'source:read': (worktree: string, file: string) => string;
	'source:edit': (worktree: string, request: EditRequest) => EditResult;
	'source:write': (worktree: string, request: CodeWriteRequest) => CodeWriteResult;
	'source:inspect': (worktree: string, loc: SourceLoc) => ElementSource | null;
	'source:undo': (worktree: string) => FileChange[] | null;
	'source:redo': (worktree: string) => FileChange[] | null;
	/** CSS for Tailwind classes the page may not have compiled yet (optimistic previews). */
	'source:preview-css': (worktree: string, classes: string[]) => string;

	'tokens:read': (worktree: string) => DesignTokens;
	'tokens:edit': (worktree: string, edit: TokenEdit) => DesignTokens;
}

/** Push events from the main process to the editor. */
export interface EventMap {
	'devserver:state': DevServerState;
	'devserver:log': DevServerLog;
	'source:changed': { worktree: string; files: string[]; origin: 'editor' | 'external' };
	'menu:command': { command: string };
}

type Fn = (...args: never[]) => unknown;
export type InvokeArgs<K extends keyof InvokeMap> = InvokeMap[K] extends Fn ? Parameters<InvokeMap[K]> : never;
export type InvokeResult<K extends keyof InvokeMap> = InvokeMap[K] extends Fn ? Awaited<ReturnType<InvokeMap[K]>> : never;

/** The API the editor preload exposes on `window.codesigner`. */
export interface CodesignerApi {
	invoke<K extends keyof InvokeMap>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>>;
	on<K extends keyof EventMap>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
}

export const INVOKE_CHANNELS = [
	'app:info',
	'app:check-update',
	'app:open-external',
	'project:pick',
	'project:recent',
	'project:open',
	'project:update-settings',
	'project:routes',
	'project:components',
	'project:reveal',
	'project:open-in-editor',
	'canvas:ensure-isolation',
	'canvas:remove-isolation',
	'canvas:force-states',
	'branch:list',
	'branch:sources',
	'branch:create',
	'branch:checkpoint',
	'devserver:start',
	'devserver:stop',
	'devserver:state',
	'devserver:logs',
	'source:read',
	'source:edit',
	'source:write',
	'source:inspect',
	'source:undo',
	'source:redo',
	'source:preview-css',
	'tokens:read',
	'tokens:edit'
] as const satisfies readonly (keyof InvokeMap)[];

export const EVENT_CHANNELS = [
	'devserver:state',
	'devserver:log',
	'source:changed',
	'menu:command'
] as const satisfies readonly (keyof EventMap)[];
