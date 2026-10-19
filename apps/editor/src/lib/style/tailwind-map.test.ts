import { describe, expect, test } from 'vitest';
import { activePrefix, coveredPaddingUtilities, familyTokens, paddingSides, paddingUtilities, parseToken, responsiveSet, screenBetween, setFamily, sizeMode, spacing } from './tailwind-map';

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

	test('picks a screen between two frames', () => {
		expect(screenBetween(390, 810)).toBe('md');
		expect(screenBetween(810, 1280)).toBe('lg');
		expect(screenBetween(1280, 1300)).toBe(null);
	});

	describe('Framer breakpoint semantics', () => {
		const frames = [1280, 810, 390];
		test('editing the primary frame changes every frame that inherits', () => {
			expect(responsiveSet('flex gap-2', 'gap', ['gap-4'], 1280, frames)).toEqual({ remove: ['gap-2'], add: ['gap-4'] });
		});
		test('editing Phone pins the larger frames to their value', () => {
			expect(responsiveSet('flex gap-2', 'gap', ['gap-4'], 390, frames)).toEqual({ remove: ['gap-2'], add: ['gap-4', 'md:gap-2'] });
		});
		test('editing Tablet changes Tablet and Phone but not Desktop', () => {
			expect(responsiveSet('flex gap-2', 'gap', ['gap-4'], 810, frames)).toEqual({ remove: ['gap-2'], add: ['gap-4', 'lg:gap-2'] });
		});
		test('an existing override for the frame is edited in place', () => {
			expect(responsiveSet('gap-2 md:gap-4 lg:gap-8', 'gap', ['gap-6'], 810, frames)).toEqual({ remove: ['md:gap-4'], add: ['md:gap-6'] });
			expect(responsiveSet('gap-2 md:gap-4', 'gap', ['gap-6'], 390, frames)).toEqual({ remove: ['gap-2'], add: ['gap-6'] });
		});
		test('hiding on Phone keeps larger frames showing', () => {
			expect(responsiveSet('flex gap-2', 'display', ['hidden'], 390, frames)).toEqual({ remove: ['flex'], add: ['hidden', 'md:flex'] });
			expect(responsiveSet('p-4', 'display', ['hidden'], 390, frames, undefined, ['block'])).toEqual({ remove: [], add: ['hidden', 'md:block'] });
		});
		test('a value with no class to restore applies to larger frames too', () => {
			expect(responsiveSet('flex', 'gap', ['gap-4'], 390, frames)).toEqual({ remove: [], add: ['gap-4'] });
		});
	});
});

describe('paddingUtilities', () => {
	test('collapses sides like hand-written classes', () => {
		expect(paddingUtilities({ top: 32, right: 32, bottom: 32, left: 32 })).toEqual(['p-8']);
		expect(paddingUtilities({ top: 56, right: 32, bottom: 32, left: 32 })).toEqual(['px-8', 'pt-14', 'pb-8']);
		expect(paddingUtilities({ top: 8, right: 16, bottom: 8, left: 16 })).toEqual(['px-4', 'py-2']);
		expect(paddingUtilities({ top: 8, right: 4, bottom: 8, left: 16 })).toEqual(['py-2', 'pl-4', 'pr-1']);
		expect(paddingUtilities({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual(['pt-[1px]', 'pb-[3px]', 'pl-1', 'pr-0.5']);
	});
});

describe('coveredPaddingUtilities', () => {
	const values = { top: 28, right: 24, bottom: 96, left: 44 };
	test('only the sides already set at that breakpoint, plus the edited one', () => {
		const covered = paddingSides(['sm:px-6']);
		covered.add('left');
		expect(coveredPaddingUtilities(values, covered)).toEqual(['pl-11', 'pr-6']);
	});
	test('a single new side', () => {
		expect(coveredPaddingUtilities(values, new Set(['top']))).toEqual(['pt-7']);
	});
	test('pairs collapse when equal', () => {
		expect(coveredPaddingUtilities({ ...values, left: 24 }, paddingSides(['px-6']))).toEqual(['px-6']);
	});
});
