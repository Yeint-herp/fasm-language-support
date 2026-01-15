"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identifierRegex = exports.identifierRegexGlobal = void 0;
exports.normalizeUsageName = normalizeUsageName;
exports.buildSymbolTable = buildSymbolTable;
exports.lookupSymbolKindInTable = lookupSymbolKindInTable;
const vscode = require("vscode");
exports.identifierRegexGlobal = /[.?A-Za-z_$][A-Za-z0-9_.#$?]*/g;
exports.identifierRegex = /[.?A-Za-z_$][A-Za-z0-9_.#$?]*/;
const labelDefRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)(?:::|:)/;
const dataLabelRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\s+(db|dw|dd|dq|dt|dp|ddq|dqq|ddqq|rb|rw|rd|rq|rt|rp|rdq|rqq|rdqq|emit|file)\b/i;
const labelKeywordRegex = /^\s*label\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\b/i;
const equRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\s+(equ|reequ)\b/i;
const defineRegex = /^\s*(define|redefine)\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\b/i;
const assignRegex = /^\s*([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\s*(?::=|=:|=)/;
const elementRegex = /^\s*element\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\b/i;
const loadRegex = /^\s*load\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\b/i;
const macroRegex = /^\s*macro\s+([.?A-Za-z_$][A-Za-z0-9_.#$?]*)\b/i;
function normalizeDefinitionName(raw) {
    let name = raw.trim();
    if (!name)
        return null;
    let isCaseInsensitive = false;
    if (name.length > 1 && name.endsWith('?')) {
        isCaseInsensitive = true;
        name = name.slice(0, -1);
    }
    if (!name)
        return null;
    return { baseName: name, isCaseInsensitive };
}
function normalizeUsageName(raw) {
    let name = raw.trim();
    if (!name)
        return { baseName: '', isExplicitCaseInsensitive: false };
    let isExplicit = false;
    if (name.length > 1 && name.endsWith('?')) {
        isExplicit = true;
        name = name.slice(0, -1);
    }
    return { baseName: name, isExplicitCaseInsensitive: isExplicit };
}
function addRange(map, key, range) {
    const existing = map.get(key);
    if (existing)
        existing.push(range);
    else
        map.set(key, [range]);
}
function addLabel(table, rawName, range) {
    const norm = normalizeDefinitionName(rawName);
    if (!norm)
        return;
    const key = norm.isCaseInsensitive
        ? norm.baseName.toLowerCase()
        : norm.baseName;
    if (norm.isCaseInsensitive)
        addRange(table.labelsInsensitive, key, range);
    else
        addRange(table.labelsSensitive, key, range);
}
function addValue(table, rawName, range) {
    const norm = normalizeDefinitionName(rawName);
    if (!norm)
        return;
    const key = norm.isCaseInsensitive
        ? norm.baseName.toLowerCase()
        : norm.baseName;
    if (norm.isCaseInsensitive)
        addRange(table.valuesInsensitive, key, range);
    else
        addRange(table.valuesSensitive, key, range);
}
function buildSymbolTable(document) {
    const table = {
        labelsSensitive: new Map(),
        labelsInsensitive: new Map(),
        valuesSensitive: new Map(),
        valuesInsensitive: new Map(),
    };
    for (let line = 0; line < document.lineCount; line++) {
        const fullText = document.lineAt(line).text;
        const text = fullText.split(';', 1)[0];
        if (!text.trim())
            continue;
        let m;
        if ((m = labelDefRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addLabel(table, name, range);
            }
            continue;
        }
        if ((m = dataLabelRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addLabel(table, name, range);
            }
        }
        if ((m = labelKeywordRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addLabel(table, name, range);
            }
        }
        if ((m = elementRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
        if ((m = defineRegex.exec(text))) {
            const name = m[2];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
        if ((m = equRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
        if ((m = macroRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
        if ((m = assignRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
        if ((m = loadRegex.exec(text))) {
            const name = m[1];
            const col = text.indexOf(name);
            if (col >= 0) {
                const range = new vscode.Range(line, col, line, col + name.length);
                addValue(table, name, range);
            }
        }
    }
    return table;
}
function lookupSymbolKindInTable(table, rawUsageName) {
    const { baseName, isExplicitCaseInsensitive } = normalizeUsageName(rawUsageName);
    if (!baseName)
        return null;
    if (!isExplicitCaseInsensitive) {
        if (table.labelsSensitive.get(baseName)?.length)
            return 'label';
        if (table.valuesSensitive.get(baseName)?.length)
            return 'value';
    }
    const lower = baseName.toLowerCase();
    if (table.labelsInsensitive.get(lower)?.length)
        return 'label';
    if (table.valuesInsensitive.get(lower)?.length)
        return 'value';
    return null;
}
//# sourceMappingURL=symbols.js.map