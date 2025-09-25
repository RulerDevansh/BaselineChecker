import { features } from "web-features";

export type BaselineStatus = "baseline" | "not-baseline" | "deprecated";

export interface ScanIssue {
  range: {
    start: number;
    end: number;
    line: number;
  };
  featureId: string;
  status: BaselineStatus;
  message: string;
}

export interface ScanResult {
  issues: ScanIssue[];
}

// Minimal local type to access the fields we need from web-features
type WFStatus = {
  baseline?: "high" | "low" | false;
  // Some datasets expose explicit deprecation/obsoletion or maturity flags
  deprecated?: boolean;
  maturity?: string;
} | undefined;
type WFFeature = {
  name?: string;
  status?: WFStatus;
  compat_features?: string[];
  kind?: string;
  // If present/truthy, treat as discouraged/deprecated
  discouraged?: unknown;
};

// Local overrides for features not represented in web-features, or to enforce project policy.
// Keys are lowercase HTML tag names; values are statuses to report.
const HTML_TAG_STATUS_OVERRIDES = new Map<string, BaselineStatus>([
  // Common obsolete/non-standard elements
  ["acronym", "deprecated"],
  ["applet", "deprecated"],
  ["basefont", "deprecated"],
  ["bgsound", "deprecated"],
  ["big", "deprecated"],
  ["blink", "deprecated"],
  ["center", "deprecated"],
  ["dir", "deprecated"],
  ["font", "deprecated"],
  ["frame", "deprecated"],
  ["frameset", "deprecated"],
  ["isindex", "deprecated"],
  ["keygen", "deprecated"],
  ["listing", "deprecated"],
  ["marquee", "deprecated"],
  ["menuitem", "deprecated"],
  ["nobr", "deprecated"],
  ["noembed", "deprecated"],
  ["noframes", "deprecated"],
  ["plaintext", "deprecated"],
  ["spacer", "deprecated"],
  ["strike", "deprecated"],
  ["tt", "deprecated"],
  ["xmp", "deprecated"],
]);

export interface ScanOptions {
  deprecatedTags?: string[]; // additional tag names to treat as deprecated
}

// Build token-to-feature maps using compat_features
function buildLabelMaps() {
  const cssMap = new Map<string, string>();
  const htmlTagMap = new Map<string, string>();
  const htmlTagAttrMap = new Map<string, string>(); // tag:attr
  const htmlTagAttrValMap = new Map<string, string>(); // tag:attr:value
  const htmlAttrFallbackMap = new Map<string, string>(); // attr (global attributes)

  const all = features as unknown as Record<string, WFFeature>;
  for (const [id, f] of Object.entries(all)) {
    const compat = f.compat_features || [];
    for (const key of compat) {
      if (key.startsWith("css.properties.")) {
        const prop = key.substring("css.properties.".length);
        cssMap.set(prop.toLowerCase(), id);
        continue;
      }
      if (key.startsWith("css.at-rules.")) {
        const rule = key.substring("css.at-rules.".length);
        cssMap.set("@" + rule.toLowerCase(), id);
        continue;
      }
      if (key.startsWith("html.elements.")) {
        const rest = key.substring("html.elements.".length);
        const parts = rest.split(".");
        const tag = parts[0]?.toLowerCase();
        if (!tag) continue;
        if (parts.length === 1) {
          // Element-level feature
          htmlTagMap.set(tag, id);
          continue;
        }
        // Attribute patterns
        let attr: string | undefined;
        let value: string | undefined;
        if (parts[1] === "attributes" && parts.length >= 3) {
          attr = parts[2]?.toLowerCase();
          value = parts[3]?.toLowerCase();
        } else if (parts.length >= 2) {
          // Some keys use tag.attr[.value] (e.g., dialog.open, input.type.date)
          attr = parts[1]?.toLowerCase();
          value = parts[2]?.toLowerCase();
        }
        if (attr && value) {
          htmlTagAttrValMap.set(`${tag}:${attr}:${value}`, id);
        } else if (attr) {
          htmlTagAttrMap.set(`${tag}:${attr}`, id);
        }
        continue;
      }
      if (key.startsWith("html.global_attributes.")) {
        // Global attributes apply to many tags; use as fallback when no tag-specific mapping
        const rest = key.substring("html.global_attributes.".length);
        const parts = rest.split(".");
        const attr = parts[0]?.toLowerCase();
        if (attr) htmlAttrFallbackMap.set(attr, id);
        continue;
      }
      if (key.startsWith("html.attributes.")) {
        // Other attribute namespaces (rare). Treat as fallback
        const rest = key.substring("html.attributes.".length);
        const parts = rest.split(".");
        const attr = parts[0]?.toLowerCase();
        if (attr) htmlAttrFallbackMap.set(attr, id);
        continue;
      }
    }
  }
  return { cssMap, htmlTagMap, htmlTagAttrMap, htmlTagAttrValMap, htmlAttrFallbackMap };
}

// Very small heuristic parser to find feature-like tokens in HTML/CSS text and
// check their Baseline status via "web-features".
// This is a starter approach; for production, consider a real parser.
export function scanTextForBaseline(docText: string, languageId: string, options?: ScanOptions): ScanResult {
  const issues: ScanIssue[] = [];
  const { cssMap, htmlTagMap, htmlTagAttrMap, htmlTagAttrValMap, htmlAttrFallbackMap } = buildLabelMaps();

  // Merge overrides with user-provided deprecated tags
  const tagOverrides = new Map(HTML_TAG_STATUS_OVERRIDES);
  if (options?.deprecatedTags && Array.isArray(options.deprecatedTags)) {
    for (const t of options.deprecatedTags) {
      const tag = String(t || "").trim().toLowerCase();
      if (tag) tagOverrides.set(tag, "deprecated");
    }
  }

  // Precompute line start offsets for mapping absolute offsets -> (line, column)
  const lineStartOffsets: number[] = [0];
  for (let i = 0; i < docText.length; i++) {
    if (docText.charCodeAt(i) === 10 /*\n*/) {
      lineStartOffsets.push(i + 1);
    }
  }
  const offsetToLineCol = (abs: number) => {
    // Find the greatest lineStart <= abs
    let lo = 0, hi = lineStartOffsets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = lineStartOffsets[mid];
      const next = mid + 1 < lineStartOffsets.length ? lineStartOffsets[mid + 1] : Number.MAX_SAFE_INTEGER;
      if (abs < start) hi = mid - 1;
      else if (abs >= next) lo = mid + 1;
      else return { line: mid, col: abs - start };
    }
    // Fallback to last line
    const last = lineStartOffsets.length - 1;
    return { line: last, col: Math.max(0, abs - lineStartOffsets[last]) };
  };
  const pushIfNonBaselineByAbs = (id: string, token: string, absStart: number, absEnd: number) => {
    const { line, col } = offsetToLineCol(absStart);
    const start = col;
    const end = col + Math.max(0, absEnd - absStart);
    const status = getStatusById(id);
    if (status === "not-baseline" || status === "deprecated") {
      issues.push({
        range: { line, start, end },
        featureId: id,
        status,
        message: `Feature "${token}" is ${status} in Baseline`,
      });
    }
  };

  // Tokenization heuristics
  // - For CSS: property names and at-rules
  // - For HTML: tag names and attributes
  const lines = docText.split(/\r?\n/);

  // If scanning HTML, also scan CSS inside <style> blocks
  if (languageId === "html") {
    const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = styleRegex.exec(docText))) {
      const full = sm[0];
      const cssText = sm[1] || "";
      const openTagEndRel = full.indexOf('>');
      if (openTagEndRel === -1) continue;
      const contentAbsStart = (sm.index || 0) + openTagEndRel + 1;
      // Scan cssText for properties and at-rules
      const cssLines = cssText.split(/\r?\n/);
      // Build line start offsets within cssText for absolute position mapping
      const cssLineStarts: number[] = [0];
      let cursor = 0;
      for (const l of cssLines.slice(0, -1)) {
        cursor += l.length + 1; // assume \n as splitter length (we split on \r?\n so 1 char for \n)
        cssLineStarts.push(cursor);
      }
      const propRegex = /(^|[\s{;])([a-zA-Z-]+)\s*:/g;
      const atRuleRegex = /@([a-zA-Z-]+)/g;
      for (let i = 0; i < cssLines.length; i++) {
        const lineText = cssLines[i];
        let m: RegExpExecArray | null;
        propRegex.lastIndex = 0;
        while ((m = propRegex.exec(lineText))) {
          const prop = (m[2] || "").toLowerCase();
          const id = cssMap.get(prop);
          if (id) {
            const localStart = m.index + (m[1] ? m[1].length : 0);
            const absStart = contentAbsStart + cssLineStarts[i] + localStart;
            const absEnd = absStart + prop.length;
            pushIfNonBaselineByAbs(id, prop, absStart, absEnd);
          }
        }
        atRuleRegex.lastIndex = 0;
        while ((m = atRuleRegex.exec(lineText))) {
          const ruleKey = ("@" + (m[1] || "")).toLowerCase();
          const id = cssMap.get(ruleKey);
          if (id) {
            const localStart = m.index + 1; // skip '@'
            const absStart = contentAbsStart + cssLineStarts[i] + localStart;
            const absEnd = absStart + (m[1] || "").length;
            pushIfNonBaselineByAbs(id, ruleKey, absStart, absEnd);
          }
        }
      }
    }
  }
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (languageId === "css" || languageId === "scss" || languageId === "less") {
      // CSS properties: match like `property-name:` or `@rule`
      const propRegex = /(^|[\s{;])([a-zA-Z-]+)\s*:/g;
      const atRuleRegex = /@([a-zA-Z-]+)/g;

      let m: RegExpExecArray | null;
      while ((m = propRegex.exec(line))) {
        const prop = m[2].toLowerCase();
        const id = cssMap.get(prop);
        if (id) pushIfNonBaseline(id, prop, lineIdx, m.index + m[1].length, m.index + m[1].length + prop.length);
      }
      while ((m = atRuleRegex.exec(line))) {
        const rule = ("@" + m[1]).toLowerCase();
        const id = cssMap.get(rule);
        if (id) pushIfNonBaseline(id, rule, lineIdx, m.index + 1, m.index + 1 + m[1].length);
      }
    } else if (languageId === "html") {
      // HTML tags and attributes with value-aware matching
      const tagRegex = /<\/?\s*([a-zA-Z0-9-:]+)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRegex.exec(line))) {
        const tag = tm[1].toLowerCase();
        // Tag-level feature (e.g., marquee, dialog)
        const tagId = htmlTagMap.get(tag);
        const nameStart = tm.index + tm[0].indexOf(tag);
        if (tagId) {
          pushIfNonBaseline(tagId, tag, lineIdx, nameStart, nameStart + tag.length);
        } else {
          // Not present in web-features: consult overrides
          const override = tagOverrides.get(tag);
          if (override && override !== 'baseline') {
            issues.push({
              range: { line: lineIdx, start: nameStart, end: nameStart + tag.length },
              featureId: `html.elements.${tag}`,
              status: override,
              message: `Feature "${tag}" is ${override} in Baseline`,
            });
          }
        }

        // Scope attribute parsing to this tag occurrence on the line
        const tagStart = tm.index;
        const gtIdx = line.indexOf('>', tagStart);
        const regionEnd = gtIdx === -1 ? line.length : gtIdx;
        const regionText = line.slice(tagStart, regionEnd);

        // Attributes with values: attr="value" | 'value' | value
        const attrValRegex = /([a-zA-Z-:]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let am: RegExpExecArray | null;
        while ((am = attrValRegex.exec(regionText))) {
          const attr = (am[1] || '').toLowerCase();
          const raw = am[3] ?? am[4] ?? am[5] ?? '';
          const value = raw.toLowerCase();
          const absoluteIdx = tagStart + am.index + am[0].indexOf(attr);

          // Match order: tag:attr:value -> tag:attr -> attr
          const idVal = htmlTagAttrValMap.get(`${tag}:${attr}:${value}`);
          if (idVal) {
            pushIfNonBaseline(idVal, `${tag}[${attr}="${value}"]`, lineIdx, absoluteIdx, absoluteIdx + attr.length);
            continue;
          }
          const idAttr = htmlTagAttrMap.get(`${tag}:${attr}`);
          if (idAttr) {
            pushIfNonBaseline(idAttr, `${tag}[${attr}]`, lineIdx, absoluteIdx, absoluteIdx + attr.length);
            continue;
          }
          const idFallback = htmlAttrFallbackMap.get(attr);
          if (idFallback) {
            pushIfNonBaseline(idFallback, `[${attr}]`, lineIdx, absoluteIdx, absoluteIdx + attr.length);
          }
        }

        // Boolean attributes (no '=') e.g., <dialog open>
        const tagNameMatch = /^<\/?\s*([a-zA-Z0-9-:]+)/.exec(regionText);
        const startAfterTag = tagNameMatch ? tagNameMatch[0].length : 0;
        const boolAttrRegex = /\s([a-zA-Z-:]+)(?!\s*=)(?=\s|$|>)/g;
        boolAttrRegex.lastIndex = startAfterTag;
        let bm: RegExpExecArray | null;
        while ((bm = boolAttrRegex.exec(regionText))) {
          const attr = (bm[1] || '').toLowerCase();
          const nameOffsetInMatch = bm[0].indexOf(attr);
          const absoluteIdx = tagStart + bm.index + nameOffsetInMatch;

          const idAttr = htmlTagAttrMap.get(`${tag}:${attr}`);
          if (idAttr) {
            pushIfNonBaseline(idAttr, `${tag}[${attr}]`, lineIdx, absoluteIdx, absoluteIdx + attr.length);
            continue;
          }
          const idFallback = htmlAttrFallbackMap.get(attr);
          if (idFallback) {
            pushIfNonBaseline(idFallback, `[${attr}]`, lineIdx, absoluteIdx, absoluteIdx + attr.length);
          }
        }
      }
    }
  }

  return { issues };

  function getStatusById(id: string): BaselineStatus {
    const f = (features as unknown as Record<string, WFFeature>)[id];
    if (!f) return "not-baseline";
    // Treat explicitly discouraged/deprecated features as deprecated regardless of Baseline coverage
    const s = f.status;
    const isDeprecated =
      !!(f as any).discouraged ||
      (s && (s.deprecated === true || /^(deprecated|obsolete)$/i.test(String(s.maturity || ""))));
    if (isDeprecated) return "deprecated";

    const baseline = s?.baseline;
    if (baseline === "high" || baseline === "low") return "baseline";
    if (baseline === false) return "not-baseline";
    // No baseline info -> treat as baseline (don't flag)
    return "baseline";
  }

  function pushIfNonBaseline(id: string, token: string, line: number, startIdx: number, endIdx: number) {
    const status = getStatusById(id);
    if (status === "not-baseline" || status === "deprecated") {
      issues.push({
        range: { line, start: startIdx, end: endIdx },
        featureId: id,
        status,
        message: `Feature "${token}" is ${status} in Baseline`,
      });
    }
  }
}
