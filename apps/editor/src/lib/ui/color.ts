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
