import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Tiny JSON store in userData for app-level state (recent projects, window bounds). */
export class JsonStore<T extends object> {
	private data: T;
	private readonly file: string;

	constructor(name: string, defaults: T) {
		this.file = join(app.getPath('userData'), `${name}.json`);
		try {
			this.data = { ...defaults, ...JSON.parse(readFileSync(this.file, 'utf8')) };
		} catch {
			this.data = defaults;
		}
	}

	get<K extends keyof T>(key: K): T[K] {
		return this.data[key];
	}

	set<K extends keyof T>(key: K, value: T[K]) {
		this.data[key] = value;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(this.data, null, '\t'));
	}
}
