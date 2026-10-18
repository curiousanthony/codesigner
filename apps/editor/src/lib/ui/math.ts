/** Evaluates a small arithmetic expression ("100/2", "24*1.5+8"). Returns null when invalid. */
export function evaluate(input: string): number | null {
	const src = input.replace(/px$/i, '').replace(/\s+/g, '');
	if (!src) return null;
	let i = 0;
	const peek = () => src[i];
	const number = (): number | null => {
		if (peek() === '(') {
			i++;
			const v = expr();
			if (peek() !== ')') return null;
			i++;
			return v;
		}
		if (peek() === '-') {
			i++;
			const v = number();
			return v === null ? null : -v;
		}
		const m = src.slice(i).match(/^\d*\.?\d+/);
		if (!m) return null;
		i += m[0].length;
		return parseFloat(m[0]);
	};
	const term = (): number | null => {
		let left = number();
		while (left !== null && (peek() === '*' || peek() === '/')) {
			const op = src[i++];
			const right = number();
			if (right === null) return null;
			left = op === '*' ? left * right : right === 0 ? null : left / right;
		}
		return left;
	};
	const expr = (): number | null => {
		let left = term();
		while (left !== null && (peek() === '+' || peek() === '-')) {
			const op = src[i++];
			const right = term();
			if (right === null) return null;
			left = op === '+' ? left + right : left - right;
		}
		return left;
	};
	const value = expr();
	return value === null || i !== src.length || !Number.isFinite(value) ? null : value;
}

export const round = (value: number, precision = 2) => Math.round(value * 10 ** precision) / 10 ** precision;
