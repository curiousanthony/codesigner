/** A SvelteKit project opened in the editor. */
export interface ProjectInfo {
	/** Absolute path to the repository root the user opened. */
	root: string;
	name: string;
	kit: KitInfo;
	packageManager: PackageManager;
	/** Path (relative to the working copy) of the global stylesheet holding design tokens. */
	cssEntry: string | null;
	/** Whether the folder is a git repository. */
	isGitRepo: boolean;
	settings: ProjectSettings;
}

export interface KitInfo {
	/** Installed @sveltejs/kit version, e.g. "2.43.2". */
	version: string | null;
	major: number | null;
	svelteVersion: string | null;
	/** Absolute path to svelte.config.js when present (Kit 2), null for Kit 3. */
	configFile: string | null;
	routesDir: string;
	libDir: string;
	/** Import alias for src/lib: "$lib" (Kit 2) or "#lib" (Kit 3). */
	libAlias: '$lib' | '#lib';
}

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm';

export interface ProjectSettings {
	/**
	 * "branches": every design session runs in its own git worktree + branch.
	 * "direct": edit the current checkout in place.
	 */
	versioning: 'branches' | 'direct';
	/** Sample values for dynamic route params, keyed by route id then param name. */
	routeParams: Record<string, Record<string, string>>;
	/** Breakpoint frames shown on the canvas for every page. */
	breakpoints: Breakpoint[];
	/** Design branch open last time, reopened next time. */
	lastBranch?: string;
}

export interface Breakpoint {
	id: string;
	name: string;
	width: number;
	height: number;
	/** The primary breakpoint's styles are unprefixed; others map to responsive variants. */
	primary?: boolean;
}

export interface RecentProject {
	root: string;
	name: string;
	openedAt: number;
}

/** A route discovered under src/routes. */
export interface RouteInfo {
	/** SvelteKit route id, e.g. "/(app)/projects/[slug]". */
	id: string;
	/** URL pattern without groups, e.g. "/projects/[slug]". */
	pattern: string;
	/** Dynamic params in order, e.g. ["slug"]. */
	params: RouteParam[];
	/** Files composing the route, relative to the working copy. */
	page: string | null;
	layout: string | null;
	server: boolean;
	/** Layout chain from the root layout down to this route. */
	layouts: string[];
	/** True for group-only directories or layouts without a page. */
	isLayoutOnly: boolean;
}

export interface RouteParam {
	name: string;
	optional: boolean;
	rest: boolean;
	matcher: string | null;
}

/** A design session: a branch (and its worktree) the canvas edits. */
export interface DesignBranch {
	name: string;
	/** Absolute path to the working copy the dev server runs from. */
	worktree: string;
	/** True when this is the repository's main working copy. */
	isMainCheckout: boolean;
	head: string | null;
	baseBranch: string | null;
	ahead?: number;
	dirty?: boolean;
}

/** A branch a design branch can start from (local, or remote-only like `origin/feature`). */
export interface SourceBranch {
	name: string;
	remote: boolean;
	/** Checked out in the main working copy. */
	current: boolean;
	/** Last commit date (ISO 8601) and subject. */
	date: string;
	subject: string;
}

export type DevServerStatus = 'idle' | 'installing' | 'starting' | 'ready' | 'error' | 'stopped';

export interface DevServerState {
	worktree: string;
	status: DevServerStatus;
	url: string | null;
	port: number | null;
	error?: string;
}

export interface DevServerLog {
	worktree: string;
	stream: 'stdout' | 'stderr' | 'system';
	text: string;
	at: number;
}
