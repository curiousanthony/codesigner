import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/workspace';
import { locOf, tempProject } from './helpers';

const project = tempProject('kit2-app', {});
afterAll(project.cleanup);
const ws = new Workspace(project.dir);
const file = (name: string, text: string) => {
	const path = `src/lib/components/${name}.svelte`;
	writeFileSync(join(project.dir, path), text);
	return { path, read: () => readFileSync(join(project.dir, path), 'utf8'), at: (needle: string) => locOf(readFileSync(join(project.dir, path), 'utf8'), needle, path) };
};

describe('expose property', () => {
	test('text becomes a prop with the old text as default, typed when props are typed', async () => {
		const c = file(
			'Hero',
			"<script lang=\"ts\">\n\tinterface Props {\n\t\ttone?: 'dark' | 'light';\n\t}\n\tlet { tone = 'dark' }: Props = $props();\n</script>\n\n<h1 class=\"text-4xl\">\n\tShip faster\n</h1>\n"
		);
		const result = await ws.apply({ label: 'expose', ops: [{ type: 'expose-prop', target: c.at('<h1'), prop: 'title', from: 'text' }] });
		expect(result.ok).toBe(true);
		expect(c.read()).toContain("let { tone = 'dark', title = 'Ship faster' }: Props = $props();");
		expect(c.read()).toContain("\t\ttone?: 'dark' | 'light';\n\t\ttitle?: string;\n\t}");
		expect(c.read()).toContain('<h1 class="text-4xl">\n\t{title}\n</h1>');
	});

	test('an attribute becomes a prop (shorthand when the names match); rest props stay last', async () => {
		const c = file('Cta', "<script>\n\tlet { label = 'Go', ...rest } = $props();\n</script>\n\n<a href=\"/signup\" {...rest}>{label}</a>\n");
		await ws.apply({ label: 'expose', ops: [{ type: 'expose-prop', target: c.at('<a'), prop: 'href', from: { attribute: 'href' } }] });
		expect(c.read()).toContain("let { label = 'Go', href = '/signup', ...rest } = $props();");
		expect(c.read()).toContain('<a {href} {...rest}>');
	});

	test('a component without a script gets one', async () => {
		const c = file('Note', "<p>It's free</p>\n");
		await ws.apply({ label: 'expose', ops: [{ type: 'expose-prop', target: c.at('<p'), prop: 'text', from: 'text' }] });
		expect(c.read()).toBe("<script>\n\tlet { text = 'It\\'s free' } = $props();\n</script>\n\n<p>{text}</p>\n");
	});

	test('refuses dynamic text and names already in use', async () => {
		const c = file('Badge', "<script>\n\tlet { label } = $props();\n</script>\n\n<span>{label}</span>\n<b>Static</b>\n");
		expect((await ws.apply({ label: 'x', ops: [{ type: 'expose-prop', target: c.at('<span'), prop: 'other', from: 'text' }] })).ok).toBe(false);
		expect((await ws.apply({ label: 'x', ops: [{ type: 'expose-prop', target: c.at('<b>'), prop: 'label', from: 'text' }] })).ok).toBe(false);
	});
});
