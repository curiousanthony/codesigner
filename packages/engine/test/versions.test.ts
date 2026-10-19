import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesignBranch, worktreesHome } from '../src/git';
import {
	deleteDesignBranch,
	githubUrl,
	listVersions,
	openPullRequest,
	renameDesignBranch,
	restoreVersion,
	saveVersion,
	shipStatus,
	shipToBase,
	updateFromBase
} from '../src/versions';

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'codesigner-versions-'));
const repo = join(tmp, 'repo');
const origin = join(tmp, 'origin.git');
afterAll(() => {
	rmSync(tmp, { recursive: true, force: true });
	rmSync(worktreesHome(repo), { recursive: true, force: true });
});

execFileSync('mkdir', ['-p', repo]);
run(repo, 'init', '-q', '-b', 'main');
run(repo, 'config', 'user.email', 'test@codesigner.test');
run(repo, 'config', 'user.name', 'Test');
writeFileSync(join(repo, 'page.svelte'), '<p>hi</p>\n');
writeFileSync(join(repo, 'other.svelte'), '<b>other</b>\n');
run(repo, 'add', '-A');
run(repo, 'commit', '-q', '-m', 'init');
// A local bare repository stands in for GitHub: nothing leaves the machine.
run(tmp, 'init', '-q', '--bare', origin);
run(repo, 'remote', 'add', 'origin', origin);

const design = createDesignBranch(repo, 'hero', 'main');
const wt = design.worktree;
const page = () => readFileSync(join(wt, 'page.svelte'), 'utf8');

describe('versions', () => {
	test('saves and lists versions since the base, marking automatic ones', () => {
		writeFileSync(join(wt, 'page.svelte'), '<p class="p-4">hi</p>\n');
		expect(saveVersion(wt, 'Change padding', true)).not.toBeNull();
		writeFileSync(join(wt, 'page.svelte'), '<p class="p-8">hi</p>\n');
		expect(saveVersion(wt, 'Bigger padding')).not.toBeNull();
		const versions = listVersions(wt);
		expect(versions.map((v) => [v.subject, v.auto])).toEqual([
			['Bigger padding', false],
			['Change padding', true]
		]);
		expect(saveVersion(wt, 'Nothing changed')).toBeNull();
	});

	test('restores a version as a new one, deleting files added since', () => {
		const first = listVersions(wt).at(-1)!.sha;
		writeFileSync(join(wt, 'added.svelte'), '<i>new</i>\n');
		restoreVersion(wt, first, 'Restore “Change padding”');
		expect(page()).toBe('<p class="p-4">hi</p>\n');
		expect(existsSync(join(wt, 'added.svelte'))).toBe(false);
		const subjects = listVersions(wt).map((v) => v.subject);
		expect(subjects[0]).toBe('Restore “Change padding”');
		expect(subjects[1]).toBe('Before restoring a version'); // the unsaved file is kept in history
	});
});

describe('ship', () => {
	test('reports status against the base', () => {
		const status = shipStatus(wt);
		expect(status.branch).toBe('design/hero');
		expect(status.base).toBe('main');
		expect(status.baseIsLocal).toBe(true);
		expect(status.ahead).toBeGreaterThan(0);
		expect(status.behind).toBe(0);
		expect(realpathSync(status.baseWorktree!)).toBe(realpathSync(repo));
		expect(githubUrl('git@github.com:acme/app.git')).toBe('https://github.com/acme/app');
		expect(githubUrl('https://github.com/acme/app')).toBe('https://github.com/acme/app');
	});

	test('updates from the base when it moved on', () => {
		writeFileSync(join(repo, 'other.svelte'), '<b class="font-bold">other</b>\n');
		run(repo, 'commit', '-qam', 'Base moved');
		expect(shipStatus(wt).behind).toBe(1);
		updateFromBase(wt);
		expect(shipStatus(wt).behind).toBe(0);
		expect(readFileSync(join(wt, 'other.svelte'), 'utf8')).toContain('font-bold');
	});

	test('refuses to ship into a checked-out base with uncommitted changes', () => {
		writeFileSync(join(repo, 'scratch.txt'), 'wip\n');
		expect(() => shipToBase(wt, 'Hero padding')).toThrow(/uncommitted/);
		rmSync(join(repo, 'scratch.txt'));
	});

	test('ships as one commit on the base and restarts the design branch from it', () => {
		const before = Number(run(repo, 'rev-list', '--count', 'main'));
		writeFileSync(join(wt, 'page.svelte'), '<p class="p-6">hi</p>\n');
		const sha = shipToBase(wt, 'Hero padding');
		expect(run(repo, 'rev-parse', 'main')).toBe(sha);
		expect(Number(run(repo, 'rev-list', '--count', 'main'))).toBe(before + 1);
		expect(run(repo, 'log', '-1', '--format=%s', 'main')).toBe('Hero padding');
		// The main checkout had `main` checked out and clean: it was fast-forwarded.
		expect(readFileSync(join(repo, 'page.svelte'), 'utf8')).toBe('<p class="p-6">hi</p>\n');
		expect(shipStatus(wt).ahead).toBe(0);
		expect(listVersions(wt)).toEqual([]);
		expect(() => shipToBase(wt, 'Again')).toThrow(/Nothing to ship/);
	});

	test('ships into a base that is not checked out by moving the branch ref', () => {
		run(repo, 'branch', 'release', 'main');
		const other = createDesignBranch(repo, 'promo', 'release');
		writeFileSync(join(other.worktree, 'page.svelte'), '<p class="text-lg">promo</p>\n');
		const sha = shipToBase(other.worktree, 'Promo copy');
		expect(run(repo, 'rev-parse', 'release')).toBe(sha);
		expect(run(repo, 'show', 'release:page.svelte')).toBe('<p class="text-lg">promo</p>');
		expect(readFileSync(join(repo, 'page.svelte'), 'utf8')).not.toContain('promo'); // main untouched
	});

	test('pushes the branch for a pull request (compare page without gh on a non-GitHub remote)', () => {
		writeFileSync(join(wt, 'page.svelte'), '<p class="p-2">hi</p>\n');
		expect(() => openPullRequest(wt, 'Tighter hero', '')).toThrow(/Pushed/);
		expect(run(origin, 'rev-parse', 'design/hero')).toBe(run(wt, 'rev-parse', 'HEAD'));
	});
});

describe('branches', () => {
	test('renames and deletes design branches, protecting unshipped work', () => {
		const renamed = renameDesignBranch(repo, 'design/hero', 'hero-v2');
		expect(renamed).toBe('design/hero-v2');
		expect(run(repo, 'config', 'branch.design/hero-v2.codesigner-base')).toBe('main');
		expect(run(wt, 'symbolic-ref', '--short', 'HEAD')).toBe('design/hero-v2');
		expect(() => deleteDesignBranch(repo, 'design/hero-v2')).toThrow(/unshipped/);
		deleteDesignBranch(repo, 'design/hero-v2', true);
		expect(existsSync(wt)).toBe(false);
		expect(() => run(repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/design/hero-v2')).toThrow();
		expect(() => deleteDesignBranch(repo, 'main')).toThrow(/design branches/);
	});
});
