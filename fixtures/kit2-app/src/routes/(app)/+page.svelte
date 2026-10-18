<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { projects } from '$lib/projects';
</script>

<div class="flex flex-col gap-6 p-8">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
			<p class="text-sm text-muted-foreground">Everything happening across your projects.</p>
		</div>
		<Button href="/projects">View all projects</Button>
	</header>

	<section class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each projects as project (project.slug)}
			<Card.Root>
				<Card.Header>
					<Card.Title>{project.name}</Card.Title>
					<Card.Description>{project.progress}% complete</Card.Description>
				</Card.Header>
				<Card.Content class="flex items-center justify-between">
					<Badge variant={project.status === 'active' ? 'default' : 'secondary'}>{project.status}</Badge>
					<Button href="/projects/{project.slug}" variant="outline" size="sm">Open</Button>
				</Card.Content>
			</Card.Root>
		{/each}
	</section>
</div>
