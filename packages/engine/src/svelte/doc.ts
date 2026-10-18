import { parse, type AST } from 'svelte/compiler';

export type ElementLike = AST.RegularElement | AST.Component | AST.SvelteElement | AST.SlotElement | AST.TitleElement;
export type TemplateNode = AST.Fragment['nodes'][number];

const ELEMENT_TYPES = new Set(['RegularElement', 'Component', 'SvelteElement', 'SlotElement', 'TitleElement']);

export const isElementLike = (node: { type: string }): node is ElementLike => ELEMENT_TYPES.has(node.type);

/** Child fragments of any template node (elements, blocks, snippets). */
export function childFragments(node: TemplateNode | AST.Root): AST.Fragment[] {
	const n = node as unknown as Record<string, unknown>;
	const out: AST.Fragment[] = [];
	for (const key of ['fragment', 'consequent', 'alternate', 'body', 'fallback', 'pending', 'then', 'catch', 'children']) {
		const value = n[key] as AST.Fragment | null | undefined;
		if (value && typeof value === 'object' && (value as AST.Fragment).type === 'Fragment') out.push(value);
	}
	return out;
}

export interface Located<T> {
	node: T;
	/** The fragment that directly contains the node. */
	parentFragment: AST.Fragment;
	/** Nearest element-like ancestor (null at the root). */
	parentElement: ElementLike | null;
	/** Block nodes between the node and its parent element ({#if}, {#each}…), nearest first. */
	blocks: TemplateNode[];
	/** Child-index path from the root through fragments, used to re-find nodes across versions. */
	path: number[];
}

/** A parsed .svelte file with helpers to address nodes by line/column. */
export class SvelteDoc {
	readonly ast: AST.Root;
	private lineStarts: number[];

	constructor(readonly source: string) {
		this.ast = parse(source, { modern: true });
		this.lineStarts = [0];
		for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
	}

	/** Offset from a 1-based line and 0-based column (Svelte's __svelte_meta convention). */
	offsetOf(line: number, column: number): number {
		const start = this.lineStarts[line - 1];
		if (start === undefined) return -1;
		return start + column;
	}

	lineColumnOf(offset: number): { line: number; column: number } {
		let lo = 0,
			hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo + 1, column: offset - this.lineStarts[lo] };
	}

	/** Visits every template node with its location context. Return false to stop. */
	walk(visit: (located: Located<TemplateNode>) => boolean | void) {
		const go = (fragment: AST.Fragment, parentElement: ElementLike | null, blocks: TemplateNode[], path: number[]): boolean => {
			for (let i = 0; i < fragment.nodes.length; i++) {
				const node = fragment.nodes[i];
				const here = [...path, i];
				if (visit({ node, parentFragment: fragment, parentElement, blocks, path: here }) === false) return false;
				const element = isElementLike(node) ? node : null;
				for (const [j, child] of childFragments(node).entries()) {
					const nextBlocks = element ? [] : [node, ...blocks];
					if (!go(child, element ?? parentElement, nextBlocks, [...here, j])) return false;
				}
			}
			return true;
		};
		go(this.ast.fragment, null, [], []);
	}

	/** Finds the element/component whose opening `<` is at `offset`. */
	elementAt(offset: number): Located<ElementLike> | null {
		let found: Located<ElementLike> | null = null;
		this.walk((located) => {
			if (located.node.start === offset && isElementLike(located.node)) {
				found = located as Located<ElementLike>;
				return false;
			}
		});
		return found;
	}

	elementAtLoc(line: number, column: number): Located<ElementLike> | null {
		const offset = this.offsetOf(line, column);
		return offset < 0 ? null : this.elementAt(offset);
	}

	/** Follows a child-index path produced by `walk`. */
	nodeAtPath(path: number[]): Located<TemplateNode> | null {
		let found: Located<TemplateNode> | null = null;
		const key = path.join('.');
		this.walk((located) => {
			const here = located.path.join('.');
			if (here === key) {
				found = located;
				return false;
			}
		});
		return found;
	}

	/** Offset right after the `>` of an element's opening tag. */
	openTagEnd(node: ElementLike): number {
		const attrs = node.attributes;
		let i = attrs.length ? attrs[attrs.length - 1].end : node.start + 1 + node.name.length;
		let quote: string | null = null;
		let depth = 0;
		for (; i < node.end; i++) {
			const ch = this.source[i];
			if (quote) {
				if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'") quote = ch;
			else if (ch === '{') depth++;
			else if (ch === '}') depth--;
			else if (ch === '>' && depth === 0) return i + 1;
		}
		return node.end;
	}

	isSelfClosing(node: ElementLike): boolean {
		return this.source[this.openTagEnd(node) - 2] === '/';
	}

	/** Offset of the `<` of the closing tag (or node.end for self-closing tags). */
	closeTagStart(node: ElementLike): number {
		if (this.isSelfClosing(node)) return node.end;
		return this.source.lastIndexOf('</', node.end - 1);
	}

	/** Leading whitespace of the line containing `offset`. */
	indentAt(offset: number): string {
		const lineStart = this.source.lastIndexOf('\n', offset - 1) + 1;
		return this.source.slice(lineStart, offset).match(/^[\t ]*/)![0];
	}

	/** Whether only whitespace precedes `offset` on its line. */
	startsLine(offset: number): boolean {
		const lineStart = this.source.lastIndexOf('\n', offset - 1) + 1;
		return /^[\t ]*$/.test(this.source.slice(lineStart, offset));
	}

	/** The file's indentation unit, sniffed from the markup (tabs win ties). */
	indentUnit(): string {
		let tabs = 0;
		const spaces = new Map<number, number>();
		for (const line of this.source.split('\n')) {
			const m = line.match(/^([\t ]+)\S/);
			if (!m) continue;
			if (m[1].startsWith('\t')) tabs++;
			else spaces.set(m[1].length, (spaces.get(m[1].length) ?? 0) + 1);
		}
		const spaceLines = [...spaces.values()].reduce((a, b) => a + b, 0);
		if (tabs >= spaceLines) return '\t';
		const smallest = Math.min(...[...spaces.keys()].filter((n) => n > 0));
		return ' '.repeat(Number.isFinite(smallest) && smallest <= 8 ? smallest : 2);
	}

	/** Element-like children of an element, looking through blocks only if `throughBlocks`. */
	elementChildren(fragment: AST.Fragment): ElementLike[] {
		return fragment.nodes.filter(isElementLike);
	}
}
