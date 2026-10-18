import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

// Minimal cookie auth so the fixture behaves like a real auth-gated SaaS.
// Credentials live in src/lib/server/demo-user.ts (test-only values).
const PUBLIC_PATHS = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	const session = event.cookies.get('playground_session');
	event.locals.user = session ? { name: decodeURIComponent(session) } : null;

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!event.locals.user && !isPublic) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(event.url.pathname)}`);
	}
	return resolve(event);
};
