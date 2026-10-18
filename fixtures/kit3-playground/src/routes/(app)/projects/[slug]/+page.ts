import { error } from '@sveltejs/kit';
import { projects } from '#lib/projects.js';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const project = projects.find((p) => p.slug === params.slug);
	if (!project) error(404, 'Project not found');
	return { project };
};
