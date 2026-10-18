import { afterAll, describe, expect, test } from 'bun:test';
import { Workspace } from '../src/workspace';
import { tempProject } from './helpers';

const BUTTON = 'src/lib/components/ui/button/button.svelte';
const project = tempProject();
afterAll(() => project.cleanup());
const ws = new Workspace(project.dir);
const line = (text: string, key: string) => text.split('\n').find((l) => l.trim().startsWith(`${key}:`))?.trim() ?? '';

describe('variant editing (Framer component variants)', () => {
	test('changes only the edited variant entry', async () => {
		const before = ws.read(BUTTON);
		const result = await ws.apply({
			label: 'Fill',
			ops: [{ type: 'variant-classes', file: BUTTON, context: { variant: 'destructive' }, remove: ['bg-destructive/10'], add: ['bg-red-600'] }]
		});
		expect(result.ok).toBe(true);
		const after = ws.read(BUTTON);
		expect(line(after, 'destructive')).toContain('bg-red-600');
		expect(line(after, 'destructive')).not.toContain('bg-destructive/10 ');
		expect(line(after, 'default')).toBe(line(before, 'default'));
		expect(after.match(/base: "[^"]*"/)![0]).toBe(before.match(/base: "[^"]*"/)![0]);
		ws.undo();
		expect(ws.read(BUTTON)).toBe(before);
	});

	test('hover state edits write hover: tokens into the variant', async () => {
		await ws.apply({
			label: 'Fill',
			ops: [{ type: 'variant-classes', file: BUTTON, context: { variant: 'default' }, remove: [], add: ['hover:bg-primary/60'] }]
		});
		expect(line(ws.read(BUTTON), 'default')).toBe('default: "bg-primary text-primary-foreground hover:bg-primary/60",');
		ws.undo();
	});

	test('a value controlled by a shared axis gets a compound entry for this variant only', async () => {
		const before = ws.read(BUTTON);
		const result = await ws.apply({ label: 'Height', ops: [{ type: 'variant-classes', file: BUTTON, context: { variant: 'destructive' }, remove: [], add: ['h-10'] }] });
		expect(result.ok).toBe(true);
		const text = ws.read(BUTTON);
		expect(line(text, 'default')).toBe(line(before, 'default'));
		expect(text).toContain('compoundVariants: [\n\t\t\t{ variant: "destructive", class: "h-10" },\n\t\t],');
		// A second edit of the same combination updates that compound entry in place.
		await ws.apply({ label: 'Height', ops: [{ type: 'variant-classes', file: BUTTON, context: { variant: 'destructive' }, remove: [], add: ['h-12'] }] });
		expect(ws.read(BUTTON)).toContain('{ variant: "destructive", class: "h-12" }');
		ws.undo();
		ws.undo();
		expect(ws.read(BUTTON)).toBe(before);
	});

	test('size-like changes go to the size axis', async () => {
		await ws.apply({ label: 'Height', ops: [{ type: 'variant-classes', file: BUTTON, context: { size: 'sm' }, remove: [], add: ['h-10'] }] });
		const text = ws.read(BUTTON);
		expect(line(text, 'sm')).toStartWith('sm: "h-10 gap-1');
		ws.undo();
	});

	test('adds a variant value copied from the default', async () => {
		await ws.apply({ label: 'Add variant', ops: [{ type: 'add-variant', file: BUTTON, axis: 'variant', value: 'brand' }] });
		expect(line(ws.read(BUTTON), 'brand')).toBe('brand: "bg-primary text-primary-foreground hover:bg-primary/80",');
		ws.undo();
	});
});
