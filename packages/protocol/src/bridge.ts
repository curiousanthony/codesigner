/**
 * Messages exchanged between the editor (host) and the bridge script running
 * inside each canvas webview (guest). Transport: webview.send() host→guest,
 * ipcRenderer.sendToHost() guest→host, both on the BRIDGE_CHANNEL.
 */
export const BRIDGE_CHANNEL = 'codesigner:bridge';

/** Source location as reported by Svelte's dev-mode `__svelte_meta`. Line is 1-based, column 0-based. */
export interface SourceLoc {
	file: string;
	line: number;
	column: number;
	/** Tag or component name expected at this location; used to validate stale locations. */
	tag?: string;
}

/** One entry of Svelte's dev stack: where a component/block was instantiated. */
export interface StackFrame extends SourceLoc {
	type: 'component' | 'if' | 'each' | 'await' | 'key' | 'snippet' | 'render' | string;
	/** Component name when type === 'component' (derived from the rendered file). */
	componentName?: string;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Runtime node id: a stable-within-a-render path such as "0.3.1" from document.body. */
export type NodeId = string;

export interface Spacing {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface ComputedSnapshot {
	display: string;
	position: string;
	flexDirection: string;
	flexWrap: string;
	justifyContent: string;
	alignItems: string;
	gap: string;
	rowGap: string;
	columnGap: string;
	gridTemplateColumns: string;
	width: string;
	height: string;
	minWidth: string;
	maxWidth: string;
	minHeight: string;
	maxHeight: string;
	padding: Spacing;
	margin: Spacing;
	borderRadius: string;
	borderWidth: string;
	borderColor: string;
	borderStyle: string;
	backgroundColor: string;
	color: string;
	opacity: string;
	overflow: string;
	boxShadow: string;
	filter: string;
	backdropFilter: string;
	fontFamily: string;
	fontSize: string;
	fontWeight: string;
	lineHeight: string;
	letterSpacing: string;
	textTransform: string;
	fontStyle: string;
	textDecorationLine: string;
	textAlign: string;
	/** Parent's display, needed to know if the element is a flex/grid child. */
	parentDisplay: string;
	parentFlexDirection: string;
}

export interface ElementInfo {
	id: NodeId;
	/** "instance" when the layer is a component usage (e.g. <Button>), "element" for plain markup. */
	kind: 'element' | 'instance';
	tag: string;
	/** Display name used in the layers panel and selection label. */
	name: string;
	/** Raw class attribute of the (root) DOM element, after cn()/tv() resolution. */
	className: string;
	/** Short visible text (first 80 chars) for labels and comment anchoring. */
	text: string;
	rect: Rect;
	/**
	 * Where to edit this layer: the element's opening tag, or for an instance the
	 * component tag at its usage site (e.g. `<Button` in +page.svelte).
	 */
	loc: SourceLoc | null;
	/** For instances: the component name as written, e.g. "Button" or "Card.Root". */
	componentTag: string | null;
	/** For instances: file that defines the component's root markup. */
	definitionFile: string | null;
	/** Nearest-first chain of Svelte dev stack frames above the element. */
	stack: StackFrame[];
	computed: ComputedSnapshot;
	/** Number of live elements rendered from the same source location ({#each} repeats). */
	repeatCount: number;
	/** True when the element sits inside an {#each} block. */
	inEach: boolean;
	/** Whether static text of this element can be edited in place. */
	textEditable: boolean;
	editable: boolean;
	readonlyReason: string | null;
	childCount: number;
	/** data-slot attribute used by shadcn-svelte components. */
	slot: string | null;
	/** Flex/grid containers: boxes of the child layers, relative to this layer's box (for gap handles). */
	childOffsets?: Rect[];
	/** On the component canvas: the variant values (and `state`) of the cell this element is the root of. */
	context?: Record<string, string> | null;
}

/** A node of the layer tree sent to the host. */
export interface LayerNode {
	id: NodeId;
	name: string;
	kind: LayerKind;
	tag: string;
	loc: SourceLoc | null;
	isInstance: boolean;
	repeatCount: number;
	hidden?: boolean;
	children: LayerNode[];
}

export type LayerKind =
	| 'stack-h'
	| 'stack-v'
	| 'grid'
	| 'frame'
	| 'text'
	| 'image'
	| 'icon'
	| 'input'
	| 'link'
	| 'button'
	| 'component';

export type CanvasMode = 'design' | 'interact' | 'comment';

/** Where a layer drawn or dropped at a point would go: a container and a position among its children. */
export interface DropTarget {
	parentId: NodeId;
	parent: SourceLoc;
	/** null appends (empty container, or past the last child). */
	anchor: { target: SourceLoc; position: 'before' | 'after' } | null;
	parentRect: Rect;
	/** Insertion indicator (guest viewport px); null when the container is empty. */
	line: Rect | null;
}

export type HostToGuest =
	| { type: 'init'; frameId: string; scope: string[]; mode: CanvasMode }
	| { type: 'hit'; reqId: number; x: number; y: number }
	/** `exclude`: a layer being dragged (not a target, not a sibling to place around; containers must be in its file). */
	| { type: 'drop-target'; reqId: number; x: number; y: number; exclude?: NodeId }
	| { type: 'describe'; reqId: number; ids: NodeId[] }
	| { type: 'find-loc'; reqId: number; loc: SourceLoc }
	| { type: 'highlight'; hover: NodeId | null; selected: NodeId[]; /** Parents of the selection, outlined faintly. */ parents?: NodeId[] }
	| { type: 'request-tree' }
	/** Files (relative to the project) whose markup is selectable without entering a component. */
	| { type: 'set-scope'; files: string[] }
	| { type: 'set-mode'; mode: CanvasMode }
	| { type: 'preview-classes'; ids: NodeId[]; remove: string[]; add: string[]; css?: string }
	| { type: 'clear-preview' }
	| { type: 'scroll-at'; x: number; y: number; dx: number; dy: number }
	| { type: 'set-dark'; dark: boolean }
	| { type: 'navigate'; url: string }
	/** Edit a text layer in place (contenteditable); the guest answers with `text-edited`. */
	| { type: 'edit-text'; id: NodeId }
	| { type: 'end-edit-text'; cancel: boolean }
	/** Comment pins to track: their rects come back with every `rects` message (null = element not found). */
	| { type: 'set-anchors'; anchors: { id: string; loc: SourceLoc; occurrence: number; text: string }[] }
	/** Marks layers whose :hover / :active / :focus the host forces through DevTools ("none" clears). */
	| { type: 'force-state'; ids: NodeId[]; state: 'none' | 'hover' | 'active' | 'focus' }
	/** Puts text back after a refused edit (the frame shows what was typed until then). */
	| { type: 'set-text'; id: NodeId; text: string };

export type GuestToHost =
	| { type: 'ready'; url: string; title: string; svelteDev: boolean }
	/** Layer ids from the root to the deepest layer under the point. */
	| { type: 'hit-result'; reqId: number; path: NodeId[] }
	| { type: 'drop-result'; reqId: number; target: DropTarget | null }
	| { type: 'described'; reqId: number; elements: ElementInfo[] }
	| { type: 'found-loc'; reqId: number; ids: NodeId[] }
	| { type: 'tree'; root: LayerNode | null }
	/** Rects (guest viewport px) of highlighted layers; sent on scroll, resize, mutation and HMR. */
	| { type: 'rects'; hover: Rect | null; selected: Record<NodeId, Rect>; parents?: Record<NodeId, Rect>; /** In-place component editing: the instances left undimmed. */ focus?: Rect[]; anchors?: Record<string, Rect | null> }
	| { type: 'dom-changed'; reason: 'mutation' | 'hmr' }
	| { type: 'navigated'; url: string; title: string }
	| { type: 'scrolled'; consumed: boolean; dx: number; dy: number }
	| { type: 'key'; key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
	| { type: 'text-edited'; id: NodeId; text: string; original: string; cancelled: boolean };
