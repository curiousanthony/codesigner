import { describe, expect, test } from 'vitest';
import { evaluate } from './math';

describe('evaluate', () => {
	test('handles arithmetic with precedence', () => {
		expect(evaluate('100/2')).toBe(50);
		expect(evaluate('24*1.5+8')).toBe(44);
		expect(evaluate('(2+3)*4')).toBe(20);
		expect(evaluate('-4')).toBe(-4);
		expect(evaluate('16px')).toBe(16);
	});
	test('rejects invalid input', () => {
		expect(evaluate('abc')).toBeNull();
		expect(evaluate('1/0')).toBeNull();
		expect(evaluate('2+')).toBeNull();
	});
});
