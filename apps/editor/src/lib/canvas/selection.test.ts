import { describe, expect, test } from 'vitest';
import { pickLayer } from './selection';

// layout > aside > nav > item ; layout > main > card
const hitItem = ['layout', 'aside', 'nav', 'item'];
const hitCard = ['layout', 'main', 'card'];

describe('pickLayer', () => {
	test('first click selects the top-level layer', () => {
		expect(pickLayer(hitItem, null, 'click')).toBe('layout');
	});

	test('double-click drills one level below the selection', () => {
		expect(pickLayer(hitItem, ['layout'], 'double')).toBe('aside');
		expect(pickLayer(hitItem, ['layout', 'aside'], 'double')).toBe('nav');
	});

	test('clicks stay at the current level', () => {
		// "nav" is selected; clicking another child of "aside" (here nav again) keeps the level.
		expect(pickLayer(hitItem, ['layout', 'aside', 'nav'], 'click')).toBe('nav');
	});

	test('clicking elsewhere climbs to the shared ancestor', () => {
		expect(pickLayer(hitCard, ['layout', 'aside', 'nav'], 'click')).toBe('main');
	});

	test('deep select picks the innermost layer', () => {
		expect(pickLayer(hitItem, null, 'deep')).toBe('item');
	});
});
