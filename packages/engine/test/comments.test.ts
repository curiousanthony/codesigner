import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteComment, listComments, newCommentId, saveComment } from '../src/comments';

const root = mkdtempSync(join(tmpdir(), 'codesigner-comments-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('comments', () => {
	test('saves, lists in order and deletes', () => {
		const anchor = { file: 'src/routes/+page.svelte', line: 3, column: 1, tag: 'h1', occurrence: 0, text: 'Hi', name: 'Title', x: 0.5, y: 0.5 };
		const a = saveComment(root, { id: newCommentId(), createdAt: '2026-10-19T10:00:00Z', path: '/', frame: 'desktop', anchor, messages: [{ author: 'Ann', at: '2026-10-19T10:00:00Z', body: 'Bigger' }], resolved: false });
		saveComment(root, { ...a, id: newCommentId(), createdAt: '2026-10-19T09:00:00Z' });
		expect(listComments(root).map((c) => c.createdAt)).toEqual(['2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z']);
		deleteComment(root, a.id);
		expect(listComments(root)).toHaveLength(1);
		expect(() => deleteComment(root, '../../etc')).toThrow();
	});
});
