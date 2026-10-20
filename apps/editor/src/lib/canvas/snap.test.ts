import { describe, expect, test } from 'vitest';
import { snapMove } from './snap';

const box = { x: 100, y: 100, width: 50, height: 20 };

describe('snapMove', () => {
	test('snaps the nearest edge within the threshold and draws its guide', () => {
		const target = { x: 0, y: 200, width: 203, height: 40 };
		const r = snapMove(box, 50, 0, [target], 5);
		// right edge 200 → target right 203
		expect(r.dx).toBe(53);
		expect(r.dy).toBe(0);
		expect(r.guides).toContainEqual({ axis: 'x', at: 203, from: 100, to: 240 });
	});

	test('centers snap to centers', () => {
		const parent = { x: 0, y: 0, width: 400, height: 300 };
		const r = snapMove(box, 73, 38, [parent], 4);
		expect(r.dx).toBe(75); // center 175 + 75 - 2 → 200
		expect(r.dy).toBe(40); // center 110 + 40 → 150
		expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
	});

	test('no snap beyond the threshold', () => {
		const r = snapMove(box, 10, 10, [{ x: 0, y: 0, width: 400, height: 300 }], 4);
		expect(r).toEqual({ dx: 10, dy: 10, guides: [] });
	});
});
