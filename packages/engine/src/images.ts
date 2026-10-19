import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ImageAsset } from '@codesigner/protocol';

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const LIMIT = 400;

function walk(dir: string, out: string[], depth = 0) {
	if (out.length >= LIMIT || depth > 6) return;
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.startsWith('.') || entry === 'node_modules') continue;
		const full = join(dir, entry);
		let stat;
		try {
			stat = statSync(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) walk(full, out, depth + 1);
		else if (IMAGE.test(entry)) out.push(full);
		if (out.length >= LIMIT) return;
	}
}

/**
 * Images the app can show: files in static/ (served at their path) and in
 * src/lib/assets (imported, so Vite fingerprints them).
 */
export function scanImages(root: string): ImageAsset[] {
	const out: ImageAsset[] = [];
	for (const [dir, kind] of [
		['static', 'static'],
		['src/lib/assets', 'lib']
	] as const) {
		const files: string[] = [];
		walk(join(root, dir), files);
		for (const full of files) {
			const file = relative(root, full).split('\\').join('/');
			const inDir = file.slice(dir.length + 1);
			out.push({
				name: inDir.split('/').at(-1)!,
				file,
				kind,
				src: kind === 'static' ? `/${inDir}` : `$lib/assets/${inDir}`
			});
		}
	}
	return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file));
}
