import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { KitInfo, PackageManager } from '@codesigner/protocol';

export interface DetectedProject {
	root: string;
	name: string;
	kit: KitInfo;
	packageManager: PackageManager;
	cssEntry: string | null;
	isGitRepo: boolean;
	devScript: string | null;
}

export class NotASvelteKitProjectError extends Error {
	constructor(root: string) {
		super(`No SvelteKit project found in ${root} (expected @sveltejs/kit in package.json)`);
	}
}

function readJson(file: string): Record<string, any> | null {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

function installedVersion(root: string, pkg: string): string | null {
	return readJson(join(root, 'node_modules', pkg, 'package.json'))?.version ?? null;
}

function declaredVersion(pkgJson: Record<string, any>, pkg: string): string | null {
	const range: string | undefined = pkgJson.dependencies?.[pkg] ?? pkgJson.devDependencies?.[pkg];
	return range?.match(/\d+(\.\d+){0,2}/)?.[0] ?? null;
}

export function detectPackageManager(root: string, pkgJson?: Record<string, any> | null): PackageManager {
	const field: string | undefined = (pkgJson ?? readJson(join(root, 'package.json')))?.packageManager;
	const fromField = field?.split('@')[0];
	if (fromField === 'bun' || fromField === 'pnpm' || fromField === 'yarn' || fromField === 'npm') return fromField;
	if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
	if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
	if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
	return 'npm';
}

const CSS_CANDIDATES = ['src/app.css', 'src/routes/layout.css', 'src/app.pcss', 'src/styles/app.css', 'src/lib/styles/app.css'];

/** Finds the global stylesheet that imports Tailwind and holds the design tokens. */
export function findCssEntry(root: string): string | null {
	const components = readJson(join(root, 'components.json'));
	const fromShadcn: string | undefined = components?.tailwind?.css;
	if (fromShadcn && existsSync(join(root, fromShadcn))) return fromShadcn;
	for (const candidate of CSS_CANDIDATES) {
		if (existsSync(join(root, candidate))) return candidate;
	}
	// Fall back to the first stylesheet under src/ that imports tailwindcss.
	const stack = [join(root, 'src')];
	while (stack.length) {
		const dir = stack.pop()!;
		let entries: string[] = [];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (entry === 'node_modules' || entry.startsWith('.')) continue;
			if (statSync(full).isDirectory()) stack.push(full);
			else if (/\.(p?css)$/.test(entry) && /@import\s+['"]tailwindcss/.test(readFileSync(full, 'utf8'))) {
				return relative(root, full);
			}
		}
	}
	return null;
}

export function detectProject(root: string): DetectedProject {
	const pkgJson = readJson(join(root, 'package.json'));
	if (!pkgJson) throw new NotASvelteKitProjectError(root);
	const kitVersion = installedVersion(root, '@sveltejs/kit') ?? declaredVersion(pkgJson, '@sveltejs/kit');
	if (!kitVersion) throw new NotASvelteKitProjectError(root);

	const configFile = ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts']
		.map((f) => join(root, f))
		.find((f) => existsSync(f));
	const imports = pkgJson.imports as Record<string, string> | undefined;

	return {
		root,
		name: pkgJson.name && pkgJson.name !== 'package' ? String(pkgJson.name) : basename(root),
		kit: {
			version: kitVersion,
			major: Number(kitVersion.split('.')[0]) || null,
			svelteVersion: installedVersion(root, 'svelte') ?? declaredVersion(pkgJson, 'svelte'),
			configFile: configFile ?? null,
			routesDir: 'src/routes',
			libDir: 'src/lib',
			libAlias: imports && ('#lib/*' in imports || '#lib' in imports) ? '#lib' : '$lib'
		},
		packageManager: detectPackageManager(root, pkgJson),
		cssEntry: findCssEntry(root),
		isGitRepo: existsSync(join(root, '.git')),
		devScript: pkgJson.scripts?.dev ?? null
	};
}
