import { describe, expect, test } from 'vitest';
import { errorCode, errorMessage } from './api';

const remote = (message: string) => new Error(`Error invoking remote method 'branch:ship': Error: ${message}`);

describe('engine errors', () => {
	test('a coded error is shown in plain words with its params', () => {
		const error = remote('Nothing to publish: hero is the same as main. [cs:nothing {"base":"main"}]');
		expect(errorCode(error)).toBe('nothing');
		expect(errorMessage(error)).toBe('Nothing to publish: this branch is the same as main.');
	});

	test('an unknown code keeps the English text, without the tag', () => {
		expect(errorMessage(remote('Something new. [cs:brand-new]'))).toBe('Something new.');
	});

	test('other errors only lose the IPC prefix', () => {
		expect(errorMessage(remote('fatal: not a git repository'))).toBe('fatal: not a git repository');
		expect(errorCode(remote('fatal: not a git repository'))).toBeNull();
	});
});
