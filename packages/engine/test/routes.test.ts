import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildRouteUrl, parseSegmentParams, routePattern, scanRoutes } from '../src/routes';
import { detectProject } from '../src/project';

const fixture = (name: string) => join(import.meta.dir, '../../../fixtures', name);

describe('route params', () => {
	test('parses every SvelteKit param form', () => {
		expect(parseSegmentParams('[slug]')).toEqual([{ name: 'slug', optional: false, rest: false, matcher: null }]);
		expect(parseSegmentParams('[[lang]]')).toEqual([{ name: 'lang', optional: true, rest: false, matcher: null }]);
		expect(parseSegmentParams('[...path]')).toEqual([{ name: 'path', optional: false, rest: true, matcher: null }]);
		expect(parseSegmentParams('[id=integer]')).toEqual([{ name: 'id', optional: false, rest: false, matcher: 'integer' }]);
		expect(parseSegmentParams('a-[x]-[y]').map((p) => p.name)).toEqual(['x', 'y']);
		expect(parseSegmentParams('static')).toEqual([]);
	});

	test('strips groups from patterns', () => {
		expect(routePattern('/(app)/projects/[slug]')).toBe('/projects/[slug]');
		expect(routePattern('/(app)')).toBe('/');
	});

	test('builds URLs from sample values', () => {
		const route = { pattern: '/projects/[slug]', params: parseSegmentParams('[slug]') };
		expect(buildRouteUrl(route, { slug: 'billing-revamp' })).toBe('/projects/billing-revamp');
		expect(buildRouteUrl(route, {})).toBeNull();
		const optional = { pattern: '/[[lang]]/about', params: parseSegmentParams('[[lang]]') };
		expect(buildRouteUrl(optional, {})).toBe('/about');
		expect(buildRouteUrl(optional, { lang: 'fr' })).toBe('/fr/about');
		const rest = { pattern: '/docs/[...path]', params: parseSegmentParams('[...path]') };
		expect(buildRouteUrl(rest, { path: 'a/b c' })).toBe('/docs/a/b%20c');
	});
});

describe('fixtures', () => {
	test('detects the Kit 2 fixture', () => {
		const project = detectProject(fixture('kit2-app'));
		expect(project.kit.major).toBe(2);
		expect(project.kit.libAlias).toBe('$lib');
		expect(project.kit.configFile).toContain('svelte.config.js');
		expect(project.cssEntry).toBe('src/app.css');
		expect(project.packageManager).toBe('bun');
	});

	test('detects the Kit 3 fixture', () => {
		const project = detectProject(fixture('kit3-playground'));
		expect(project.kit.major).toBe(3);
		expect(project.kit.libAlias).toBe('#lib');
		expect(project.kit.configFile).toBeNull();
		expect(project.cssEntry).toBe('src/routes/layout.css');
	});

	test('scans routes including groups and slugs', () => {
		const routes = scanRoutes(fixture('kit2-app'));
		const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
		expect(Object.keys(byId)).toEqual(
			expect.arrayContaining(['/', '/(app)', '/(app)/projects', '/(app)/projects/[slug]', '/login'])
		);
		const slug = byId['/(app)/projects/[slug]'];
		expect(slug.pattern).toBe('/projects/[slug]');
		expect(slug.params.map((p) => p.name)).toEqual(['slug']);
		expect(slug.server).toBe(true);
		expect(slug.layouts).toEqual(['src/routes/+layout.svelte', 'src/routes/(app)/+layout.svelte']);
		expect(byId['/'].isLayoutOnly).toBe(true);
		expect(byId['/(app)'].page).toBe('src/routes/(app)/+page.svelte');
	});
});
