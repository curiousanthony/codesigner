/**
 * An error a designer may see. The message is plain English; the code and
 * params, appended as `[cs:code {…}]`, let the editor show it in the user's
 * language (IPC only carries the message across).
 */
export class ShipError extends Error {
	constructor(
		readonly code: string,
		text: string,
		readonly params: Record<string, string> = {}
	) {
		super(`${text} [cs:${code}${Object.keys(params).length ? ' ' + JSON.stringify(params) : ''}]`);
	}
}
