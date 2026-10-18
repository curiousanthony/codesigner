import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpoint, createDesignBranch, listBranches, slugifyBranch } from '../src/git';

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const repo = mkdtempSync(join(tmpdir(), 'codesigner-git-'));
const cleanup: string[] = [repo];
afterAll(() => cleanup.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

run(repo, 'init', '-q', '-b', 'main');
run(repo, 'config', 'user.email', 'test@codesigner.test');
run(repo, 'config', 'user.name', 'Test');
writeFileSync(join(repo, 'page.svelte'), '<p>hi</p>\n');
writeFileSync(join(repo, '.env.example'), 'KEY=\n');
run(repo, 'add', '-A');
run(repo, 'commit', '-q', '-m', 'init');
// A secret the repo forgot to ignore.
writeFileSync(join(repo, '.env'), 'SECRET=hunter2\n');

describe('design branches', () => {
	test('slugifies names', () => {
		expect(slugifyBranch('Sidebar Rework!')).toBe('sidebar-rework');
		expect(slugifyBranch('Évolution du tableau')).toBe('evolution-du-tableau');
	});

	test('creates a worktree, copies untracked env files, never commits them', () => {
		const branch = createDesignBranch(repo, 'Sidebar rework', 'main');
		cleanup.push(branch.worktree);
		expect(branch.name).toBe('design/sidebar-rework');
		expect(existsSync(join(branch.worktree, '.env'))).toBe(true);
		expect(listBranches(repo).some((b) => b.name === 'design/sidebar-rework' && b.baseBranch === 'main')).toBe(true);

		writeFileSync(join(branch.worktree, 'page.svelte'), '<p class="p-4">hi</p>\n');
		const sha = checkpoint(branch.worktree, 'Design checkpoint');
		expect(sha).not.toBeNull();
		const files = run(branch.worktree, 'show', '--name-only', '--format=', 'HEAD').split('\n');
		expect(files).toEqual(['page.svelte']);
		// Only the env file left: nothing to checkpoint.
		expect(checkpoint(branch.worktree, 'again')).toBeNull();
	});
});
