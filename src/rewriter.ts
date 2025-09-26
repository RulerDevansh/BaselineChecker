import type { ScanIssue } from './scanner';

function wrapComment(languageId: string, message: string): string {
  return languageId === 'html' ? `<!-- ${message} -->` : `/* ${message} */`;
}

/**
 * Offline fallback: prepend a header listing issues. Non-destructive.
 */
export function rewriteRuleBased(docText: string, languageId: string, issues: ScanIssue[]): string {
  if (!issues || issues.length === 0) return docText;
  const header = [
    'AI fallback rewrite applied.',
    'Non-Baseline features detected:',
    ...issues.map(i => `- ${i.featureId} (${i.status}) at line ${i.range.line + 1}`)
  ].join('\n');
  const banner = wrapComment(languageId, header);
  return `${banner}\n${docText}`;
}
