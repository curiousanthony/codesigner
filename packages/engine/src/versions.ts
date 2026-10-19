import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { ShipStatus, Version } from '@codesigner/protocol';
import { checkpoint, currentBranch, git } from './git.js';
import { ShipError } from './errors.js';

export { ShipError };

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

/** `design/hero` → `hero`: the prefix is an implementation detail. */
const shown = (branch: string) => branch.replace(/^design\//, '');

/**
 * Lands the design branch on its base as ONE commit (a squash, so the base's
 * history gets your message, not every checkpoint). Works without touching a
 * checkout when the base isn't checked out; when it is, that checkout must be
 * clean and is fast-forwarded. The design branch then restarts from the result.
 */
export function shipToBase(worktree: string, message: string): string {
	const branch = currentBranch(worktree);
	if (!branch) throw new ShipError('not-on-branch', 'This design copy is not on a branch.');
	const base = baseOf(worktree, branch);
	if (!base || !isLocalBranch(worktree, base)) throw new ShipError('remote-base', `${base ?? 'The base'} only exists online: send it for review instead.`, { base: base ?? '' });
	saveVersion(worktree, message);
	const baseSha = git(worktree, ['rev-parse', base]);
	if (tryGit(worktree, ['diff', '--quiet', base, 'HEAD']) !== null) throw new ShipError('nothing', `Nothing to publish: ${shown(branch)} is the same as ${base}.`, { base });

	// Merge the base in the (clean, just saved) design copy: works with any git version, and a
	// conflict leaves nothing behind. The merge commit itself is dropped by the reset below.
	if (tryGit(worktree, ['merge-base', '--is-ancestor', base, 'HEAD']) === null) {
		try {
			git(worktree, ['merge', '--no-edit', '-q', base]);
		} catch {
			tryGit(worktree, ['merge', '--abort']);
			throw new ShipError('conflict', `${base} changed the same things as this design. Get the latest changes from ${base} first.`, { base });
		}
	}
	const tree = git(worktree, ['rev-parse', 'HEAD^{tree}']);
	const sha = git(worktree, ['commit-tree', tree, '-p', baseSha, '-m', message]);

	const baseWorktree = worktreeOf(worktree, base);
	if (baseWorktree) {
		if (isDirty(baseWorktree)) throw new ShipError('base-dirty', `${base} has unsaved code changes in the project folder (${baseWorktree}). Save or discard them there first.`, { base });
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
	if (!base) throw new ShipError('no-base', "This branch doesn't know which branch it started from.");
	saveVersion(worktree, 'Before getting the latest changes', true);
	try {
		git(worktree, ['merge', '--no-edit', '-q', base]);
	} catch {
		tryGit(worktree, ['merge', '--abort']);
		throw new ShipError('update-conflict', `${base} and this design changed the same things: they have to be combined in a code editor (git merge ${base}).`, { base });
	}
}

/** Pushes the design branch and opens a pull request into its base (gh), or returns the compare page. */
export function openPullRequest(worktree: string, title: string, body: string): { url: string; created: boolean } {
	const status = shipStatus(worktree);
	if (!status.remote) throw new ShipError('no-remote', 'This project is not connected to GitHub (no "origin" remote).');
	if (!status.base) throw new ShipError('no-base', "This branch doesn't know which branch it started from.");
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
	throw new ShipError('pushed', 'Uploaded. Open your Git host to request the review.');
}

export function renameDesignBranch(root: string, from: string, to: string): string {
	const name = to.startsWith('design/') ? to : `design/${to}`;
	if (!from.startsWith('design/')) throw new ShipError('not-design', 'Only branches made in Codesigner can be renamed or deleted here.');
	git(root, ['branch', '-m', from, name]);
	return name;
}

/** Removes a design branch and its folder. Refuses unshipped work unless `force`. */
export function deleteDesignBranch(root: string, name: string, force = false): void {
	if (!name.startsWith('design/')) throw new ShipError('not-design', 'Only branches made in Codesigner can be renamed or deleted here.');
	const dir = worktreeOf(root, name);
	if (dir && realpathSync(dir) === realpathSync(root)) throw new ShipError('project-folder', "The project folder can't be deleted.");
	if (!force && dir) {
		const status = shipStatus(dir);
		if (status.dirty || status.ahead > 0) throw new ShipError('unpublished', `${shown(name)} has unpublished changes.`, { name: shown(name) });
	}
	if (dir) git(root, ['worktree', 'remove', '--force', dir]);
	git(root, ['branch', '-D', name]);
}
