# Baseliner — AI Baseline Scanner & Rewriter

Baseliner is a VS Code extension that scans HTML/CSS for features that aren’t in the Baseline (via the `web-features` dataset), highlights them inline, and can auto‑rewrite files to Baseline‑safe code using Google Gemini or a local fallback rewriter.

## What it does
- Inline diagnostics with hover:
  - HTML: elements and attributes (with value‑aware matching like `tag:attr:value` and boolean attributes)
  - CSS: properties, at‑rules, and property values
  - CSS inside `<style>` blocks in HTML (with precise position mapping)
- Automatic scanning on open/save/typing
- Command palette and status‑bar actions
  - “Scan file for Baseline compliance”
  - “Rewrite to Baseline (AI)”
- Editor title‑bar star button to run the AI rewrite quickly
- AI rewrite (Gemini):
  - Regenerates the entire file as Baseline‑safe code
  - Strict output handling; supports configurable model
  - Graceful handling of 429/quota errors with fallback
- Fallback rewrite (no AI needed):
  - Replaces common non‑Baseline constructs deterministically:
    - `<big>` → `<span class="u-big">` + injects `.u-big { font-size: larger; }`
    - `<marquee>` content unwrapped (tag removed)
    - `dialog[closedby]` attribute removed
    - CSS: `:has(...)` → parent utility class, `@scope` unwrapped with container prefix, `text-box: trim` → truncation CSS, cursor fallbacks
- Comment‑aware scanning: ignores HTML/CSS/SCSS/LESS comments, and masks `<style>` content during HTML tag scanning to avoid false positives like `<big>` in CSS comments.

## Screenshots
- HTML diagnostics: `assets/Screenshot1.png`
- Hover details: `assets/Screenshot2.png`
- CSS (including inside `<style>`): `assets/Screenshot3.png`
- Editor star button for AI rewrite: `assets/Screenshot4.png`
- Extension settings (API key, model, deprecated tags): `assets/Screenshot5.png`

## Settings
- `baselineScanner.deprecatedTags: string[]`
  - Additional HTML tag names to always treat as deprecated.
- `baseline.geminiApiKey: string`
  - Your Google Gemini API key for AI rewrites.
- `baseline.geminiModel: string`
  - One of: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-001`.

## Usage
1. Open an HTML/CSS/SCSS/LESS file.
2. Baseliner scans automatically; hover squiggles for details.
3. To fix:
   - Run “Scan file for Baseline compliance” (Command Palette or status bar), or
   - Click the star button “Rewrite to Baseline (AI)” to auto‑rewrite the whole file.
4. If the AI model is unavailable or quota is exceeded, a friendly message appears and the fallback rewrite is applied.

## Development
- Build: `npm run compile`
- Package: `npm run package`
- Tech: VS Code API, TypeScript, `web-features`, `@google/generative-ai`

## Notes
- The scanner uses heuristics; a full parser would improve fidelity further.
- The fallback rewrite is intentionally conservative; adjust strategies per project needs.
