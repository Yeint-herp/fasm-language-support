"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const symbols_1 = require("./symbols");
const goto_1 = require("./goto");
const tokenTypes = ['label', 'constant'];
const tokenModifiers = [];
const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
class FasmgSemanticTokensProvider {
    constructor(index) {
        this.index = index;
    }
    async provideDocumentSemanticTokens(document, token) {
        const builder = new vscode.SemanticTokensBuilder(legend);
        await this.index.ensureInitialized();
        if (token.isCancellationRequested) {
            return builder.build();
        }
        await this.index.indexDocument(document);
        if (token.isCancellationRequested) {
            return builder.build();
        }
        const kindCache = new Map();
        for (let line = 0; line < document.lineCount; line++) {
            if (token.isCancellationRequested)
                break;
            const fullText = document.lineAt(line).text;
            const noComment = fullText.split(';', 1)[0];
            const text = maskStrings(noComment);
            symbols_1.identifierRegexGlobal.lastIndex = 0;
            let m;
            while ((m = symbols_1.identifierRegexGlobal.exec(text))) {
                const name = m[0];
                let kind = kindCache.get(name);
                if (kind === undefined) {
                    kind = this.index.lookupSymbolKind(name);
                    kindCache.set(name, kind);
                }
                if (!kind)
                    continue;
                let typeIndex = -1;
                if (kind === 'label') {
                    typeIndex = tokenTypes.indexOf('label');
                }
                else if (kind === 'value') {
                    typeIndex = tokenTypes.indexOf('constant');
                }
                if (typeIndex === -1)
                    continue;
                const startChar = m.index;
                builder.push(line, startChar, name.length, typeIndex, 0);
            }
        }
        return builder.build();
    }
}
function maskStrings(text) {
    const chars = text.split('');
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const prev = i > 0 ? text[i - 1] : '';
        if (!inSingle && ch === '"' && prev !== '\\') {
            inDouble = !inDouble;
            chars[i] = ' ';
            continue;
        }
        if (!inDouble && ch === '\'' && prev !== '\\') {
            inSingle = !inSingle;
            chars[i] = ' ';
            continue;
        }
        if (inSingle || inDouble) {
            chars[i] = ' ';
        }
    }
    return chars.join('');
}
function activate(context) {
    const index = new goto_1.FasmgSymbolIndex();
    const selector = [
        { language: 'fasmg' },
        { scheme: 'file', pattern: '**/*.asm' },
        { scheme: 'file', pattern: '**/*.inc' },
        { scheme: 'untitled', language: 'fasmg' },
    ];
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => {
        void index.indexDocument(doc);
    }), vscode.workspace.onDidChangeTextDocument((e) => {
        void index.indexDocument(e.document);
    }), vscode.workspace.onDidSaveTextDocument((doc) => {
        void index.indexDocument(doc);
    }));
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new FasmgSemanticTokensProvider(index), legend), vscode.languages.registerDefinitionProvider(selector, new goto_1.FasmgDefinitionProvider(index)));
    void index.ensureInitialized();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map