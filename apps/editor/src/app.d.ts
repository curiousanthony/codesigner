import type { CodesignerApi } from '@codesigner/protocol';

declare global {
	namespace App {}
	interface Window {
		codesigner?: CodesignerApi;
	}
}

export {};
