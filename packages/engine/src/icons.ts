import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IconInfo, IconLibrary } from '@codesigner/protocol';

/** Lucide's Svelte packages, newest first: they share the `dist/icons` layout. */
const LIBRARIES = ['@lucide/svelte', 'lucide-svelte'];

const cache = new Map<string, IconLibrary | null>();

/** Finds `node_modules/<name>` from the project root upwards, like Node's resolution. */
function packageDir(root: string, name: string): string | null {
	for (let dir = root; ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

/** The `iconNode` literal of a generated lucide icon component. */
function iconNode(source: string): IconInfo['node'] | null {
	const match = /const iconNode(?::[^=]+)?\s*=\s*(\[[\s\S]*?\]);\n/.exec(source);
	if (!match) return null;
	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

/**
 * The icon library the project depends on, with every icon's drawing so the
 * editor can preview them without loading the package. Cached per project and
 * package version.
 */
export function scanIcons(root: string): IconLibrary | null {
	for (const from of LIBRARIES) {
		const dir = packageDir(root, from);
		if (!dir) continue;
		let version = '';
		try {
			version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? '';
		} catch {
			// unreadable package.json: scan without caching by version
		}
		const key = `${dir}@${version}`;
		if (cache.has(key)) return cache.get(key)!;
		const index = join(dir, 'dist', 'icons', 'index.js');
		if (!existsSync(index)) continue;
		const icons: IconInfo[] = [];
		for (const [, name, file] of readFileSync(index, 'utf8').matchAll(/export \{ default as (\w+) \} from '\.\/([\w-]+\.svelte)'/g)) {
			try {
				const node = iconNode(readFileSync(join(dir, 'dist', 'icons', file), 'utf8'));
				if (node) icons.push({ name, node });
			} catch {
				// a missing icon file: skip it
			}
		}
		const library = icons.length ? { from, icons } : null;
		cache.set(key, library);
		return library;
	}
	return null;
}
