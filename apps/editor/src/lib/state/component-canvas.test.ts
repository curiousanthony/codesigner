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

	test('components without variants: Default / Hover / Pressed, a cell per boolean, a row per enum', () => {
		const prop = (name: string, control: string, extra: object = {}) => ({ name, control, type: null, default: null, optional: true, bindable: false, description: null, ...extra }) as ComponentInfo['props'][number];
		const spec = buildCanvasSpec({
			...button,
			name: 'StatusPill',
			variants: [],
			props: [
				prop('label', 'text', { optional: false }),
				prop('active', 'boolean', { default: 'false' }),
				prop('compact', 'boolean', { default: 'true' }),
				prop('tone', 'enum', { options: ['info', 'warning'] }),
				prop('open', 'boolean', { bindable: true })
			]
		});
		expect(spec.sections.map((s) => s.title)).toEqual(['StatusPill', 'Props', 'Tone']);
		expect(spec.sections[0].cells.map((c) => c.state)).toEqual([undefined, 'hover', 'active']);
		expect(spec.sections[0].cells[0].props).toEqual({ label: 'Label' });
		expect(spec.sections[1].cells).toEqual([
			{ label: 'active', props: { label: 'Label', active: true }, context: {} },
			{ label: 'compact: false', props: { label: 'Label', compact: false }, context: {} }
		]);
		expect(spec.sections[2].cells.map((c) => c.props.tone)).toEqual(['info', 'warning']);
		expect(spec.text).toBe(null);
	});
});
