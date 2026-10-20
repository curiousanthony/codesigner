import { describe, expect, test } from 'bun:test';
import { addColorToken, parseTokens } from '../src/tokens';

const css = `@import 'tailwindcss';

:root {
	--primary: oklch(0.2 0 0);
}

.dark {
	--primary: oklch(0.9 0 0);
}

@theme inline {
	--color-primary: var(--primary);
}
`;

describe('addColorToken', () => {
	test('adds light and dark values and the @theme alias, so bg-<name> exists', () => {
		const out = addColorToken(css, { name: 'brand', light: '#0099ff', dark: '#33aaff' });
		expect(out).toContain('\t--primary: oklch(0.2 0 0);\n\t--brand: #0099ff;\n}');
		expect(out).toContain('\t--primary: oklch(0.9 0 0);\n\t--brand: #33aaff;\n}');
		expect(out).toContain('\t--color-primary: var(--primary);\n\t--color-brand: var(--brand);\n}');
		const brand = parseTokens(out, 'app.css').tokens.find((t) => t.name === '--color-brand');
		expect(brand?.utility).toBe('bg-brand');
	});

	test('refuses names that exist and invalid names', () => {
		expect(() => addColorToken(css, { name: 'primary', light: 'red' })).toThrow(/already exists/);
		expect(() => addColorToken(css, { name: 'Brand Color', light: 'red' })).toThrow(/lowercase/);
	});

	test('creates the blocks a bare stylesheet lacks', () => {
		const out = addColorToken("@import 'tailwindcss';\n", { name: 'brand', light: 'red' });
		expect(parseTokens(out, 'app.css').tokens.find((t) => t.name === '--color-brand')?.utility).toBe('bg-brand');
	});
});
