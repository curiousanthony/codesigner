import { cpSync, mkdtempSync, symlinkSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const fixture = (name: string) => join(import.meta.dir, '../../../fixtures', name);

/** Copies a fixture's sources to a temp dir (sharing node_modules) so tests can write freely. */
export function tempProject(name = 'kit2-app', files: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'codesigner-test-'));
	const src = fixture(name);
	for (const entry of ['src', 'package.json', 'components.json', 'svelte.config.js', 'vite.config.ts']) {
		try {
			cpSync(join(src, entry), join(dir, entry), { recursive: true });
		} catch {
			// optional file
		}
	}
	symlinkSync(join(src, 'node_modules'), join(dir, 'node_modules'));
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(join(dir, file), text);
	}
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 1-based line / 0-based column of the first occurrence of `needle`. */
export function locOf(text: string, needle: string, file: string) {
	const offset = text.indexOf(needle);
	if (offset < 0) throw new Error(`"${needle}" not found`);
	const before = text.slice(0, offset);
	const line = before.split('\n').length;
	const column = offset - (before.lastIndexOf('\n') + 1);
	return { file, line, column };
}
