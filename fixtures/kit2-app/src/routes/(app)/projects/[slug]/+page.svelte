<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';

	let { data } = $props();
</script>

<div class="flex flex-col gap-6 p-8">
	<div class="flex items-center gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
		<Badge variant="outline">{data.project.status}</Badge>
	</div>
	<Card.Root class="max-w-xl">
		<Card.Header>
			<Card.Title>Progress</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary" style="width: {data.project.progress}%"></div>
			</div>
		</Card.Content>
	</Card.Root>
</div>
