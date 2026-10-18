import { describe, expect, test } from 'vitest';
import type { ComponentInfo } from '@codesigner/protocol';
import { buildCanvasSpec } from './component-canvas';

const button: ComponentInfo = {
	name: 'Button',
	file: 'src/lib/components/ui/button/button.svelte',
	importPath: '$lib/components/ui/button',
	group: 'ui',
	exportedAs: ['Button'],
	props: [{ name: 'children', control: 'snippet', type: null, default: null, optional: true, bindable: false, description: null }],
	variants: [
		{ name: 'variant', options: ['default', 'destructive'], default: 'default' },
		{ name: 'size', options: ['default', 'sm'], default: 'default' }
	]
};

describe('component canvas spec', () => {
	test('one row per variant with Default / Hover / Pressed, then sizes', () => {
		const spec = buildCanvasSpec(button);
		expect(spec.sections.map((s) => s.title)).toEqual(['Default', 'Destructive', 'Size']);
		expect(spec.sections[1].cells.map((c) => c.label)).toEqual(['Destructive', 'Destructive · Hover', 'Destructive · Pressed']);
		expect(spec.sections[1].cells[2]).toMatchObject({ state: 'active', context: { variant: 'destructive' } });
		expect(spec.sections[2].cells[1]).toMatchObject({ label: 'Size sm', props: { size: 'sm' } });
		expect(spec.text).toBe('Button');
	});

	test('components without variants get a single cell', () => {
		const spec = buildCanvasSpec({ ...button, variants: [], props: [] });
		expect(spec.sections).toEqual([{ title: 'Button', cells: [{ label: 'Button', props: {}, context: {} }] }]);
		expect(spec.text).toBe(null);
	});
});
