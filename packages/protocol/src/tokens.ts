/** A CSS custom property declared in the project's global stylesheet. */
export interface DesignToken {
	/** Name including the leading dashes, e.g. "--primary". */
	name: string;
	/** Raw value in the light/default scope (`:root` or `@theme`). */
	value: string | null;
	/** Raw value in the dark scope (`.dark` / `[data-theme=dark]`), when declared. */
	darkValue: string | null;
	/** "color" when the value parses as a color or aliases one. */
	type: 'color' | 'length' | 'shadow' | 'font' | 'number' | 'other';
	/** Name of the token this one aliases via var(), if any. */
	alias: string | null;
	darkAlias: string | null;
	/** Where it was declared: ":root", ".dark", "@theme", "@theme inline". */
	scopes: string[];
	/** Tailwind utility namespace when exposed through @theme, e.g. "color-primary" → "bg-primary". */
	utility: string | null;
	/** Comment immediately preceding the declaration, used as a description. */
	description: string | null;
	group: string | null;
}

export interface DesignTokens {
	file: string | null;
	tokens: DesignToken[];
	/** Name of the class or attribute that switches dark mode, e.g. ".dark". */
	darkSelector: string | null;
}

export interface TokenEdit {
	name: string;
	value: string;
	scope: 'light' | 'dark';
}
