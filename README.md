# Baseline Scanner (Starter)

A VS Code extension that scans HTML and CSS for features not in Baseline using the `web-features` package. It underlines non‑Baseline features and shows a hover with their status.


## Features
- Inline warnings for:
  - HTML elements and attributes that are not Baseline or deprecated
  - CSS properties and at‑rules (including CSS inside `<style>` blocks)
- Hover with status and feature id
- Command: “Scan file for Baseline compliance”
- Auto-scan on open/save/typing
- Built‑in deprecated HTML tag overrides (e.g., marquee, blink, font)
- Setting `baselineScanner.deprecatedTags` to add your own deprecated tags

## Screenshots
![HTML](/assets/screenshot1.png)
![Also Shows Depreciated](/assets/screenshot2.png)
![CSS](/assets/screenshot3.png)

## Settings
`baselineScanner.deprecatedTags: string[]` — additional HTML tag names to treat as deprecated.

## How to run (dev)
1. Install deps and compile
2. Press F5 to launch an Extension Development Host


## Notes
This is a starter implementation using simple heuristics to map tokens (CSS properties, at-rules, HTML tags/attributes) to `web-features` feature IDs. For production, enhance parsing and mapping as needed.
