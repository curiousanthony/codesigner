import type { ComponentInfo } from '@codesigner/protocol';

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
	if (sections.length === 0) sections.push({ title: component.name, cells: [{ label: component.name, props: {}, context: {} }] });
	return { file: component.file, name: component.name, text: takesChildren ? component.name : null, sections };
}
