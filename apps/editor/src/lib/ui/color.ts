let ctx: CanvasRenderingContext2D | null = null;

/** Converts any CSS color (oklch, color-mix, named…) to sRGB components via a 1px canvas. */
export function toRgba(color: string): [number, number, number, number] | null {
	if (typeof document === 'undefined') return null;
	ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	ctx.clearRect(0, 0, 1, 1);
	ctx.fillStyle = '#000';
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return [r, g, b, a / 255];
}

/** "#RRGGBB" plus " 50%" when translucent; "transparent" when fully transparent. */
export function toHexLabel(color: string): string {
	const rgba = toRgba(color);
	if (!rgba) return color;
	const [r, g, b, a] = rgba;
	if (a === 0) return 'transparent';
	const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
	return a < 1 ? `${hex} ${Math.round(a * 100)}%` : hex;
}

export type Hsva = { h: number; s: number; v: number; a: number };

/** sRGB (0–255) → HSV (h 0–360, s/v 0–1). */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	const [rn, gn, bn] = [r / 255, g / 255, b / 255];
	const max = Math.max(rn, gn, bn);
	const d = max - Math.min(rn, gn, bn);
	let h = 0;
	if (d) h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
	return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: { h: number; s: number; v: number }): [number, number, number] {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
	};
	return [f(5), f(3), f(1)];
}

/** "#rrggbb", or "#rrggbbaa" when translucent. */
export function toHex([r, g, b]: [number, number, number], a = 1): string {
	const hex = (n: number) => n.toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(Math.round(a * 255)) : ''}`;
}

export function parseHsva(color: string): Hsva {
	const rgba = toRgba(color) ?? [0, 0, 0, 1];
	return { ...rgbToHsv(rgba[0], rgba[1], rgba[2]), a: rgba[3] };
}

/** RGB (0–255) → HSL (h 0–360, s and l 0–100). */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const [R, G, B] = [r / 255, g / 255, b / 255];
	const max = Math.max(R, G, B);
	const min = Math.min(R, G, B);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return [0, 0, Math.round(l * 100)];
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
	return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

/** HSL (h 0–360, s and l 0–100) → RGB (0–255). */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const S = s / 100;
	const L = l / 100;
	const c = (1 - Math.abs(2 * L - 1)) * S;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = L - c / 2;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

