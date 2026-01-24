import * as vscode from 'vscode';
import {
	buildSymbolTable,
	SymbolTable,
	identifierRegex,
	normalizeUsageName,
} from './symbols';

interface PersistedRange {
	sl: number;
	sc: number;
	el: number;
	ec: number;
}

interface PersistedSymbolTable {
	uri: string;

	labelsSensitive: Record<string, PersistedRange[]>;
	labelsInsensitive: Record<string, PersistedRange[]>;

	valuesSensitive: Record<string, PersistedRange[]>;
	valuesInsensitive: Record<string, PersistedRange[]>;
}

interface PersistedIndex {
	documents: PersistedSymbolTable[];
}

interface SymbolLocation {
	uri: vscode.Uri;
	range: vscode.Range;
	kind: 'label' | 'value';
	isCaseInsensitive: boolean;
}

export class FasmgSymbolIndex {
	private documents = new Map<string, SymbolTable>();

	private labelsSensitive = new Map<string, SymbolLocation[]>();
	private labelsInsensitive = new Map<string, SymbolLocation[]>();
	private valuesSensitive = new Map<string, SymbolLocation[]>();
	private valuesInsensitive = new Map<string, SymbolLocation[]>();

	private initialScan: Promise<void> | null = null;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	async ensureInitialized(): Promise<void> {
		if (!this.initialScan) {
			this.initialScan = (async () => {
				await this.loadFromCache();

				await this.scanWorkspace();
			})();
		}
		return this.initialScan;
	}

	private isIndexableDocument(document: vscode.TextDocument): boolean {
		if (document.languageId === 'fasmg') {
			return true;
		}

		const fsPath = document.uri.fsPath.toLowerCase();
		return fsPath.endsWith('.asm') || fsPath.endsWith('.inc');
	}

	private async scanWorkspace(): Promise<void> {
		const patterns = ['**/*.asm', '**/*.inc'];
		const seen = new Set<string>();

		for (const pattern of patterns) {
			const uris = await vscode.workspace.findFiles(pattern);
			for (const uri of uris) {
				const key = uri.toString();
				if (seen.has(key)) continue;
				seen.add(key);

				try {
					const doc = await vscode.workspace.openTextDocument(uri);
					await this.indexDocument(doc);
				} catch { }
			}
		}

		for (const doc of vscode.workspace.textDocuments) {
			await this.indexDocument(doc);
		}
	}

	async indexDocument(document: vscode.TextDocument): Promise<void> {
		if (!this.isIndexableDocument(document)) {
			return;
		}

		const key = document.uri.toString();

		this.documents.delete(key);
		this.removeFromIndex(document.uri, this.labelsSensitive);
		this.removeFromIndex(document.uri, this.labelsInsensitive);
		this.removeFromIndex(document.uri, this.valuesSensitive);
		this.removeFromIndex(document.uri, this.valuesInsensitive);

		const table = buildSymbolTable(document);
		this.documents.set(key, table);

		this.addTableToIndex(document.uri, table);
		this.scheduleSave();
	}

	removeDocument(uri: vscode.Uri): void {
		const key = uri.toString();
		this.documents.delete(key);
		this.removeFromIndex(uri, this.labelsSensitive);
		this.removeFromIndex(uri, this.labelsInsensitive);
		this.removeFromIndex(uri, this.valuesSensitive);
		this.removeFromIndex(uri, this.valuesInsensitive);
	}

	private removeFromIndex(
		uri: vscode.Uri,
		index: Map<string, SymbolLocation[]>
	): void {
		const uriStr = uri.toString();
		for (const [name, locs] of index) {
			const filtered = locs.filter(
				(loc) => loc.uri.toString() !== uriStr
			);
			if (filtered.length === 0)
				index.delete(name);
			else if (filtered.length !== locs.length)
				index.set(name, filtered);
		}
	}

	private addTableToIndex(uri: vscode.Uri, table: SymbolTable): void {
		const add = (
			map: Map<string, vscode.Range[]>,
			target: Map<string, SymbolLocation[]>,
			kind: 'label' | 'value',
			isCaseInsensitive: boolean
		) => {
			for (const [name, ranges] of map) {
				let list = target.get(name);
				if (!list)
					list = [];
				target.set(name, list);

				for (const range of ranges)
					list.push({ uri, range, kind, isCaseInsensitive });
			}
		};

		add(table.labelsSensitive, this.labelsSensitive, 'label', false);
		add(table.labelsInsensitive, this.labelsInsensitive, 'label', true);
		add(table.valuesSensitive, this.valuesSensitive, 'value', false);
		add(table.valuesInsensitive, this.valuesInsensitive, 'value', true);
	}

	lookupSymbolKind(rawUsageName: string): 'label' | 'value' | null {
		const { baseName, isExplicitCaseInsensitive } = normalizeUsageName(rawUsageName);
		if (!baseName)
			return null;

		if (!isExplicitCaseInsensitive) {
			if (this.labelsSensitive.get(baseName)?.length) return 'label';
			if (this.valuesSensitive.get(baseName)?.length) return 'value';
		}

		const lower = baseName.toLowerCase();
		if (this.labelsInsensitive.get(lower)?.length) return 'label';
		if (this.valuesInsensitive.get(lower)?.length) return 'value';

		return null;
	}

	findDefinitions(rawUsageName: string): vscode.Location[] {
		const { baseName, isExplicitCaseInsensitive } = normalizeUsageName(rawUsageName);
		if (!baseName)
			return [];

		const locations: vscode.Location[] = [];

		if (!isExplicitCaseInsensitive) {
			const labelLocs = this.labelsSensitive.get(baseName) ?? [];
			const valueLocs = this.valuesSensitive.get(baseName) ?? [];
			for (const loc of [...labelLocs, ...valueLocs])
				locations.push(new vscode.Location(loc.uri, loc.range));

			if (locations.length > 0)
				return locations;
		}

		const lower = baseName.toLowerCase();
		const labelIns = this.labelsInsensitive.get(lower) ?? [];
		const valueIns = this.valuesInsensitive.get(lower) ?? [];
		for (const loc of [...labelIns, ...valueIns])
			locations.push(new vscode.Location(loc.uri, loc.range));

		return locations;
	}

	private scheduleSave(): void {
		if (this.saveTimeout !== null)
			clearTimeout(this.saveTimeout);

		this.saveTimeout = setTimeout(() => {
			void this.saveToCache();
		}, 500);
	}

	private static rangesToPersisted(ranges: vscode.Range[]): PersistedRange[] {
		return ranges.map(r => ({
			sl: r.start.line,
			sc: r.start.character,
			el: r.end.line,
			ec: r.end.character,
		}));
	}

	private static persistedToRanges(ranges: PersistedRange[]): vscode.Range[] {
		return ranges.map(r => new vscode.Range(
			r.sl,
			r.sc,
			r.el,
			r.ec
		));
	}

	private static mapToRecord(
		map: Map<string, vscode.Range[]>
	): Record<string, PersistedRange[]> {
		const obj: Record<string, PersistedRange[]> = {};
		for (const [k, v] of map) {
			obj[k] = FasmgSymbolIndex.rangesToPersisted(v);
		}
		return obj;
	}

	private static recordToMap(
		rec: Record<string, PersistedRange[]>
	): Map<string, vscode.Range[]> {
		const map = new Map<string, vscode.Range[]>();
		for (const [k, v] of Object.entries(rec)) {
			map.set(k, FasmgSymbolIndex.persistedToRanges(v));
		}
		return map;
	}

	private async getCacheUris(): Promise<{ dir: vscode.Uri; file: vscode.Uri } | null> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0)
			return null;

		const root = folders[0].uri;
		const dir = vscode.Uri.joinPath(root, '.cache');
		const file = vscode.Uri.joinPath(dir, 'fasmg-symbol-index.json');
		return { dir, file };
	}

	private async saveToCache(): Promise<void> {
		const uris = await this.getCacheUris();
		if (!uris)
			return;

		const { dir, file } = uris;

		try {
			await vscode.workspace.fs.createDirectory(dir);
		} catch {
		}

		const documents: PersistedSymbolTable[] = [];

		for (const [uriStr, table] of this.documents) {
			documents.push({
				uri: uriStr,
				labelsSensitive: FasmgSymbolIndex.mapToRecord(table.labelsSensitive),
				labelsInsensitive: FasmgSymbolIndex.mapToRecord(table.labelsInsensitive),
				valuesSensitive: FasmgSymbolIndex.mapToRecord(table.valuesSensitive),
				valuesInsensitive: FasmgSymbolIndex.mapToRecord(table.valuesInsensitive),
			});
		}

		const payload: PersistedIndex = { documents };
		const data = Buffer.from(JSON.stringify(payload), 'utf8');

		await vscode.workspace.fs.writeFile(file, data);
	}

	private async loadFromCache(): Promise<void> {
		const uris = await this.getCacheUris();
		if (!uris)
			return;

		const { file } = uris;

		let data: Uint8Array;
		try {
			data = await vscode.workspace.fs.readFile(file);
		} catch {
			return;
		}

		let parsed: PersistedIndex;
		try {
			parsed = JSON.parse(Buffer.from(data).toString('utf8'));
		} catch {
			return;
		}

		this.documents.clear();
		this.labelsSensitive.clear();
		this.labelsInsensitive.clear();
		this.valuesSensitive.clear();
		this.valuesInsensitive.clear();

		for (const doc of parsed.documents) {
			const uri = vscode.Uri.parse(doc.uri);

			const table: SymbolTable = {
				labelsSensitive: FasmgSymbolIndex.recordToMap(doc.labelsSensitive),
				labelsInsensitive: FasmgSymbolIndex.recordToMap(doc.labelsInsensitive),
				valuesSensitive: FasmgSymbolIndex.recordToMap(doc.valuesSensitive),
				valuesInsensitive: FasmgSymbolIndex.recordToMap(doc.valuesInsensitive),
			};

			this.documents.set(doc.uri, table);
			this.addTableToIndex(uri, table);
		}
	}
}

export class FasmgDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private readonly index: FasmgSymbolIndex) { }

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Definition | null> {
		const range = document.getWordRangeAtPosition(position, identifierRegex);
		if (!range)
			return null;

		const rawName = document.getText(range);

		await this.index.ensureInitialized();
		if (token.isCancellationRequested)
			return null;

		await this.index.indexDocument(document);
		if (token.isCancellationRequested)
			return null;

		const locations = this.index.findDefinitions(rawName);
		if (locations.length === 0)
			return null;

		if (locations.length === 1)
			return locations[0];

		return locations;
	}
}
