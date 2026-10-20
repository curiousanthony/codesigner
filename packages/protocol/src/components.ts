import type { SourceLoc } from './bridge.js';

/** A .svelte component discovered in the project (src/lib by default). */
export interface ComponentInfo {
	/** Display name, e.g. "Button" or "NavItem". */
	name: string;
	/** File relative to the working copy. */
	file: string;
	/** Import specifier used by the project, e.g. "$lib/components/ui/button". */
	importPath: string;
	/** Folder-based grouping, e.g. "ui" for shadcn components. */
	group: string;
	props: ComponentProp[];
	/** tailwind-variants `tv()` variant groups (shadcn-svelte), e.g. { variant: [...], size: [...] }. */
	variants: VariantGroup[];
	/** Index modules exporting this component under other names (e.g. Card.Root). */
	exportedAs: string[];
	/** Takes `class` (or spreads its other props), so styling an instance reaches its root. */
	acceptsClass?: boolean;
}

export interface ComponentProp {
	name: string;
	/** Simplified control type for the properties panel. */
	control: 'text' | 'number' | 'boolean' | 'enum' | 'color' | 'link' | 'icon' | 'snippet' | 'unknown';
	/** Raw TypeScript type text when known. */
	type: string | null;
	options?: string[];
	default: string | null;
	optional: boolean;
	bindable: boolean;
	description: string | null;
}

export interface VariantGroup {
	name: string;
	options: string[];
	default: string | null;
}

/** A component usage (instance) in source with its current prop values. */
export interface ComponentInstance {
	component: ComponentInfo | null;
	/** Name as written in the markup, e.g. "Button" or "Card.Root". */
	tagName: string;
	loc: SourceLoc;
	props: Record<string, InstancePropValue>;
}

export type InstancePropValue =
	| { kind: 'string'; value: string }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'expression'; source: string }
	| { kind: 'spread'; source: string };

/** An image in static/ (served as `src`) or src/lib/assets (`src` is the import specifier). */
export interface ImageAsset {
	name: string;
	/** Relative to the working copy. */
	file: string;
	kind: 'static' | 'lib';
	src: string;
}

/** An icon component the project can import, with its SVG drawing for previews. */
export interface IconInfo {
	/** Exported component name, e.g. `House`. */
	name: string;
	/** Lucide-style icon node: `[tag, attributes][]` drawn in a 24×24 stroke viewBox. */
	node: [string, Record<string, string>][];
}

export interface IconLibrary {
	/** Module the icons are imported from, e.g. `@lucide/svelte`. */
	from: string;
	icons: IconInfo[];
}
