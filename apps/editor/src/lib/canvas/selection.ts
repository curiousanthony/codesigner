import type { NodeId } from '@codesigner/protocol';

/**
 * Framer/Figma selection levels. `hitPath` lists layer ids from the top-level
 * layer down to the deepest one under the pointer; `selectedPath` is the path of
 * the current selection (if any). A click selects at the current level: the
 * child of the deepest ancestor shared by the current selection's context and
 * the hit. Double-click drills one level below the selection, ⌘-click selects
 * the deepest layer.
 */
export function pickLayer(
	hitPath: NodeId[],
	selectedPath: NodeId[] | null,
	gesture: 'click' | 'double' | 'deep'
): NodeId | null {
	if (hitPath.length === 0) return null;
	if (gesture === 'deep') return hitPath[hitPath.length - 1];

	if (gesture === 'double' && selectedPath?.length) {
		const selected = selectedPath[selectedPath.length - 1];
		const index = hitPath.indexOf(selected);
		if (index >= 0) return hitPath[Math.min(index + 1, hitPath.length - 1)];
	}

	// The selection's context is its parent chain; compare it with the hit path.
	const context = selectedPath ? selectedPath.slice(0, -1) : [];
	let common = 0;
	while (common < context.length && common < hitPath.length && context[common] === hitPath[common]) common++;
	return hitPath[Math.min(common, hitPath.length - 1)];
}

/** Parent of a selection given its path. */
export function parentOf(path: NodeId[]): NodeId | null {
	return path.length >= 2 ? path[path.length - 2] : null;
}
