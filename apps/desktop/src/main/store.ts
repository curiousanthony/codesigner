import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Tiny JSON store in userData for app-level state (recent projects, window
 * bounds, appearance). Read on first use, not at import: stores are created at
 * module load, before CODESIGNER_USER_DATA redirects userData.
 */
export class JsonStore<T extends object> {
	private data: T | null = null;

	constructor(
		private readonly name: string,
		private readonly defaults: T
	) {}

	private get file() {
		return join(app.getPath('userData'), `${this.name}.json`);
	}

	private load(): T {
		if (this.data) return this.data;
		try {
			this.data = { ...this.defaults, ...JSON.parse(readFileSync(this.file, 'utf8')) };
		} catch {
			this.data = { ...this.defaults };
		}
		return this.data!;
	}

	get<K extends keyof T>(key: K): T[K] {
		return this.load()[key];
	}

	set<K extends keyof T>(key: K, value: T[K]) {
		this.load()[key] = value;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(this.data, null, '\t'));
	}
}
