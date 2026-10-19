import { describe, expect, test } from 'vitest';
import { agentPrompt } from './comments';

describe('agent prompt', () => {
	test('says where and quotes the thread', () => {
		const text = agentPrompt([
			{
				id: 'a1',
				createdAt: '',
				path: '/',
				frame: 'phone',
				resolved: false,
				anchor: { file: 'src/routes/+page.svelte', line: 12, column: 2, tag: 'h1', occurrence: 0, text: 'Overview', name: 'Title', x: 0, y: 0 },
				messages: [{ author: 'Ann', at: '', body: 'Bigger on phone' }]
			}
		]);
		expect(text).toContain('src/routes/+page.svelte:12 — <h1> "Overview" on page / (phone)');
		expect(text).toContain('> Ann: Bigger on phone');
		expect(text).toContain('Comment ids: a1');
	});
});
