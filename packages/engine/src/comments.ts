import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Comment } from '@codesigner/protocol';
import { git } from './git.js';

/**
 * Design comments, one JSON file each in `.codesigner/comments/` of the working
 * copy: they travel with the design branch, show up in its pull request, and
 * agents can read them like any file.
 */
export const COMMENTS_DIR = '.codesigner/comments';

const fileFor = (root: string, id: string) => {
	if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad comment id: ${id}`);
	return join(root, COMMENTS_DIR, `${id}.json`);
};

export function listComments(root: string): Comment[] {
	const dir = join(root, COMMENTS_DIR);
	if (!existsSync(dir)) return [];
	const out: Comment[] = [];
	for (const entry of readdirSync(dir)) {
		if (!entry.endsWith('.json')) continue;
		try {
			out.push(JSON.parse(readFileSync(join(dir, entry), 'utf8')) as Comment);
		} catch {
			// a hand-edited or half-written file: skip it
		}
	}
	return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function newCommentId(): string {
	return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function saveComment(root: string, comment: Comment): Comment {
	mkdirSync(join(root, COMMENTS_DIR), { recursive: true });
	writeFileSync(fileFor(root, comment.id), JSON.stringify(comment, null, '\t') + '\n');
	return comment;
}

export function deleteComment(root: string, id: string) {
	rmSync(fileFor(root, id), { force: true });
}

/** git's user.name, the author shown on comments ("You" when unset). */
export function commentAuthor(root: string): string {
	try {
		return git(root, ['config', 'user.name']) || 'You';
	} catch {
		return 'You';
	}
}
