import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const workspacePackages = ['@codesigner/protocol', '@codesigner/engine'];

export default defineConfig({
	main: {
		build: {
			externalizeDeps: { exclude: workspacePackages },
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/main/index.ts') }
			}
		}
	},
	preload: {
		build: {
			// Sandboxed preloads must be self-contained CommonJS bundles.
			externalizeDeps: false,
			isolatedEntries: true,
			rollupOptions: {
				input: {
					index: resolve(__dirname, 'src/preload/index.ts'),
					guest: resolve(__dirname, 'src/preload/guest.ts')
				},
				output: { format: 'cjs', entryFileNames: '[name].cjs' }
			}
		}
	}
});
