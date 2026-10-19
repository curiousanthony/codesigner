import { describe, expect, test } from 'vitest';
import { pickLayer } from './selection';

// layout > aside > nav > item ; layout > main > card
const hitItem = ['layout', 'aside', 'nav', 'item'];
const hitCard = ['layout', 'main', 'card'];

describe('pickLayer', () => {
	test('a click selects the innermost layer under the pointer, like Framer', () => {
		expect(pickLayer(hitItem, null, 'click')).toBe('item');
		expect(pickLayer(hitCard, ['layout', 'aside', 'nav'], 'click')).toBe('card');
	});

	test('⌘-click picks the outermost layer at the current level', () => {
		expect(pickLayer(hitItem, null, 'container')).toBe('layout');
		expect(pickLayer(hitItem, ['layout', 'aside', 'nav'], 'container')).toBe('nav');
		expect(pickLayer(hitCard, ['layout', 'aside', 'nav'], 'container')).toBe('main');
	});

	test('nothing under the pointer selects nothing', () => {
		expect(pickLayer([], null, 'click')).toBeNull();
	});
});
