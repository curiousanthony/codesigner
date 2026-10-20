import type { Rect } from '@codesigner/protocol';

/** A smart guide line: vertical (`axis` x, at x = `at`) or horizontal, spanning `from`–`to` on the other axis. */
export interface Guide {
	axis: 'x' | 'y';
	at: number;
	from: number;
	to: number;
}

const lines = (start: number, size: number) => [start, start + size / 2, start + size];

/**
 * Framer's smart guides: moves `rect` by (dx, dy), snapping its edges or
 * center to the edges or centers of `targets` when within `threshold`, and
 * returns the adjusted move with the guides to draw.
 */
export function snapMove(rect: Rect, dx: number, dy: number, targets: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
	const axis = (start: number, size: number, pick: (t: Rect) => [number, number]) => {
		let best: number | null = null;
		for (const t of targets) {
			const [tStart, tSize] = pick(t);
			for (const target of lines(tStart, tSize)) {
				for (const line of lines(start, size)) {
					const diff = target - line;
					if (Math.abs(diff) <= threshold && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
				}
			}
		}
		return best ?? 0;
	};
	const sx = axis(rect.x + dx, rect.width, (t) => [t.x, t.width]);
	const sy = axis(rect.y + dy, rect.height, (t) => [t.y, t.height]);
	const moved = { x: rect.x + dx + sx, y: rect.y + dy + sy, width: rect.width, height: rect.height };
	// Every line the moved rect now shares with a target gets a guide, spanning both.
	const guides: Guide[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
	for (const t of targets) {
		for (const at of lines(t.x, t.width)) {
			if (lines(moved.x, moved.width).some((l) => near(l, at))) guides.push({ axis: 'x', at, from: Math.min(moved.y, t.y), to: Math.max(moved.y + moved.height, t.y + t.height) });
		}
		for (const at of lines(t.y, t.height)) {
			if (lines(moved.y, moved.height).some((l) => near(l, at))) guides.push({ axis: 'y', at, from: Math.min(moved.x, t.x), to: Math.max(moved.x + moved.width, t.x + t.width) });
		}
	}
	return { dx: dx + sx, dy: dy + sy, guides };
}
