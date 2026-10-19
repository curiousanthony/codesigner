import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { ShipStatus, Version } from '@codesigner/protocol';
import { checkpoint, currentBranch, git } from './git.js';

/**
 * Version history and shipping for design branches. A design branch's
 * versions are its commits since its base (checkpoints); shipping lands them
 * on the base as one commit, or pushes the branch and opens a pull request.
 */

function tryGit(cwd: string, args: string[]): string | null {
	try {
		return git(cwd, args);
	} catch {
		return null;
	}
}

/** Trailer that marks checkpoints made automatically while designing. */
export const AUTO_TRAILER = 'Codesigner-Checkpoint';

export function baseOf(cwd: string, branch: string): string | null {
	return tryGit(cwd, ['config', `branch.${branch}.codesigner-base`]);
}

const isLocalBranch = (cwd: string, name: string) => tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null;

/** Commits a checkpoint; automatic ones carry a trailer so history can tell them apart. */
export function saveVersion(worktree: string, message: string, auto = false): string | null {
	return checkpoint(worktree, auto ? `${message}\n\n${AUTO_TRAILER}: auto` : message);
}

/** Versions of the design branch checked out in `worktree`, newest first. */
export function listVersions(worktree: string, limit = 100): Version[] {
	const branch = currentBranch(worktree);
	const base = branch ? baseOf(worktree, branch) : null;
	const range = base ? [`${base}..HEAD`] : ['HEAD'];
	const out = tryGit(worktree, [
		'log',
		`--max-count=${limit}`,
		`--format=%H%x09%cI%x09%s%x09%(trailers:key=${AUTO_TRAILER},valueonly,separator=)`,
		...range
	]);
	if (!out) return [];
	return out.split('\n').map((line) => {
		const [sha, date, subject, trailer] = line.split('\t');
		return { sha, date, subject, auto: (trailer ?? '').trim() === 'auto' };
	});
}

/**
 * Makes the working copy match `sha` as a new version: the current state is
 * saved first, so restoring never loses work and can itself be undone.
 */
export function restoreVersion(worktree: string, sha: string, label: string): string | null {
	saveVersion(worktree, 'Before restoring a version', true);
	git(worktree, ['restore', `--source=${sha}`, '--staged', '--worktree', '--', ':/']);
	return checkpoint(worktree, label);
}

/** The worktree where `branch` is checked out, if any. */
function worktreeOf(cwd: string, branch: string): string | null {
	const out = tryGit(cwd, ['worktree', 'list', '--porcelain']) ?? '';
	for (const block of out.split('\n\n')) {
		const lines = block.split('\n');
		if (lines.includes(`branch refs/heads/${branch}`)) return lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? null;
	}
	return null;
}

const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;
const isDirty = (worktree: string) =>
	(tryGit(worktree, ['status', '--porcelain']) ?? '').split('\n').some((line) => line && !ENV_FILE.test(line.slice(3)));

/** GitHub web URL of a remote (https or ssh form), or null for other hosts. */
export function githubUrl(remote: string): string | null {
	const m = remote.trim().match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
	return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

function hasGh(): boolean {
	try {
		execFileSync('gh', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

export function shipStatus(worktree: string): ShipStatus {
	const branch = currentBranch(worktree) ?? '';
	const base = baseOf(worktree, branch);
	const remote = tryGit(worktree, ['remote', 'get-url', 'origin']);
	const baseName = base?.replace(/^origin\//, '') ?? null;
	const count = (range: string) => Number(tryGit(worktree, ['rev-list', '--count', range]) ?? 0);
	const baseWorktree = base && isLocalBranch(worktree, base) ? worktreeOf(worktree, base) : null;
	const web = remote ? githubUrl(remote) : null;
	return {
		branch,
		base,
		baseIsLocal: !!base && isLocalBranch(worktree, base),
		ahead: base ? count(`${base}..HEAD`) : 0,
		behind: base ? count(`HEAD..${base}`) : 0,
		dirty: isDirty(worktree),
		remote,
		compareUrl: web && baseName ? `${web}/compare/${encodeURIComponent(baseName)}...${encodeURIComponent(branch)}?expand=1` : null,
		gh: !!remote && hasGh(),
		baseWorktree,
		baseDirty: baseWorktree ? isDirty(baseWorktree) : false
	};
}

export class ShipError extends Error {}

/**
 * Lands the design branch on its base as ONE commit (a squash, so the base's
 * history gets your message, not every checkpoint). Works without touching a
 * checkout when the base isn't checked out; when it is, that checkout must be
 * clean and is fast-forwarded. The design branch then restarts from the result.
 */
export function shipToBase(worktree: string, message: string): string {
	const branch = currentBranch(worktree);
	if (!branch) throw new ShipError('The design copy is not on a branch');
	const base = baseOf(worktree, branch);
	if (!base || !isLocalBranch(worktree, base)) throw new ShipError(`${base ?? 'The base'} is not a local branch: open a pull request instead`);
	saveVersion(worktree, message);
	const baseSha = git(worktree, ['rev-parse', base]);
	if (tryGit(worktree, ['diff', '--quiet', base, 'HEAD']) !== null) throw new ShipError(`Nothing to ship: ${branch} matches ${base}`);

	let tree: string;
	try {
		tree = git(worktree, ['merge-tree', '--write-tree', base, 'HEAD']).split('\n')[0];
	} catch {
		throw new ShipError(`${base} changed in ways that conflict with this design. Update from ${base} first.`);
	}
	const sha = git(worktree, ['commit-tree', tree, '-p', baseSha, '-m', message]);

	const baseWorktree = worktreeOf(worktree, base);
	if (baseWorktree) {
		if (isDirty(baseWorktree)) throw new ShipError(`${base} has uncommitted changes in ${baseWorktree}. Commit or stash them first.`);
		git(baseWorktree, ['merge', '--ff-only', '-q', sha]);
	} else {
		git(worktree, ['update-ref', `refs/heads/${base}`, sha, baseSha]);
	}
	// Start the design branch over from what was shipped (its checkpoints stay in the reflog).
	git(worktree, ['reset', '--keep', '-q', sha]);
	return sha;
}

/** Brings the base's new commits into the design branch (a merge; aborted on conflict). */
export function updateFromBase(worktree: string): void {
	const branch = currentBranch(worktree);
	const base = branch ? baseOf(worktree, branch) : null;
	if (!base) throw new ShipError('This design branch has no base');
	saveVersion(worktree, 'Before updating from base', true);
	try {
		git(worktree, ['merge', '--no-edit', '-q', base]);
	} catch {
		tryGit(worktree, ['merge', '--abort']);
		throw new ShipError(`Updating from ${base} conflicts with this design. Resolve it in your code editor (git merge ${base}).`);
	}
}

/** Pushes the design branch and opens a pull request into its base (gh), or returns the compare page. */
export function openPullRequest(worktree: string, title: string, body: string): { url: string; created: boolean } {
	const status = shipStatus(worktree);
	if (!status.remote) throw new ShipError('This repository has no "origin" remote');
	if (!status.base) throw new ShipError('This design branch has no base');
	saveVersion(worktree, title);
	git(worktree, ['push', '-u', 'origin', status.branch]);
	const base = status.base.replace(/^origin\//, '');
	if (status.gh) {
		try {
			const out = execFileSync('gh', ['pr', 'create', '--base', base, '--head', status.branch, '--title', title, '--body', body], {
				cwd: worktree,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			const url = out.trim().split('\n').at(-1) ?? '';
			if (/^https?:\/\//.test(url)) return { url, created: true };
		} catch (error) {
			// An open PR for this branch already exists: gh prints its URL.
			const text = String((error as { stderr?: string }).stderr ?? '');
			const existing = text.match(/https:\/\/\S+\/pull\/\d+/);
			if (existing) return { url: existing[0], created: false };
		}
	}
	if (status.compareUrl) return { url: status.compareUrl, created: false };
	throw new ShipError('Pushed. Open the pull request on your git host.');
}

export function renameDesignBranch(root: string, from: string, to: string): string {
	const name = to.startsWith('design/') ? to : `design/${to}`;
	if (!from.startsWith('design/')) throw new ShipError('Only design branches can be renamed here');
	git(root, ['branch', '-m', from, name]);
	return name;
}

/** Removes a design branch and its folder. Refuses unshipped work unless `force`. */
export function deleteDesignBranch(root: string, name: string, force = false): void {
	if (!name.startsWith('design/')) throw new ShipError('Only design branches can be deleted here');
	const dir = worktreeOf(root, name);
	if (dir && realpathSync(dir) === realpathSync(root)) throw new ShipError("The main checkout can't be deleted");
	if (!force && dir) {
		const status = shipStatus(dir);
		if (status.dirty || status.ahead > 0) throw new ShipError(`${name} has unshipped changes`);
	}
	if (dir) git(root, ['worktree', 'remove', '--force', dir]);
	git(root, ['branch', '-D', name]);
}
