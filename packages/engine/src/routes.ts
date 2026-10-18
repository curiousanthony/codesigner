import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { RouteInfo, RouteParam } from '@codesigner/protocol';

const PAGE_RE = /^\+page(@[^.]*)?\.svelte$/;
const LAYOUT_RE = /^\+layout(@[^.]*)?\.svelte$/;
const PAGE_SERVER_RE = /^\+(page|layout)(\.server)?\.(js|ts)$/;

/** Parses the params of one route segment, e.g. "[slug]", "[[lang]]", "[...rest]", "[id=integer]", "a-[b]-[c]". */
export function parseSegmentParams(segment: string): RouteParam[] {
	const params: RouteParam[] = [];
	const re = /\[(\[)?(\.\.\.)?([^\]=]+)(?:=([^\]]+))?\]?\]/g;
	for (const m of segment.matchAll(re)) {
		params.push({ name: m[3], optional: Boolean(m[1]), rest: Boolean(m[2]), matcher: m[4] ?? null });
	}
	return params;
}

const isGroup = (segment: string) => /^\(.+\)$/.test(segment);

/** "/(app)/projects/[slug]" → "/projects/[slug]" */
export function routePattern(id: string): string {
	const parts = id.split('/').filter((s) => s && !isGroup(s));
	return '/' + parts.join('/');
}

/** Builds a concrete URL for a route from sample param values. Missing required params return null. */
export function buildRouteUrl(route: Pick<RouteInfo, 'pattern' | 'params'>, values: Record<string, string>): string | null {
	let missing = false;
	const path = route.pattern
		.split('/')
		.map((segment) =>
			segment.replace(/\[(\[)?(\.\.\.)?([^\]=]+)(?:=[^\]]+)?\]?\]/g, (_all, optional, _rest, name) => {
				const value = values[name];
				if (value === undefined || value === '') {
					if (!optional) missing = true;
					return '';
				}
				return value
					.split('/')
					.map((part) => encodeURIComponent(part))
					.join('/');
			})
		)
		.filter((segment, i) => i === 0 || segment !== '')
		.join('/');
	if (missing) return null;
	return path === '' ? '/' : path;
}

/** Scans src/routes and returns one entry per directory that has a page or layout. */
export function scanRoutes(root: string, routesDir = 'src/routes'): RouteInfo[] {
	const base = join(root, routesDir);
	if (!existsSync(base)) return [];
	const routes: RouteInfo[] = [];

	const walk = (dirRel: string, layouts: string[]) => {
		const dirAbs = join(base, dirRel);
		const entries = readdirSync(dirAbs).sort();
		const rel = (file: string) => posix.join(routesDir, dirRel.split('\\').join('/'), file);
		const page = entries.find((e) => PAGE_RE.test(e)) ?? null;
		const layout = entries.find((e) => LAYOUT_RE.test(e)) ?? null;
		const hasServerOrUniversal = entries.some((e) => PAGE_SERVER_RE.test(e));
		const chain = layout ? [...layouts, rel(layout)] : layouts;

		if (page || layout) {
			const id = '/' + dirRel.split(/[\\/]/).filter(Boolean).join('/');
			const params = id.split('/').flatMap(parseSegmentParams);
			routes.push({
				id: id === '/' ? '/' : id,
				pattern: routePattern(id),
				params,
				page: page ? rel(page) : null,
				layout: layout ? rel(layout) : null,
				server: hasServerOrUniversal,
				layouts: chain,
				isLayoutOnly: !page
			});
		}

		for (const entry of entries) {
			if (entry.startsWith('.') || entry === 'node_modules') continue;
			if (statSync(join(dirAbs, entry)).isDirectory()) walk(dirRel ? `${dirRel}/${entry}` : entry, chain);
		}
	};

	walk('', []);
	return routes.sort((a, b) => a.pattern.localeCompare(b.pattern) || a.id.localeCompare(b.id));
}
