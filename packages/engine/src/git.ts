import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { DesignBranch, SourceBranch } from '@codesigner/protocol';
import { ShipError } from './errors.js';

export function git(cwd: string, args: string[], input?: string): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		input,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	}).trimEnd();
}

function tryGit(cwd: string, args: string[]): string | null {
	try {
		return git(cwd, args);
	} catch {
		return null;
	}
}

export const DESIGN_PREFIX = 'design/';

export function slugifyBranch(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9/._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-/.]+|[-/.]+$/g, '');
	return slug || 'untitled';
}

/** Where design worktrees live: outside the repo so editors and watchers ignore them. */
export function worktreesHome(repoRoot: string): string {
	const id = createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 8);
	return join(homedir(), '.codesigner', 'worktrees', `${basename(repoRoot)}-${id}`);
}

export function currentBranch(cwd: string): string | null {
	return tryGit(cwd, ['symbolic-ref', '--short', 'HEAD']);
}

export function defaultBaseBranch(repoRoot: string): string {
	for (const candidate of ['develop', 'main', 'master']) {
		if (tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]) !== null) return candidate;
	}
	return currentBranch(repoRoot) ?? 'HEAD';
}

/**
 * Branches a design can start from: local ones, then remote-tracking ones with
 * no local counterpart, each group sorted by last commit (newest first).
 */
export function listSourceBranches(repoRoot: string): SourceBranch[] {
	const out = tryGit(repoRoot, [
		'for-each-ref',
		'--sort=-committerdate',
		'--format=%(refname)%09%(HEAD)%09%(committerdate:iso-strict)%09%(subject)',
		'refs/heads',
		'refs/remotes'
	]);
	if (!out) return [];
	const local: SourceBranch[] = [];
	const remote: SourceBranch[] = [];
	for (const line of out.split('\n')) {
		const [ref, head, date, ...subject] = line.split('\t');
		if (ref.startsWith('refs/heads/')) {
			local.push({ name: ref.slice(11), remote: false, current: head === '*', date, subject: subject.join('\t') });
		} else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
			remote.push({ name: ref.slice(13), remote: true, current: false, date, subject: subject.join('\t') });
		}
	}
	const names = new Set(local.map((b) => b.name));
	return [...local, ...remote.filter((b) => !names.has(b.name.slice(b.name.indexOf('/') + 1)))];
}

/** The main checkout and the design branches' worktrees. */
export function listBranches(repoRoot: string): DesignBranch[] {
	const out = tryGit(repoRoot, ['worktree', 'list', '--porcelain']);
	if (out === null) return [];
	const real = (path: string) => {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	};
	const mainRoot = real(repoRoot);
	const branches: DesignBranch[] = [];
	for (const block of out.split('\n\n')) {
		const lines = block.split('\n');
		const worktree = lines.find((l) => l.startsWith('worktree '))?.slice(9);
		if (!worktree || lines.includes('prunable') || lines.some((l) => l.startsWith('prunable'))) continue;
		const head = lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? null;
		const ref = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? null;
		const name = ref?.replace(/^refs\/heads\//, '') ?? '(detached)';
		const isMainCheckout = real(worktree) === mainRoot;
		// Other tools' worktrees (editors, agents) aren't ours to show, and checking each one is slow.
		if (!isMainCheckout && !name.startsWith(DESIGN_PREFIX)) continue;
		const base = isMainCheckout ? null : tryGit(repoRoot, ['config', `branch.${name}.codesigner-base`]);
		const dirty = (tryGit(worktree, ['status', '--porcelain']) ?? '')
			.split('\n')
			.some((line) => line && !ENV_FILE.test(line.slice(3)));
		let ahead: number | undefined;
		if (base) {
			const count = tryGit(repoRoot, ['rev-list', '--count', `${base}..${name}`]);
			ahead = count === null ? undefined : Number(count);
		}
		branches.push({ name, worktree, isMainCheckout, head, baseBranch: base, ahead, dirty });
	}
	return branches;
}

const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;

/**
 * Copies untracked env files (.env, .env.local, …) a fresh worktree needs to
 * boot. Tracked ones already come with the checkout.
 */
export function copyEnvFiles(fromRoot: string, toRoot: string): string[] {
	const tracked = new Set((tryGit(fromRoot, ['ls-files']) ?? '').split('\n'));
	const copied: string[] = [];
	for (const entry of readdirSync(fromRoot)) {
		if (ENV_FILE.test(entry) && !tracked.has(entry) && !existsSync(join(toRoot, entry))) {
			copyFileSync(join(fromRoot, entry), join(toRoot, entry));
			copied.push(entry);
		}
	}
	return copied;
}

/** Untracked env files that are not git-ignored: must never be committed by a checkpoint. */
function unignoredEnvFiles(worktree: string): string[] {
	return (tryGit(worktree, ['ls-files', '--others', '--exclude-standard']) ?? '')
		.split('\n')
		.filter((file) => file && ENV_FILE.test(file));
}

/** Creates `design/<name>` from `from` (default: develop/main) in its own worktree. */
export function createDesignBranch(repoRoot: string, name: string, from?: string): DesignBranch {
	const slug = slugifyBranch(name);
	const branch = slug.startsWith(DESIGN_PREFIX) ? slug : DESIGN_PREFIX + slug;
	const base = from ?? defaultBaseBranch(repoRoot);
	const home = worktreesHome(repoRoot);
	mkdirSync(home, { recursive: true });
	const dir = join(home, branch.slice(DESIGN_PREFIX.length).replace(/\//g, '-'));
	if (existsSync(dir)) throw new ShipError('folder-exists', `A copy for this branch already exists (${dir}). Pick another name.`);

	const exists = tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;
	// Reusing an existing branch would silently ignore the base the user picked.
	if (exists && from) throw new ShipError('name-taken', `A branch named ${slug.replace(/^design\//, '')} already exists. Pick another name.`, { name: slug.replace(/^design\//, '') });
	git(repoRoot, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, base]);
	git(repoRoot, ['config', `branch.${branch}.codesigner-base`, base]);
	copyEnvFiles(repoRoot, dir);

	return {
		name: branch,
		worktree: dir,
		isMainCheckout: false,
		head: tryGit(dir, ['rev-parse', 'HEAD']),
		baseBranch: base,
		ahead: 0,
		dirty: false
	};
}

/**
 * Commits everything in a design worktree as a checkpoint. Returns the new
 * commit sha, or null when there was nothing to commit.
 */
export function checkpoint(worktree: string, message: string): string | null {
	const status = tryGit(worktree, ['status', '--porcelain']);
	if (!status) return null;
	const excluded = unignoredEnvFiles(worktree).map((file) => `:(exclude,literal)${file}`);
	git(worktree, ['add', '-A', '--', '.', ...excluded]);
	if (tryGit(worktree, ['diff', '--cached', '--quiet']) !== null) return null; // nothing staged
	git(worktree, ['commit', '--no-verify', '-q', '-m', message]);
	return git(worktree, ['rev-parse', 'HEAD']);
}
