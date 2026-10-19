import type { Rect } from '@codesigner/protocol';

/** A distance line between two layers (guest px), with its label value. */
export interface Measure {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	value: number;
}

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);

/**
 * Framer's ⌥ measurement from the selection `a` to the hovered layer `b`:
 * the four gaps when one contains the other, else the horizontal and vertical
 * gaps between their facing edges.
 */
export function measure(a: Rect, b: Rect): Measure[] {
	const out: Measure[] = [];
	const push = (x1: number, y1: number, x2: number, y2: number) => {
		const value = Math.round(Math.abs(x2 - x1) + Math.abs(y2 - y1));
		if (value > 0) out.push({ x1, y1, x2, y2, value });
	};
	if (contains(b, a) || contains(a, b)) {
		const [inner, outer] = contains(b, a) ? [a, b] : [b, a];
		const cx = inner.x + inner.width / 2;
		const cy = inner.y + inner.height / 2;
		push(cx, outer.y, cx, inner.y);
		push(right(inner), cy, right(outer), cy);
		push(cx, bottom(inner), cx, bottom(outer));
		push(outer.x, cy, inner.x, cy);
		return out;
	}
	// Facing edges; the line runs through the middle of the overlap, or the selection's center.
	const overlapY = Math.max(a.y, b.y) < Math.min(bottom(a), bottom(b));
	const overlapX = Math.max(a.x, b.x) < Math.min(right(a), right(b));
	const y = overlapY ? (Math.max(a.y, b.y) + Math.min(bottom(a), bottom(b))) / 2 : a.y + a.height / 2;
	const x = overlapX ? (Math.max(a.x, b.x) + Math.min(right(a), right(b))) / 2 : a.x + a.width / 2;
	if (right(a) <= b.x) push(right(a), y, b.x, y);
	else if (right(b) <= a.x) push(right(b), y, a.x, y);
	if (bottom(a) <= b.y) push(x, bottom(a), x, b.y);
	else if (bottom(b) <= a.y) push(x, bottom(b), x, a.y);
	return out;
}
