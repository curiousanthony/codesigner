import { describe, expect, test } from 'vitest';
import type { RouteInfo } from '@codesigner/protocol';
import { buildUrl, matchRoute } from './routes';

const route = (id: string, pattern: string, params: string[] = [], isLayoutOnly = false): RouteInfo => ({
	id,
	pattern,
	params: params.map((name) => ({ name, optional: false, rest: false, matcher: null })),
	page: isLayoutOnly ? null : `src/routes${id}/+page.svelte`,
	layout: null,
	server: false,
	layouts: [],
	isLayoutOnly
});

const routes = [
	route('/', '/', [], true),
	route('/(app)', '/'),
	route('/(app)/projects', '/projects'),
	route('/(app)/projects/[slug]', '/projects/[slug]', ['slug']),
	route('/(app)/projects/new', '/projects/new')
];

describe('routes', () => {
	test('matches static before dynamic routes', () => {
		expect(matchRoute(routes, '/')?.id).toBe('/(app)');
		expect(matchRoute(routes, '/projects/new')?.id).toBe('/(app)/projects/new');
		expect(matchRoute(routes, '/projects/abc?tab=1')?.id).toBe('/(app)/projects/[slug]');
		expect(matchRoute(routes, '/nope')).toBeNull();
	});

	test('builds URLs from params', () => {
		expect(buildUrl({ pattern: '/projects/[slug]' }, { slug: 'a b' })).toBe('/projects/a%20b');
		expect(buildUrl({ pattern: '/projects/[slug]' }, {})).toBeNull();
	});
});
