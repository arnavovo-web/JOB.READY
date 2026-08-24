import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Phase 2H regression test.
//
// ROOT CAUSE THIS GUARDS AGAINST: App.jsx has no build-time CSS pipeline (no Tailwind, no
// PostCSS, no external stylesheet) — its ONLY styling for utility classNames (flex, grid,
// grid-cols-*, items-*, justify-*, gap-*, mb-*/mt-*, the md: responsive variants,
// animate-spin) comes from the hand-written CSS inside the `TOKENS` template literal, injected
// via <style>{TOKENS}</style>. A real bug shipped here once already: a stray "*/" INSIDE a CSS
// comment's own text (not intended as the comment terminator) silently closed that comment
// early. The comment's remaining prose then became garbage "CSS" that a real browser's parser
// treats as an invalid rule and recovers from by skipping ahead to the next "}" — which, in
// this case, was the CLOSE of the very next real rule, `.flex{ display:flex; }`, so that whole
// rule silently vanished. No build error, no crash, nothing in vitest's default DOM-less
// environment would notice — the only visible symptom was the live page rendering with broken
// layout (icons stacked above text instead of beside it, card grids collapsed to one column,
// the "md:" responsive breakpoints never applying).
//
// parseTopLevelCssRules() below is a small, deliberately literal model of that browser
// behaviour (strip comments the same way a browser does — first "*/" wins, no nesting — then
// walk top-level statements, and on anything that isn't a recognisable "selector {" skip ahead
// to the next "}" the same way a browser's error recovery does) so this test fails the same way
// the real bug would have, not just on a superficial "is this substring present somewhere"
// check.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

function stripCssComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) { i = css.length; break; } // unterminated comment silently eats the rest
      i = end + 2;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

// A selector is "recognisable" here as exactly the character set TOKENS' own rules use:
// letters/digits/hyphen/underscore, ".", "#", ",", whitespace, and the "\:" escape. Anything
// else appearing before the next "{" (e.g. stray prose, punctuation from a broken comment)
// means this is not a real rule, mirroring a browser's own parse-error recovery.
const SELECTOR_RE = /^[.#a-zA-Z0-9_,:\\\s-]+$/;

// Walks a (comment-already-stripped) block of CSS text and returns every class name
// (".foo{" -> "foo") that appears as part of a well-formed top-level rule, recursing into
// @media blocks (the only nested construct TOKENS uses that matters for className lookups).
// Anything that doesn't parse as a recognisable rule causes a skip-to-next-"}" recovery, and
// classes "inside" that skipped span are NOT recorded — this is what makes the test able to
// reproduce the original bug rather than just re-describe it.
function parseTopLevelCssRules(css, definedOut) {
  let pos = 0;
  const len = css.length;
  while (pos < len) {
    while (pos < len && /\s/.test(css[pos])) pos++;
    if (pos >= len) break;

    if (css.startsWith("@import", pos)) {
      const semi = css.indexOf(";", pos);
      pos = semi === -1 ? len : semi + 1;
      continue;
    }
    if (css.startsWith("@media", pos) || css.startsWith("@keyframes", pos)) {
      const isMedia = css.startsWith("@media", pos);
      const openBrace = css.indexOf("{", pos);
      if (openBrace === -1) { pos = len; break; }
      // Find the matching closing brace (one level of nesting: header{ ...possibly-braced... }).
      let depth = 1, i = openBrace + 1;
      while (i < len && depth > 0) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
      const body = css.slice(openBrace + 1, i - 1);
      if (isMedia) parseTopLevelCssRules(body, definedOut); // @keyframes selectors (from/to/%) are irrelevant to className lookups
      pos = i;
      continue;
    }

    const nextBrace = css.indexOf("{", pos);
    const nextRecoveryBrace = css.indexOf("}", pos);
    if (nextBrace === -1) { pos = len; break; }
    const candidateSelector = css.slice(pos, nextBrace);
    if (SELECTOR_RE.test(candidateSelector)) {
      // Well-formed rule: record every ".class" simple selector, then skip its declaration body.
      const closeBrace = css.indexOf("}", nextBrace);
      const end = closeBrace === -1 ? len : closeBrace + 1;
      for (const part of candidateSelector.split(",")) {
        const m = part.trim().match(/^\.([a-zA-Z0-9_-]+(?:\\:[a-zA-Z0-9_-]+)?)/);
        if (m) definedOut.add(m[1].replace(/\\:/g, ":"));
      }
      pos = end;
    } else {
      // Not a recognisable selector (this is the error-recovery path) — skip to the next "}",
      // exactly like the real bug did, discarding whatever rule immediately followed too.
      pos = nextRecoveryBrace === -1 ? len : nextRecoveryBrace + 1;
    }
  }
}

function extractTokensCss(source) {
  const startMarker = "const TOKENS = `";
  const start = source.indexOf(startMarker);
  expect(start, "expected to find `const TOKENS = \\`` in App.jsx").toBeGreaterThan(-1);
  const contentStart = start + startMarker.length;
  const end = source.indexOf("`;", contentStart);
  expect(end, "expected a closing `; for the TOKENS template literal").toBeGreaterThan(-1);
  return source.slice(contentStart, end);
}

// Every literal className="..." string used anywhere in App.jsx (className={...} dynamic
// expressions are intentionally out of scope — the ones in this codebase resolve to a subset
// of these same literal strings, e.g. Card's hover ? "jr-card" : "").
function extractUsedClassNames(source) {
  const used = new Set();
  const re = /className="([^"]*)"/g;
  let m;
  while ((m = re.exec(source))) {
    for (const token of m[1].split(/\s+/)) if (token) used.add(token);
  }
  return used;
}

// className tokens that are intentionally never styled via TOKENS: LinkBtn's own hook class
// (all of its visual style is passed in via the `style` prop at each call site, same pattern as
// Btn/Card) is the one deliberate case — add to this list only with the same justification.
const INTENTIONALLY_UNSTYLED = new Set(["jr-linkbtn"]);

describe("App.jsx TOKENS CSS — utility classes actually used are actually defined", () => {
  const tokensCss = extractTokensCss(appSource);
  // TOKENS is a JS template literal, so what the browser actually receives at runtime has
  // already gone through JS escape-sequence resolution — in particular "\\:" (two backslash
  // characters, needed in the .jsx source to escape the colon in ".md\:grid-cols-2" for CSS)
  // resolves to a single literal backslash. fs.readFileSync gives us the raw, un-evaluated
  // source text, so mirror that one JS-string-literal transform before treating it as CSS.
  const runtimeCss = tokensCss.replace(/\\\\/g, "\\");
  const stripped = stripCssComments(runtimeCss);
  const defined = new Set();
  parseTopLevelCssRules(stripped, defined);
  const used = extractUsedClassNames(appSource);

  it("found a non-trivial set of both used and defined classes (sanity check on the extraction itself)", () => {
    expect(used.size).toBeGreaterThan(20);
    expect(defined.size).toBeGreaterThan(20);
  });

  it("defines a real, browser-parseable CSS rule for every utility className referenced in the app", () => {
    const missing = [...used].filter((c) => !INTENTIONALLY_UNSTYLED.has(c) && !defined.has(c)).sort();
    expect(missing).toEqual([]);
  });

  it("defines the md: responsive variants inside an @media (min-width) block", () => {
    const mdClasses = [...used].filter((c) => c.startsWith("md:"));
    expect(mdClasses.length).toBeGreaterThan(0);
    for (const c of mdClasses) expect(defined.has(c), `expected ${c} to be defined (inside @media)`).toBe(true);
  });
});
