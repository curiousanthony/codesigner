import type { NodeId } from '@codesigner/protocol';

/**
 * Framer selection: `hitPath` lists layer ids from the top-level layer down to
 * the deepest one under the pointer. Hover and click go straight to the
 * innermost layer (a component instance counts as one layer); containers are
 * reached by clicking their padding, ⇧↵ / Esc from a child, the Layers panel,
 * or ⌘-click, which picks the outermost layer at the current level (the child
 * of the deepest ancestor shared with the current selection).
 */
export function pickLayer(hitPath: NodeId[], selectedPath: NodeId[] | null, gesture: 'click' | 'container'): NodeId | null {
	if (hitPath.length === 0) return null;
	if (gesture === 'click') return hitPath[hitPath.length - 1];
	const context = selectedPath ? selectedPath.slice(0, -1) : [];
	let common = 0;
	while (common < context.length && common < hitPath.length && context[common] === hitPath[common]) common++;
	return hitPath[Math.min(common, hitPath.length - 1)];
}

/** Parent of a selection given its path. */
export function parentOf(path: NodeId[]): NodeId | null {
	return path.length >= 2 ? path[path.length - 2] : null;
}
