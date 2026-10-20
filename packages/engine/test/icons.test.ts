import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/workspace';
import { scanIcons } from '../src/icons';
import { locOf, tempProject } from './helpers';

const project = tempProject('kit2-app', {});
afterAll(project.cleanup);
const ws = new Workspace(project.dir);

describe('icon props', () => {
	test('passing an icon adds its import next to the existing one', async () => {
		const path = 'src/lib/components/IconDemo.svelte';
		writeFileSync(
			join(project.dir, path),
			"<script lang=\"ts\">\n\timport { Settings } from '@lucide/svelte';\n\timport NavItem from './app/nav-item.svelte';\n</script>\n\n<NavItem href=\"/\" text=\"Home\" />\n"
		);
		const result = await ws.apply({
			label: 'icon',
			ops: [
				{
					type: 'attribute',
					target: { ...locOf(readFileSync(join(project.dir, path), 'utf8'), '<NavItem', path), tag: 'NavItem' },
					name: 'icon',
					value: 'House',
					kind: 'expression',
					imports: [{ kind: 'named', local: 'House', from: '@lucide/svelte' }]
				}
			]
		});
		expect(result.ok).toBe(true);
		const text = readFileSync(join(project.dir, path), 'utf8');
		expect(text).toContain("import { Settings, House } from '@lucide/svelte';");
		expect(text).toContain('<NavItem href="/" text="Home" icon={House} />');
		expect(result.relocated).toBeUndefined(); // added to an existing import: no line shift
	});

	test('a new import line shifts the layer (reported), and a taken name gets renamed', async () => {
		const path = 'src/lib/components/IconClash.svelte';
		writeFileSync(join(project.dir, path), "<script lang=\"ts\">\n\timport NavItem from './app/nav-item.svelte';\n\tconst User = 'Ada';\n</script>\n\n<NavItem href=\"/\" text={User} />\n");
		const target = { ...locOf(readFileSync(join(project.dir, path), 'utf8'), '<NavItem', path), tag: 'NavItem' };
		const result = await ws.apply({
			label: 'icon',
			ops: [{ type: 'attribute', target, name: 'icon', value: 'User', kind: 'expression', imports: [{ kind: 'named', local: 'User', from: '@lucide/svelte' }] }]
		});
		const text = readFileSync(join(project.dir, path), 'utf8');
		expect(text).toContain("import { User as User2 } from '@lucide/svelte';");
		expect(text).toContain('<NavItem href="/" text={User} icon={User2} />');
		expect(result.relocated?.[`${path}:${target.line}:${target.column}`]).toEqual({ ...target, line: target.line + 1 });
	});

	test('swapping or removing an icon drops the import nothing uses any more', async () => {
		const path = 'src/lib/components/IconSwap.svelte';
		const write = (text: string) => writeFileSync(join(project.dir, path), text);
		const read = () => readFileSync(join(project.dir, path), 'utf8');
		const target = () => ({ ...locOf(read(), '<NavItem', path), tag: 'NavItem' });
		write("<script lang=\"ts\">\n\timport { User, Settings } from '@lucide/svelte';\n\timport NavItem from './app/nav-item.svelte';\n</script>\n\n<NavItem href=\"/\" text=\"Me\" icon={User} />\n<Settings />\n");
		const swap = async (value: string | null) =>
			ws.apply({
				label: 'icon',
				ops: [{ type: 'attribute', target: target(), name: 'icon', value, kind: 'expression', imports: value ? [{ kind: 'named', local: value, from: '@lucide/svelte' }] : [] }]
			});
		await swap('House');
		expect(read()).toContain("import { Settings, House } from '@lucide/svelte';");
		expect(read()).toContain('icon={House}');
		await swap(null);
		expect(read()).toContain("import { Settings } from '@lucide/svelte';");
		expect(read()).toContain('<NavItem href="/" text="Me" />');
	});

	test('scans a lucide package: names from the index, drawings from each icon', () => {
		const dir = join(project.dir, 'node_modules', '@lucide', 'svelte');
		mkdirSync(join(dir, 'dist', 'icons'), { recursive: true });
		writeFileSync(join(dir, 'package.json'), '{"name":"@lucide/svelte","version":"9.9.9-test"}');
		writeFileSync(join(dir, 'dist', 'icons', 'index.js'), "export { default as House } from './house.svelte';\nexport { default as Broken } from './broken.svelte';\n");
		writeFileSync(join(dir, 'dist', 'icons', 'house.svelte'), '<script>\nconst iconNode = [["path", { "d": "M3 10v9" }]];\n</script>\n');
		const library = scanIcons(project.dir);
		expect(library?.from).toBe('@lucide/svelte');
		expect(library?.icons).toEqual([{ name: 'House', node: [['path', { d: 'M3 10v9' }]] }]);
	});
});
