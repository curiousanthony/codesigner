export type Project = { slug: string; name: string; status: 'active' | 'draft' | 'archived'; progress: number };

export const projects: Project[] = [
	{ slug: 'onboarding-flow', name: 'Onboarding flow', status: 'active', progress: 72 },
	{ slug: 'billing-revamp', name: 'Billing revamp', status: 'draft', progress: 18 },
	{ slug: 'mobile-nav', name: 'Mobile navigation', status: 'archived', progress: 100 }
];
