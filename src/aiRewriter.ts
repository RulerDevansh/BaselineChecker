import * as vscode from 'vscode';
import type { ScanIssue } from './scanner';

/**
 * Calls Google Gemini to rewrite the file into Baseline-safe code.
 * Returns the rewritten text. Throws if API key missing or the call fails.
 */
export async function rewriteWithAI(docText: string, languageId: string, issues: ScanIssue[]): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('baseline');
  const apiKey = (cfg.get<string>('geminiApiKey') || '').trim();
  
  const modelName = (cfg.get<string>('geminiModel') || 'gemini-2.5-pro').trim();
  if (!apiKey) throw new Error('NO_GEMINI_API_KEY');

  // ESM-only client; use dynamic import from CJS context
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const issuesSummary = (issues || [])
    .map(i => `- ${i.featureId} (${i.status}) at line ${i.range.line + 1}`)
    .join('\n');

  const systemPrompt = [
    'You are a precise code transformation assistant.',
    'Task: Regenerate the ENTIRE provided file as Baseline-safe HTML/CSS only.',
    '',
    'STRICT RULES:',
    '1) Do not keep any non-Baseline or deprecated features. Replace them with Baseline-supported equivalents.',
    '2) Regenerate the full file content; preserve intent and semantics as closely as possible.',
    '3) Avoid comments. Use comments only when absolutely necessary to preserve meaning. Prefer pure code.',
    '4) Keep structure readable and minimal. Avoid adding libraries or JS unless essential for parity.',
    '5) Output format: Return ONLY the complete rewritten file content between these exact markers:',
    '   <<<BEGIN>>>',
    '   ... file content ...',
    '   <<<END>>>',
    '   No other text before/after.',
    '',
    'Guidance examples (when applicable):',
    '- :has(...) → switch to a class-based or descendant-based strategy (e.g., add a parent utility class in HTML).',
    '- @scope → unwrap and prefix inner selectors with a container class or :where container.',
    '- text-box: trim → use supported layout equivalents (e.g., display/overflow/text-overflow/white-space as needed).',
    '- dialog[closedby] → remove and rely on manual close handling if necessary.',
    '- <marquee>/<blink>/<big>/<font>/etc. → remove or replace with supported HTML/CSS patterns.',
    '- cursor values: use widely-supported ones (e.g., pointer, move).',
  ].join('\n');

  const userPrompt = [
    `Language: ${languageId}`,
    'Non-Baseline findings:',
    issuesSummary || '- (none listed by the scanner)',
    '',
    'Rewrite this file to be Baseline-safe:'
  ].join('\n');

  const input = [
    systemPrompt,
    userPrompt,
    '-----BEGIN FILE-----',
    docText,
    '-----END FILE-----'
  ].join('\n');

  const result = await model.generateContent(input);
  const raw = (await result.response.text()).trim();
  const text = extractMarkedOutput(raw) || stripFences(raw);

  if (!text) throw new Error('EMPTY_AI_RESPONSE');
  return text;
}

function stripFences(s: string): string {
  // Remove common markdown fences the model may include
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/m;
  const m = fence.exec(s);
  if (m) return m[1].trim();
  return s;
}

function extractMarkedOutput(s: string): string | null {
  const begin = s.indexOf('<<<BEGIN>>>');
  if (begin === -1) return null;
  const end = s.indexOf('<<<END>>>', begin + '<<<BEGIN>>>'.length);
  if (end === -1) return null;
  const content = s.slice(begin + '<<<BEGIN>>>'.length, end);
  return content.trim();
}
