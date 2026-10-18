import { describe, expect, test } from 'vitest';
import { activePrefix, familyTokens, parseToken, setFamily, sizeMode, spacing } from './tailwind-map';

describe('tailwind map', () => {
	test('parses variant prefixes', () => {
		expect(parseToken('md:hover:bg-primary/90')).toEqual({ variants: ['md', 'hover'], utility: 'bg-primary/90', prefix: 'md:hover:' });
		expect(parseToken('[&_svg]:size-4').utility).toBe('size-4');
	});

	test('picks the responsive variant in effect at a frame width', () => {
		const cls = 'flex gap-2 md:gap-4 xl:gap-8';
		expect(activePrefix(cls, 'gap', 390)).toBe('');
		expect(activePrefix(cls, 'gap', 810)).toBe('md:');
		expect(activePrefix(cls, 'gap', 1440)).toBe('xl:');
		expect(activePrefix(cls, 'padding', 1440)).toBe('');
	});

	test('families do not overlap', () => {
		const cls = 'text-sm text-muted-foreground text-center bg-primary bg-clip-text border border-border rounded-lg';
		expect(familyTokens(cls, 'fontSize')).toEqual(['text-sm']);
		expect(familyTokens(cls, 'textColor')).toEqual(['text-muted-foreground']);
		expect(familyTokens(cls, 'textAlign')).toEqual(['text-center']);
		expect(familyTokens(cls, 'background')).toEqual(['bg-primary']);
		expect(familyTokens(cls, 'borderWidth')).toEqual(['border']);
		expect(familyTokens(cls, 'borderColor')).toEqual(['border-border']);
	});

	test('replaces a family under a prefix', () => {
		expect(setFamily('flex gap-2 md:gap-4', 'gap', ['gap-6'], 'md:')).toEqual({ remove: ['md:gap-4'], add: ['md:gap-6'] });
		expect(setFamily('w-64 shrink-0', 'width', ['flex-1'], '')).toEqual({ remove: ['w-64'], add: ['flex-1'] });
	});

	test('reads sizing modes', () => {
		expect(sizeMode('w-64', 'width', 'flex', 'row', 1280)).toBe('fixed');
		expect(sizeMode('flex-1', 'width', 'flex', 'row', 1280)).toBe('fill');
		expect(sizeMode('w-full', 'width', 'block', 'row', 1280)).toBe('fill');
		expect(sizeMode('w-fit', 'width', 'block', 'row', 1280)).toBe('fit');
		expect(sizeMode('w-1/2', 'width', 'block', 'row', 1280)).toBe('relative');
		expect(sizeMode('min-h-screen h-svh', 'height', 'block', 'row', 1280)).toBe('viewport');
		expect(sizeMode('', 'width', 'block', 'row', 1280)).toBe('auto');
	});

	test('spacing uses scale steps when possible', () => {
		expect(spacing('gap', 12)).toBe('gap-3');
		expect(spacing('gap', 2)).toBe('gap-0.5');
		expect(spacing('gap', 13)).toBe('gap-[13px]');
	});
});
