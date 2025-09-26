import * as vscode from 'vscode';
import { scanTextForBaseline } from './scanner';
import { rewriteWithAI } from './aiRewriter';
import { rewriteRuleBased } from './rewriter';
import { log } from 'console';

let diagnostics: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Baseliner] activated()');
  diagnostics = vscode.languages.createDiagnosticCollection('baseline');
  context.subscriptions.push(diagnostics);

  const command = vscode.commands.registerCommand('baseline.scanFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    runScan(editor.document);
  });
  context.subscriptions.push(command);

  // AI rewrite command
  const rewriteCmd = vscode.commands.registerCommand('baseline.rewriteFileAI', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await rewriteCurrentFile(editor);
  });
  context.subscriptions.push(rewriteCmd);

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

  // Status bar items
  const scanItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  scanItem.text = '$(search) Baseline Scan';
  scanItem.tooltip = 'Scan file for Baseline compliance';
  scanItem.command = 'baseline.scanFile';
  scanItem.show();
  context.subscriptions.push(scanItem);

  const aiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
  aiItem.text = '$(wand) Rewrite to Baseline (AI)';
  aiItem.tooltip = 'Rewrite current file to Baseline-safe code using Gemini';
  aiItem.command = 'baseline.rewriteFileAI';
  aiItem.show();
  context.subscriptions.push(aiItem);

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

async function rewriteCurrentFile(editor: vscode.TextEditor) {
  const doc = editor.document;
  if (!isSupported(doc)) return;

  const cfgScanner = vscode.workspace.getConfiguration('baselineScanner');
  const deprecatedTags = cfgScanner.get<string[]>('deprecatedTags') || [];
  const { issues } = scanTextForBaseline(doc.getText(), doc.languageId, { deprecatedTags });

  // Only act on issues that are not-baseline or deprecated (scanner never returns baseline)
  const actionable = issues;

  const cfg = vscode.workspace.getConfiguration('baseline');
  const apiKey = (cfg.get<string>('geminiApiKey') || '').trim();
  

  let newText: string | undefined;
  let usedAI = false;
  try {
    if (apiKey) {
      newText = await rewriteWithAI(doc.getText(), doc.languageId, actionable);
      usedAI = true;
    }
    else throw new Error('NO_GEMINI_API_KEY');
  } catch (e: any) {
    console.log(e);
    const msg = String(e?.message || e || '');
    const isQuota = (e && typeof e === 'object' && (e as any).status === 429) || /\b429\b|too many requests|quota|exceeded/i.test(msg);
    if (isQuota) {
      const brief = msg.length > 800 ? msg.slice(0, 800) + '…' : msg;
      const choice = await vscode.window.showInformationMessage(
        `Gemini quota exceeded. Falling back to local rewrite.\n${brief}`,
        'Learn more'
      );
      if (choice === 'Learn more') {
        vscode.env.openExternal(vscode.Uri.parse('https://ai.google.dev/gemini-api/docs/rate-limits'));
      }
    }
    newText = rewriteRuleBased(doc.getText(), doc.languageId, actionable);
    usedAI = false;
  }

  if (!newText || newText === doc.getText()) {
    vscode.window.showWarningMessage('No changes from rewrite.');
    return;
  }

  const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(doc.lineCount, 0));
  await editor.edit(ed => ed.replace(fullRange, newText!));
  vscode.window.showInformationMessage(usedAI ? 'AI rewrite applied (Gemini)' : 'Fallback rewrite applied');

  runScan(editor.document);
}
