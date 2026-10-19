import { describe, expect, test } from 'vitest';
import { measure } from './measure';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('⌥ measurement', () => {
	test('inside a container: the four gaps (its padding)', () => {
		const lines = measure(r(20, 10, 60, 30), r(0, 0, 100, 50));
		expect(lines.map((l) => l.value)).toEqual([10, 20, 10, 20]);
	});

	test('side by side: the gap between facing edges, through the overlap', () => {
		const [line] = measure(r(0, 0, 40, 40), r(56, 20, 40, 40));
		expect(line).toEqual({ x1: 40, y1: 30, x2: 56, y2: 30, value: 16 });
	});

	test('diagonal: both gaps', () => {
		expect(measure(r(0, 0, 10, 10), r(30, 50, 10, 10)).map((l) => l.value)).toEqual([20, 40]);
	});

	test('touching layers measure nothing', () => {
		expect(measure(r(0, 0, 10, 10), r(10, 0, 10, 10))).toEqual([]);
	});
});
