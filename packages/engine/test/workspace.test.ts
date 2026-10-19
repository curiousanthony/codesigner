import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/workspace';
import { locOf, tempProject } from './helpers';

const PAGE = 'src/routes/test/+page.svelte';
const SOURCE = `<script lang="ts">
	import Child from './child.svelte';
	let { active = false, className = '' } = $props();
</script>

<!-- A comment that must survive -->
<div class="flex flex-col gap-1">
	<p class="text-sm  text-muted-foreground">Hello world</p>
	<span class={cn('px-2', active && 'mt-1')}>Badge</span>
	<section class="flex gap-1 {active ? 'p-2' : ''}">Mixed</section>
	<em>No class</em>
	<b class={className}>Dynamic</b>
	<Child variant="outline" />
	<Child />
</div>
`;

const project = tempProject('kit2-app', { [PAGE]: SOURCE, 'src/routes/test/child.svelte': '<button>child</button>' });
afterAll(project.cleanup);
const ws = new Workspace(project.dir);
const read = () => readFileSync(join(project.dir, PAGE), 'utf8');
const at = (needle: string) => locOf(read(), needle, PAGE);

describe('classes', () => {
	test('replaces a conflicting class in place', async () => {
		const result = await ws.apply({ label: 'gap', ops: [{ type: 'classes', target: at('<div class'), remove: [], add: ['gap-3'] }] });
		expect(result.ok).toBe(true);
		expect(read()).toContain('<div class="flex flex-col gap-3">');
		expect(read()).toContain('<!-- A comment that must survive -->');
	});

	test('canonicalizes arbitrary values to the theme scale', async () => {
		await ws.apply({ label: 'gap', ops: [{ type: 'classes', target: at('<div class'), remove: [], add: ['gap-[16px]'] }] });
		expect(read()).toContain('<div class="flex flex-col gap-4">');
	});

	test('keeps irregular whitespace and inserts in Tailwind order', async () => {
		await ws.apply({ label: 'weight', ops: [{ type: 'classes', target: at('<p class'), remove: [], add: ['font-medium'] }] });
		expect(read()).toContain('<p class="text-sm  font-medium text-muted-foreground">');
	});

	test('edits the unconditional literal inside cn()', async () => {
		await ws.apply({ label: 'padding', ops: [{ type: 'classes', target: at('<span'), remove: [], add: ['p-4'] }] });
		expect(read()).toContain("<span class={cn('p-4', active && 'mt-1')}>");
	});

	test('edits static text of a mixed attribute without touching the expression', async () => {
		await ws.apply({ label: 'align', ops: [{ type: 'classes', target: at('<section'), remove: [], add: ['items-center'] }] });
		expect(read()).toContain(`<section class="flex items-center gap-1 {active ? 'p-2' : ''}">`);
	});

	test('adds a class attribute when missing', async () => {
		await ws.apply({ label: 'size', ops: [{ type: 'classes', target: at('<em>'), remove: [], add: ['text-xs'] }] });
		expect(read()).toContain('<em class="text-xs">No class</em>');
	});

	test('wraps dynamic expressions in a clsx array', async () => {
		await ws.apply({ label: 'mt', ops: [{ type: 'classes', target: at('<b class'), remove: [], add: ['mt-2'] }] });
		expect(read()).toContain("<b class={[className, 'mt-2']}>Dynamic</b>");
	});

	test('removes classes and keeps the attribute tidy', async () => {
		await ws.apply({ label: 'rm', ops: [{ type: 'classes', target: at('<p class'), remove: ['font-medium'], add: [] }] });
		expect(read()).toContain('<p class="text-sm  text-muted-foreground">');
	});

	test('sets classes on component instances', async () => {
		await ws.apply({ label: 'w', ops: [{ type: 'classes', target: at('<Child variant'), remove: [], add: ['w-full'] }] });
		expect(read()).toContain('<Child variant="outline" class="w-full" />');
	});
});

describe('structure', () => {
	test('edits static text', async () => {
		const result = await ws.apply({ label: 'text', ops: [{ type: 'text', target: at('<p class'), text: 'Hi {there} <you>' }] });
		expect(result.ok).toBe(true);
		expect(read()).toContain(`>Hi {'{'}there{'}'} &lt;you></p>`);
	});

	test('sets a prop', async () => {
		await ws.apply({ label: 'variant', ops: [{ type: 'attribute', target: at('<Child variant'), name: 'variant', value: 'secondary' }] });
		expect(read()).toContain('<Child variant="secondary" class="w-full" />');
	});

	test('wraps siblings in a stack with correct indentation', async () => {
		const result = await ws.apply({
			label: 'Wrap in Stack',
			ops: [{ type: 'wrap', targets: [at('<span'), at('<section')], tag: 'div', className: 'flex flex-col gap-2' }]
		});
		expect(result.ok).toBe(true);
		expect(read()).toContain(
			`\t<div class="flex flex-col gap-2">\n\t\t<span class={cn('p-4', active && 'mt-1')}>Badge</span>\n\t\t<section class="flex items-center gap-1 {active ? 'p-2' : ''}">Mixed</section>\n\t</div>\n`
		);
	});

	test('rejects wrapping layers with different parents', async () => {
		const result = await ws.apply({ label: 'bad', ops: [{ type: 'wrap', targets: [at('<div class'), at('<em')], tag: 'div', className: '' }] });
		expect(result.ok).toBe(false);
	});

	test('duplicates and removes', async () => {
		await ws.apply({ label: 'dup', ops: [{ type: 'duplicate', targets: [at('<em')] }] });
		expect(read().match(/<em class="text-xs">No class<\/em>/g)?.length).toBe(2);
		await ws.apply({ label: 'rm', ops: [{ type: 'remove', targets: [at('<em')] }] });
		expect(read().match(/<em class="text-xs">No class<\/em>/g)?.length).toBe(1);
		expect(read()).not.toMatch(/\n\t*\n\t*<b/);
	});

	test('inserts a new stack as a child', async () => {
		await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: at('<div class'), index: -1, markup: '<div class="flex flex-col gap-2"></div>' }] });
		expect(read()).toContain('\t<Child />\n\t<div class="flex flex-col gap-2"></div>\n</div>');
	});

	test('inserts next to an anchor layer (drawn on the canvas)', async () => {
		const result = await ws.apply({ label: 'draw', ops: [{ type: 'insert', parent: at('<div class'), index: -1, markup: '<i>drawn</i>', anchor: { target: at('<em'), position: 'before' } }] });
		expect(result.created).toEqual([at('<i>drawn')]);
		expect(read()).toMatch(/<\/div>\n\t<i>drawn<\/i>\n\t<em/);
		await ws.apply({ label: 'draw', ops: [{ type: 'insert', parent: at('<div class'), index: -1, markup: '<u>after</u>', anchor: { target: at('<em'), position: 'after' } }] });
		expect(read()).toMatch(/<\/em>\n\t<u>after<\/u>\n\t<b/);
		ws.undo();
		ws.undo();
	});

	test('moves a layer next to an anchor sibling (drag to reorder)', async () => {
		const page = 'src/routes/test/reorder.svelte';
		const { writeFileSync } = await import('node:fs');
		writeFileSync(join(project.dir, page), '<div class="flex flex-col">\n\t<p>A</p>\n\t<p>B</p>\n\t<p>C</p>\n\t<section class="flex">\n\t\t<i>x</i>\n\t</section>\n</div>\n');
		const text = () => readFileSync(join(project.dir, page), 'utf8');
		const loc = (needle: string) => locOf(text(), needle, page);
		// Down: A after C. The slot right after A's old place must not be used as the anchor.
		let result = await ws.apply({ label: 'move', ops: [{ type: 'move', target: loc('<p>A'), parent: loc('<div'), index: -1, anchor: { target: loc('<p>C'), position: 'after' } }] });
		expect(text()).toContain('\t<p>B</p>\n\t<p>C</p>\n\t<p>A</p>\n');
		expect(result.created).toEqual([loc('<p>A')]);
		// Up: A before B.
		await ws.apply({ label: 'move', ops: [{ type: 'move', target: loc('<p>A'), parent: loc('<div'), index: -1, anchor: { target: loc('<p>B'), position: 'before' } }] });
		expect(text()).toContain('\t<p>A</p>\n\t<p>B</p>\n\t<p>C</p>\n');
		// Before the sibling that follows it: no-op position.
		await ws.apply({ label: 'move', ops: [{ type: 'move', target: loc('<p>A'), parent: loc('<div'), index: -1, anchor: { target: loc('<p>B'), position: 'before' } }] });
		expect(text()).toContain('\t<p>A</p>\n\t<p>B</p>\n\t<p>C</p>\n');
		// Into another stack, re-indented.
		result = await ws.apply({ label: 'move', ops: [{ type: 'move', target: loc('<p>B'), parent: loc('<section'), index: -1, anchor: { target: loc('<i>'), position: 'before' } }] });
		expect(text()).toContain('<section class="flex">\n\t\t<p>B</p>\n\t\t<i>x</i>');
		expect(result.created).toEqual([loc('<p>B')]);
	});

	test('inserts a component with its import (dropped from Assets)', async () => {
		const page = 'src/routes/test/assets.svelte';
		const { writeFileSync } = await import('node:fs');
		const text = () => readFileSync(join(project.dir, page), 'utf8');
		writeFileSync(join(project.dir, page), "<script lang=\"ts\">\n\timport { Badge } from '$lib/components/ui/badge';\n</script>\n\n<div class=\"flex\">\n\t<Badge>New</Badge>\n</div>\n");
		const parent = () => locOf(text(), '<div', page);
		// Named import from a module already imported from: merged into its braces.
		await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: parent(), index: -1, markup: '<Badge>Two</Badge>', imports: [{ kind: 'named', local: 'Badge', from: '$lib/components/ui/badge' }] }] });
		expect(text().match(/import/g)?.length).toBe(1);
		let result = await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: parent(), index: -1, markup: '<Button>Button</Button>', imports: [{ kind: 'named', local: 'Button', from: '$lib/components/ui/button' }] }] });
		expect(text()).toContain("\timport { Badge } from '$lib/components/ui/badge';\n\timport { Button } from '$lib/components/ui/button';\n");
		expect(result.created).toEqual([locOf(text(), '<Button>', page)]);
		result = await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: parent(), index: -1, markup: '<Card.Root>Card</Card.Root>', imports: [{ kind: 'namespace', local: 'Card', from: '$lib/components/ui/card' }] }] });
		expect(text()).toContain("import * as Card from '$lib/components/ui/card';");
		expect(result.created).toEqual([locOf(text(), '<Card.Root>', page)]);
		// No script at all: one is created.
		const bare = 'src/routes/test/bare.svelte';
		writeFileSync(join(project.dir, bare), '<main class="p-4"></main>\n');
		result = await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: locOf('<main class="p-4"></main>\n', '<main', bare), index: -1, markup: '<NavItem />', imports: [{ kind: 'default', local: 'NavItem', from: '$lib/components/app/NavItem.svelte' }] }] });
		const bareText = readFileSync(join(project.dir, bare), 'utf8');
		expect(bareText.startsWith("<script>\n\timport NavItem from '$lib/components/app/NavItem.svelte';\n</script>\n\n<main")).toBe(true);
		expect(result.created).toEqual([locOf(bareText, '<NavItem', bare)]);
	});

	test('reports where a drawn layer landed next to look-alike siblings', async () => {
		const page = 'src/routes/test/look-alike.svelte';
		const { writeFileSync } = await import('node:fs');
		writeFileSync(join(project.dir, page), '<div class="flex flex-col">\n\t<div class="a"></div>\n\t<p>Text</p>\n\t<p>Text</p>\n</div>\n');
		const text = () => readFileSync(join(project.dir, page), 'utf8');
		const loc = (needle: string, nth = 0) => {
			let offset = -1;
			for (let i = 0; i <= nth; i++) offset = text().indexOf(needle, offset + 1);
			return locOf(text().slice(0, offset) + '\u0000' + text().slice(offset), '\u0000', page);
		};
		const parent = loc('<div class="flex');
		const cases: [string, 'before' | 'after', string, string, number][] = [
			['<div class="a">', 'before', '<div class="h-4"></div>', '<div class="h-4"', 0],
			['<div class="a">', 'after', '<div class="b"></div>', '<div class="b"', 0],
			['<p>Text</p>', 'after', '<p>Text</p>', '<p>Text</p>', 1]
		];
		for (const [anchor, position, markup, expect_, nth] of cases) {
			const result = await ws.apply({ label: 'draw', ops: [{ type: 'insert', parent, index: -1, markup, anchor: { target: loc(anchor), position } }] });
			expect(result.ok).toBe(true);
			expect(result.created).toEqual([loc(expect_, nth)]);
		}
	});
});

describe('history', () => {
	test('undo and redo restore exact bytes', async () => {
		const before = read();
		await ws.apply({ label: 'gap', ops: [{ type: 'classes', target: at('<div class'), remove: [], add: ['gap-8'] }] });
		const after = read();
		expect(after).not.toBe(before);
		ws.undo();
		expect(read()).toBe(before);
		ws.redo();
		expect(read()).toBe(after);
	});

	test('coalesces scrubbing into one undo step', async () => {
		const before = read();
		for (const g of ['gap-5', 'gap-6', 'gap-7']) {
			await ws.apply({ label: 'Gap', coalesce: true, ops: [{ type: 'classes', target: at('<div class'), remove: [], add: [g] }] });
		}
		expect(read()).toContain('gap-7');
		ws.undo();
		expect(read()).toBe(before);
	});

	test('resolves locations from the version the page is still showing', async () => {
		const stale = { ...at('<em'), tag: 'em' };
		// Insert a line above, shifting <em> down; the page hasn't reloaded yet.
		await ws.apply({ label: 'insert', ops: [{ type: 'insert', parent: at('<div class'), index: 0, markup: '<hr />' }] });
		const result = await ws.apply({ label: 'size', ops: [{ type: 'classes', target: stale, remove: [], add: ['text-lg'] }] });
		expect(result.ok).toBe(true);
		expect(read()).toContain('<em class="text-lg">No class</em>');
	});

	test('refuses undo after an external edit', async () => {
		await ws.apply({ label: 'gap', ops: [{ type: 'classes', target: at('<div class'), remove: [], add: ['gap-2'] }] });
		const { writeFileSync } = await import('node:fs');
		writeFileSync(join(project.dir, PAGE), read() + '\n<!-- agent edit -->\n');
		expect(() => ws.undo()).toThrow();
	});
});

describe('tokens and components', () => {
	test('edits one token line', () => {
		const css = readFileSync(join(project.dir, 'src/app.css'), 'utf8');
		const tokens = ws.editToken({ name: '--primary', value: 'oklch(0.5 0.2 30)', scope: 'light' });
		const next = readFileSync(join(project.dir, 'src/app.css'), 'utf8');
		const diff = next.split('\n').filter((line, i) => line !== css.split('\n')[i]);
		expect(diff).toEqual(['\t--primary: oklch(0.5 0.2 30);']);
		const primary = tokens.tokens.find((t) => t.name === '--primary')!;
		expect(primary.value).toBe('oklch(0.5 0.2 30)');
		expect(primary.darkAlias).toBe('--brand-500');
		expect(primary.type).toBe('color');
		expect(tokens.darkSelector).toBe('.dark');
	});

	test('extracts props and tv() variants', () => {
		const components = ws.components();
		const button = components.find((c) => c.file.endsWith('ui/button/button.svelte'))!;
		expect(button.variants.map((v) => v.name)).toEqual(['variant', 'size']);
		expect(button.variants[0].options).toContain('outline');
		expect(button.variants[0].default).toBe('default');
		expect(button.exportedAs).toContain('Button');
		const nav = components.find((c) => c.file.endsWith('nav-item.svelte'))!;
		expect(nav.props.map((p) => p.name)).toEqual(['href', 'text', 'icon', 'variant', 'badge', 'class']);
		expect(nav.props.find((p) => p.name === 'text')!.control).toBe('text');
		expect(nav.variants[0].options).toEqual(['normal', 'active']);
	});
});

describe('inspect', () => {
	test('describes attributes, class form and text', () => {
		const info = ws.inspect({ ...at('<Child variant'), tag: 'Child' })!;
		expect(info.isComponent).toBe(true);
		expect(info.attributes.find((a) => a.name === 'variant')).toEqual({ name: 'variant', kind: 'string', value: 'secondary' });
		const span = ws.inspect(at('<span'))!;
		expect(span.classForm).toBe('call');
		expect(span.staticClasses).toEqual(['p-4']);
		expect(span.dynamicClasses).toEqual(["active && 'mt-1'"]);
		expect(span.text).toBe('Badge');
	});
});

describe('code panel writes', () => {
	test('writes, coalesces into one undo step and refuses invalid Svelte or stale bases', async () => {
		const temp = tempProject('kit2-app', { 'src/routes/+page.svelte': '<h1 class="text-lg">Hi</h1>\n' });
		const ws = new Workspace(temp.dir);
		const file = 'src/routes/+page.svelte';
		const original = ws.read(file);
		expect(ws.writeText({ file, content: '<h1 class="text-xl">Hi</h1>\n', base: original }).ok).toBe(true);
		const second = ws.writeText({ file, content: '<h1 class="text-xl">Hello</h1>\n' });
		expect(second.ok).toBe(true);
		const broken = ws.writeText({ file, content: '<h1 class="text-xl">Hello</h2>\n' });
		expect(broken.ok).toBe(false);
		expect(broken.error).toBeTruthy();
		expect(ws.read(file)).toBe('<h1 class="text-xl">Hello</h1>\n');
		const stale = ws.writeText({ file, content: 'x', base: original });
		expect(stale.conflict).toBe(true);
		ws.undo();
		expect(ws.read(file)).toBe(original);
		// A coalesced run that ends where it started leaves no undo step behind.
		ws.writeText({ file, content: '<h1 class="text-2xl">Hi</h1>\n' });
		ws.writeText({ file, content: original });
		expect(ws.undo()).toBe(null);
		temp.cleanup();
	});
});
