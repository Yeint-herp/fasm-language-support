import * as vscode from 'vscode';
import {
    buildSymbolTable,
    SymbolTable,
    identifierRegex,
    normalizeUsageName,
} from './symbols';

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

    async ensureInitialized(): Promise<void> {
        if (!this.initialScan) {
            this.initialScan = this.scanWorkspace();
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
