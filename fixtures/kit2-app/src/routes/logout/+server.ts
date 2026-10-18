import { redirect } from '@sveltejs/kit';

export const POST = ({ cookies }) => {
	cookies.delete('playground_session', { path: '/' });
	redirect(303, '/login');
};
