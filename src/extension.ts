import * as vscode from 'vscode';
import { scanTextForBaseline } from './scanner';

let diagnostics: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Baseline Checker] activated()');
  diagnostics = vscode.languages.createDiagnosticCollection('baseline');
  context.subscriptions.push(diagnostics);

  const command = vscode.commands.registerCommand('baseline.scanFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    runScan(editor.document);
  });
  context.subscriptions.push(command);

  // Hover provider for HTML, CSS, SCSS, LESS
  const hoverProvider = vscode.languages.registerHoverProvider(
    [{ language: 'html' }, { language: 'css' }, { language: 'scss' }, { language: 'less' }],
    {
      provideHover(doc: vscode.TextDocument, position: vscode.Position) {
        const diags = diagnostics.get(doc.uri) || [];
        for (const d of diags) {
          if (d.range.contains(position)) {
            // Extract status from the diagnostic message to show precise status (not-baseline, deprecated)
            let status = 'not-baseline';
            const m = /is (not-baseline|deprecated) in Baseline/i.exec(d.message || '');
            if (m) status = m[1].toLowerCase();
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**Feature ID:** \`${d.code}\`\n\n`);
            md.appendMarkdown(`**Status:** \`${status}\``);
            return new vscode.Hover(md);
          }
        }
        return undefined;
      },
    }
  );
  context.subscriptions.push(hoverProvider);

  // Auto-scan on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isSupported(doc)) runScan(doc);
    })
  );

  // Auto-scan on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isSupported(doc)) runScan(doc);
    })
  );

  // Auto-scan on text change
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isSupported(e.document)) runScan(e.document);
    })
  );

  // Scan already opened active editor once on activation
  if (vscode.window.activeTextEditor && isSupported(vscode.window.activeTextEditor.document)) {
    runScan(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  diagnostics?.dispose();
}

function isSupported(doc: vscode.TextDocument) {
  return doc.languageId === 'html' || doc.languageId === 'css' || doc.languageId === 'scss' || doc.languageId === 'less';
}

function runScan(doc: vscode.TextDocument) {
  if (!isSupported(doc)) return;

  const config = vscode.workspace.getConfiguration('baselineScanner');
  const deprecatedTags = config.get<string[]>('deprecatedTags') || [];
  const result = scanTextForBaseline(doc.getText(), doc.languageId, { deprecatedTags });

  const fileDiagnostics: vscode.Diagnostic[] = [];
  for (const issue of result.issues) {
    const range = new vscode.Range(
      new vscode.Position(issue.range.line, issue.range.start),
      new vscode.Position(issue.range.line, issue.range.end)
    );
    // Treat all issues as warnings per user preference
    const severity = vscode.DiagnosticSeverity.Warning;
    const diag = new vscode.Diagnostic(range, issue.message, severity);
    diag.source = 'Baseline';
    diag.code = issue.featureId;
    fileDiagnostics.push(diag);
  }

  diagnostics.set(doc.uri, fileDiagnostics);
}
