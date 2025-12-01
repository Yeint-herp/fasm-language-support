"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const tokenTypes = ['label', 'constant'];
const tokenModifiers = [];
const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
const identifierRegexGlobal = /[.?A-Za-z_$][A-Za-z0-9_.#$?]*/g;
const identifierRegex = /[.?A-Za-z_$][A-Za-z0-9_.#$?]*/;
const labelDefRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)(?:::|:)/i;
const equRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\s+(equ|reequ)\b/i;
const defineRegex = /^\s*define\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)/i;
const assignRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\s*(?::=|=:|=)/;
function buildSymbolTable(document) {
    const labels = new Map();
    const constants = new Map();
    for (let line = 0; line < document.lineCount; line++) {
        const fullText = document.lineAt(line).text;
        const text = fullText.split(';', 1)[0];
        let m;
        if ((m = labelDefRegex.exec(text))) {
            const name = m[1];
            const norm = name.toLowerCase();
            const col = text.indexOf(name);
            const pos = new vscode.Position(line, col);
            if (!labels.has(norm))
                labels.set(norm, []);
            labels.get(norm).push(pos);
            continue;
        }
        if ((m = defineRegex.exec(text)) ||
            (m = equRegex.exec(text)) ||
            (m = assignRegex.exec(text))) {
            const name = m[1];
            const norm = name.toLowerCase();
            const col = text.indexOf(name);
            const pos = new vscode.Position(line, col);
            if (!constants.has(norm))
                constants.set(norm, []);
            constants.get(norm).push(pos);
        }
    }
    return { labels, constants };
}
class FasmgSemanticTokensProvider {
    async provideDocumentSemanticTokens(document, _token) {
        const builder = new vscode.SemanticTokensBuilder(legend);
        const { labels, constants } = buildSymbolTable(document);
        for (let line = 0; line < document.lineCount; line++) {
            const fullText = document.lineAt(line).text;
            const text = fullText.split(';', 1)[0];
            identifierRegexGlobal.lastIndex = 0;
            let m;
            while ((m = identifierRegexGlobal.exec(text))) {
                const name = m[0];
                const norm = name.toLowerCase();
                let typeIndex = -1;
                if (labels.has(norm))
                    typeIndex = tokenTypes.indexOf('label');
                else if (constants.has(norm))
                    typeIndex = tokenTypes.indexOf('constant');
                if (typeIndex === -1)
                    continue;
                const startChar = m.index;
                builder.push(line, startChar, name.length, typeIndex, 0);
            }
        }
        return builder.build();
    }
}
class FasmgDefinitionProvider {
    provideDefinition(document, position, _token) {
        const range = document.getWordRangeAtPosition(position, identifierRegex);
        if (!range)
            return null;
        const name = document.getText(range);
        const norm = name.toLowerCase();
        const { labels, constants } = buildSymbolTable(document);
        const defPos = (labels.get(norm) && labels.get(norm)[0]) || (constants.get(norm) && constants.get(norm)[0]);
        if (!defPos)
            return null;
        return new vscode.Location(document.uri, defPos);
    }
}
function activate(context) {
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'fasmg' }, new FasmgSemanticTokensProvider(), legend), vscode.languages.registerDefinitionProvider({ language: 'fasmg' }, new FasmgDefinitionProvider()));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map