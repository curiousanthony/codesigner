import { describe, expect, test } from 'vitest';
import { hslToRgb, hsvToRgb, rgbToHsl, rgbToHsv, toHex } from './color';

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

describe('HSL', () => {
	test('converts both ways', () => {
		expect(rgbToHsl(0, 153, 255)).toEqual([204, 100, 50]);
		expect(hslToRgb(204, 100, 50)).toEqual([0, 153, 255]);
		expect(rgbToHsl(128, 128, 128)).toEqual([0, 0, 50]);
	});
});
