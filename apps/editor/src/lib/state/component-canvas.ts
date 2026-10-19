import type { ComponentInfo, ComponentProp } from '@codesigner/protocol';
import { m } from '#lib/paraglide/messages.js';

export interface CanvasCell {
	label: string;
	props: Record<string, unknown>;
	/** Variant values this cell renders (what an edit in it targets). */
	context: Record<string, string>;
	/** Forced interaction state: hover, active (Pressed) or focus. */
	state?: 'hover' | 'active' | 'focus';
}

export interface CanvasSpec {
	file: string;
	name: string;
	/** Text passed as children (null when the component takes no children). */
	text: string | null;
	sections: { title: string; cells: CanvasCell[] }[];
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const STATE_LABELS = { hover: 'Hover', active: 'Pressed', focus: 'Focus' } as const;
export const STATE_PREFIX = { hover: 'hover:', active: 'active:', focus: 'focus-visible:' } as const;

/**
 * Framer's component canvas for a tv() component: one row per value of the
 * main axis (`variant`) with Default / Hover / Pressed cells, then one row with
 * every value of the second axis (`size`).
 */
export function buildCanvasSpec(component: ComponentInfo): CanvasSpec {
	const groups = component.variants;
	const primary = groups.find((g) => g.name === 'variant') ?? groups[0];
	const secondary = groups.find((g) => g !== primary && g.name === 'size') ?? groups.find((g) => g !== primary);
	const takesChildren = component.props.some((p) => p.name === 'children');
	const sections: CanvasSpec['sections'] = [];
	if (primary) {
		for (const value of primary.options) {
			const context = { [primary.name]: value };
			sections.push({
				title: cap(value),
				cells: [undefined, 'hover', 'active'].map((state) => ({
					label: state ? `${cap(value)} · ${STATE_LABELS[state as 'hover']}` : cap(value),
					props: { [primary.name]: value },
					context,
					...(state ? { state: state as CanvasCell['state'] } : {})
				}))
			});
		}
	}
	if (secondary) {
		sections.push({
			title: cap(secondary.name),
			cells: secondary.options.map((value) => ({ label: `${cap(secondary.name)} ${value}`, props: { [secondary.name]: value }, context: { [secondary.name]: value } }))
		});
	}
	if (sections.length === 0) sections.push(...propSections(component));
	return { file: component.file, name: component.name, text: takesChildren ? component.name : null, sections };
}

/** A value a required prop can render with (its name as text, a link, the first option…). */
function sample(prop: ComponentProp): unknown {
	switch (prop.control) {
		case 'text':
			return cap(prop.name);
		case 'number':
			return 1;
		case 'link':
			return '#';
		case 'enum':
			return prop.options?.[0];
		case 'boolean':
			return false;
		default:
			return undefined;
	}
}

/**
 * Components without tv(): Default / Hover / Pressed, then a cell per boolean
 * prop (flipped from its default) and a row per enum prop, so their looks can
 * be compared and edited side by side like variants.
 */
function propSections(component: ComponentInfo): CanvasSpec['sections'] {
	const base: Record<string, unknown> = {};
	for (const prop of component.props) if (!prop.optional && prop.default === null && sample(prop) !== undefined) base[prop.name] = sample(prop);
	const sections: CanvasSpec['sections'] = [
		{
			title: component.name,
			cells: [undefined, 'hover', 'active'].map((state) => ({
				label: state ? STATE_LABELS[state as 'hover'] : m.state_default(),
				props: base,
				context: {},
				...(state ? { state: state as CanvasCell['state'] } : {})
			}))
		}
	];
	const booleans = component.props.filter((p) => p.control === 'boolean' && !p.bindable);
	if (booleans.length) {
		sections.push({
			title: m.component_props_section(),
			cells: booleans.map((p) => {
				const on = p.default !== 'true';
				return { label: on ? p.name : `${p.name}: false`, props: { ...base, [p.name]: on }, context: {} };
			})
		});
	}
	for (const p of component.props.filter((p) => p.control === 'enum' && p.options?.length)) {
		sections.push({ title: cap(p.name), cells: p.options!.map((value) => ({ label: value, props: { ...base, [p.name]: value }, context: {} })) });
	}
	return sections;
}
