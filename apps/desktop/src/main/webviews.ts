import { session, type WebContents } from 'electron';
import { PREVIEW_PARTITION, preloadPath } from './env.js';

const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/]+\.localhost)(:\d+)?(\/|$)/;

/**
 * Canvas frames are <webview> tags. Their config is forced here so the
 * renderer can never attach a guest with node access or a foreign preload,
 * and every frame shares one persistent session (one login for all frames).
 */
export function hardenWebviews(host: WebContents) {
	host.on('will-attach-webview', (event, prefs, params) => {
		delete (prefs as { preloadURL?: string }).preloadURL;
		prefs.preload = preloadPath('guest');
		prefs.nodeIntegration = false;
		prefs.contextIsolation = true;
		prefs.sandbox = true;
		prefs.webSecurity = true;
		if (params.partition !== PREVIEW_PARTITION) {
			event.preventDefault();
			return;
		}
		if (params.src && params.src !== 'about:blank' && !LOCAL_URL.test(params.src)) {
			event.preventDefault();
		}
	});

	host.on('did-attach-webview', (_event, guest) => {
		guest.setWindowOpenHandler(() => {
			// OAuth and "open in new tab" flows: keep them in the preview session so
			// auth cookies land in the shared jar.
			return {
				action: 'allow',
				overrideBrowserWindowOptions: {
					width: 520,
					height: 720,
					webPreferences: {
						partition: PREVIEW_PARTITION,
						contextIsolation: true,
						sandbox: true,
						nodeIntegration: false
					}
				},
				outlivesOpener: false
			} as const;
		});
	});
}

export function configurePreviewSession() {
	const preview = session.fromPartition(PREVIEW_PARTITION);
	// A plain Chrome user agent avoids "unsupported browser" walls and some OAuth blocks.
	preview.setUserAgent(preview.getUserAgent().replace(/\s(Electron|codesigner|Codesigner)\/\S+/g, ''));
	preview.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
	});
	return preview;
}

export function previewSession() {
	return session.fromPartition(PREVIEW_PARTITION);
}
