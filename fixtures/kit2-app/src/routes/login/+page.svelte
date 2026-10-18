<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { form } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-muted p-6">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title>Sign in</Card.Title>
			<Card.Description>Use demo@codesigner.test / design-demo</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" class="flex flex-col gap-4">
				<div class="flex flex-col gap-2">
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" value={form?.email ?? ''} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="password">Password</Label>
					<Input id="password" name="password" type="password" required />
				</div>
				{#if form?.message}
					<p class="text-sm text-destructive">{form.message}</p>
				{/if}
				<Button type="submit" class="w-full">Sign in</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
