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
const rich = (target: ReturnType<typeof file>, markup: string, needle = '<p') =>
	ws.apply({ label: 'rich', ops: [{ type: 'rich-text', target: target.at(needle), markup }] });

describe('rich text', () => {
	test('plain text gains bold and a link, keeping the indentation around it', async () => {
		const c = file('Intro', '<section>\n\t<p class="text-sm">\n\t\tRead the guide first\n\t</p>\n</section>\n');
		const result = await rich(c, 'Read the <strong>guide</strong> <a href="/docs">first</a>');
		expect(result.ok).toBe(true);
		expect(c.read()).toBe('<section>\n\t<p class="text-sm">\n\t\tRead the <strong>guide</strong> <a href="/docs">first</a>\n\t</p>\n</section>\n');
	});

	test('inspect reports static inline formatting as rich text', async () => {
		const c = file('Note', '<p>Free for <em>small</em> teams<br /></p>\n<p>Hi {name}</p>\n');
		expect(ws.inspect(c.at('<p>Free')).richText).toBe(true);
		expect(ws.inspect(c.at('<p>Hi')).richText).toBe(false);
	});

	test('escaped markup round-trips', async () => {
		const c = file('Esc', '<p>Old</p>\n');
		await rich(c, 'Use &#123;braces&#125; &amp; &lt;tags&gt; <a href="/q?a=1&amp;b=2" title="&quot;x&quot;">here</a>');
		expect(c.read()).toBe('<p>Use &#123;braces&#125; &amp; &lt;tags&gt; <a href="/q?a=1&amp;b=2" title="&quot;x&quot;">here</a></p>\n');
	});

	test('refuses dynamic content in the layer or in the markup', async () => {
		const dynamic = file('Dyn', '<p>Hi {name}</p>\n');
		expect((await rich(dynamic, 'Hi <strong>you</strong>')).ok).toBe(false);
		const c = file('Safe', '<p>Hello</p>\n');
		for (const markup of ['Hi {name}', 'Hi <Button>x</Button>', '<a href={url}>x</a>', '<a onclick="x" class:on={y}>x</a>', '<div>block</div>', '{#if x}y{/if}']) {
			expect((await rich(c, markup)).ok).toBe(false);
		}
		expect(c.read()).toBe('<p>Hello</p>\n');
	});
});
