<script lang="ts">
	import { projects } from '#lib/projects.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
</script>

<div class="flex flex-col gap-4 p-8">
	<h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
	<Separator />
	<ul class="flex flex-col divide-y rounded-lg border">
		{#each projects as project (project.slug)}
			<li class="flex items-center justify-between px-4 py-3">
				<a href="/projects/{project.slug}" class="font-medium hover:underline">{project.name}</a>
				<span class="text-sm text-muted-foreground">{project.status}</span>
			</li>
		{/each}
	</ul>
</div>
