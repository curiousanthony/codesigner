import { fail, redirect } from '@sveltejs/kit';
import { DEMO_USER } from '#lib/server/demo-user.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '');
		const password = String(data.get('password') ?? '');
		if (email !== DEMO_USER.email || password !== DEMO_USER.password) {
			return fail(400, { email, message: 'Invalid email or password' });
		}
		cookies.set('playground_session', encodeURIComponent(DEMO_USER.name), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
		redirect(303, url.searchParams.get('redirectTo') ?? '/');
	}
};
