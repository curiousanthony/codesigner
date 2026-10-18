import { net, protocol } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { editorBuildDir } from './env.js';

/** Must run before app `ready`. */
export function registerAppScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: 'app',
			privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
		}
	]);
}

/** Serves the built editor SPA from app://editor/ with an index.html fallback for client routes. */
export function handleAppScheme() {
	const root = editorBuildDir();
	protocol.handle('app', async (request) => {
		const { pathname } = new URL(request.url);
		const file = normalize(join(root, decodeURIComponent(pathname)));
		if (file !== root && !file.startsWith(root + sep)) {
			return new Response('Forbidden', { status: 403 });
		}
		const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
		if (response?.ok) return response;
		return net.fetch(pathToFileURL(join(root, 'index.html')).toString());
	});
}
