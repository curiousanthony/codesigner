import { describe, expect, test } from 'vitest';
import { hsvToRgb, rgbToHsv, toHex } from './color';

describe('color math', () => {
	test('round-trips through HSV', () => {
		for (const rgb of [[0, 153, 255], [255, 0, 0], [12, 200, 34], [128, 128, 128]] as [number, number, number][]) {
			expect(hsvToRgb(rgbToHsv(...rgb))).toEqual(rgb);
		}
	});
	test('formats hex with alpha only when translucent', () => {
		expect(toHex([0, 153, 255])).toBe('#0099ff');
		expect(toHex([0, 153, 255], 0.5)).toBe('#0099ff80');
	});
});
