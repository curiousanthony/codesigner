import type { Breakpoint } from '@codesigner/protocol';
import { m } from '#lib/paraglide/messages.js';

/** Display name of a breakpoint (built-in ids are translated). */
export function breakpointLabel(bp: Breakpoint): string {
	if (bp.id === 'desktop') return m.breakpoint_desktop();
	if (bp.id === 'tablet') return m.breakpoint_tablet();
	if (bp.id === 'phone') return m.breakpoint_phone();
	return bp.name;
}
