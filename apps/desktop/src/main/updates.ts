import { net } from 'electron';
import { appVersion } from './env.js';
import type { UpdateInfo } from '@codesigner/protocol';

const REPO = 'curiousanthony/codesigner';

/** Compares dotted versions numerically; ignores pre-release suffixes. */
export function isNewer(latest: string, current: string): boolean {
	const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
	const a = parse(latest);
	const b = parse(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
}

/**
 * Unsigned builds can't auto-install on macOS, so we only check GitHub Releases
 * and let the editor show an "Update available" banner with a download link.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
	if (!net.isOnline()) return null;
	try {
		const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codesigner' }
		});
		if (!response.ok) return null;
		const release = (await response.json()) as {
			tag_name: string;
			html_url: string;
			body: string | null;
			published_at: string;
			draft: boolean;
			prerelease: boolean;
		};
		if (release.draft || release.prerelease) return null;
		const current = appVersion();
		if (!isNewer(release.tag_name, current)) return null;
		return {
			current,
			latest: release.tag_name.replace(/^v/, ''),
			url: release.html_url,
			notes: release.body ?? '',
			publishedAt: release.published_at
		};
	} catch {
		return null;
	}
}
