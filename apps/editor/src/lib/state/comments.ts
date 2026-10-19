import type { Comment } from '@codesigner/protocol';

/** A comment as instructions an agent can act on: where, what, and the thread. */
export function agentPrompt(comments: Comment[]): string {
	const one = (c: Comment) => {
		const where = `${c.anchor.file}:${c.anchor.line} — <${c.anchor.tag}>${c.anchor.text ? ` "${c.anchor.text.slice(0, 60)}"` : ''} on page ${c.path} (${c.frame})`;
		const thread = c.messages.map((msg) => `> ${msg.author}: ${msg.body.replace(/\n/g, '\n> ')}`).join('\n');
		return `${where}\n${thread}`;
	};
	const head =
		comments.length === 1
			? 'Apply this design comment to the code:'
			: `Apply these ${comments.length} design comments to the code (one per element):`;
	return `${head}\n\n${comments.map(one).join('\n\n')}\n\nWhen done, mark them resolved in .codesigner/comments/<id>.json ("resolved": true).\nComment ids: ${comments.map((c) => c.id).join(', ')}`;
}
