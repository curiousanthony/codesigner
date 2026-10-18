import type { RouteInfo } from '@codesigner/protocol';

const PARAM = /\[(\[)?(\.\.\.)?([^\]=]+)(?:=[^\]]+)?\]?\]/g;

/** Concrete URL for a route from sample param values; null when a required param is missing. */
export function buildUrl(route: Pick<RouteInfo, 'pattern'>, values: Record<string, string>): string | null {
	let missing = false;
	const path = route.pattern
		.split('/')
		.map((segment) =>
			segment.replace(PARAM, (_all, optional, _rest, name) => {
				const value = values[name];
				if (value === undefined || value === '') {
					if (!optional) missing = true;
					return '';
				}
				return value.split('/').map(encodeURIComponent).join('/');
			})
		)
		.filter((segment, i) => i === 0 || segment !== '')
		.join('/');
	if (missing) return null;
	return path === '' ? '/' : path;
}

function patternToRegex(pattern: string): RegExp {
	const parts = pattern
		.split('/')
		.filter(Boolean)
		.map((segment) => {
			if (/^\[\[[^\]]+\]\]$/.test(segment)) return '(?:/[^/]+)?';
			if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return '(?:/.*)?';
			let out = '';
			let last = 0;
			for (const m of segment.matchAll(PARAM)) {
				out += (m.index! > last ? segment.slice(last, m.index).replace(/[.*+?^${}()|\\]/g, '\\$&') : '') + '[^/]+';
				last = m.index! + m[0].length;
			}
			out += segment.slice(last).replace(/[.*+?^${}()|\\]/g, '\\$&');
			return '/' + out;
		});
	return new RegExp('^' + (parts.join('') || '/?') + '/?$');
}

/** The page route a URL path renders, preferring static over dynamic matches. */
export function matchRoute(routes: RouteInfo[], path: string): RouteInfo | null {
	const pathname = path.split('?')[0].split('#')[0] || '/';
	const candidates = routes.filter((r) => !r.isLayoutOnly && patternToRegex(r.pattern).test(pathname));
	candidates.sort((a, b) => a.params.length - b.params.length || b.pattern.length - a.pattern.length);
	return candidates[0] ?? null;
}

/** Display name of a route: "Home" for "/", otherwise its pattern. */
export function routeLabel(route: RouteInfo): string {
	return route.pattern === '/' ? 'Home' : route.pattern;
}
