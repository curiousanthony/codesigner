import { beforeAll, describe, expect, test } from 'bun:test';
import { TailwindEngine, splitVariants } from '../src/tailwind';
import { fixture } from './helpers';

const tw = new TailwindEngine(fixture('kit2-app'), 'src/app.css');
beforeAll(async () => {
	expect(await tw.load()).not.toBeNull();
});

describe('tailwind engine', () => {
	test('splits variants outside brackets', () => {
		expect(splitVariants('md:hover:bg-primary/90')).toEqual({ variants: 'md:hover:', utility: 'bg-primary/90' });
		expect(splitVariants('[&_svg]:size-4')).toEqual({ variants: '[&_svg]:', utility: 'size-4' });
		expect(splitVariants('bg-[url(a:b)]')).toEqual({ variants: '', utility: 'bg-[url(a:b)]' });
	});

	test('conflicts follow CSS properties and shorthands', () => {
		expect(tw.conflicts(['px-2', 'py-1', 'mt-2'], ['p-4'])).toEqual(['px-2', 'py-1']);
		expect(tw.conflicts(['p-4'], ['px-2'])).toEqual([]);
		expect(tw.conflicts(['gap-1', 'md:gap-2'], ['gap-3'])).toEqual(['gap-1']);
		expect(tw.conflicts(['text-sm', 'leading-6', 'text-muted-foreground'], ['text-lg'])).toEqual(['text-sm']);
		expect(tw.conflicts(['bg-primary', 'text-white'], ['bg-muted'])).toEqual(['bg-primary']);
		expect(tw.conflicts(['flex', 'flex-col'], ['grid'])).toEqual(['flex']);
		expect(tw.conflicts(['flex-col'], ['flex-row'])).toEqual(['flex-col']);
		expect(tw.conflicts(['rounded-tl-md', 'rounded-lg'], ['rounded-xl'])).toEqual(['rounded-tl-md', 'rounded-lg']);
	});

	test('canonicalizes to the theme scale but avoids odd fractions', () => {
		expect(tw.canonicalize('gap-[12px]')).toBe('gap-3');
		expect(tw.canonicalize('p-[2px]')).toBe('p-0.5');
		expect(tw.canonicalize('w-[237px]')).toBe('w-[237px]');
	});

	test('validates and renders preview CSS', () => {
		expect(tw.isValid('bg-brand-500')).toBe(true);
		expect(tw.isValid('bg-nonexistent-token')).toBe(false);
		expect(tw.css(['gap-13'])).toContain('gap: calc(var(--spacing) * 13)');
	});
});
