import assert from "node:assert/strict";
import { test } from "node:test";
import {
  externalizeInlineScripts,
  extractEmbeddedScripts,
  loadInlineScript,
  storeInlineScript,
} from "./inline-scripts.ts";

test("an inline script becomes a same-origin file that serves the same body", () => {
  const body = 'window.__NUXT__={};window.__NUXT__.config={public:{defaultNetwork:"testnet"}}';
  const html = externalizeInlineScripts(`<div></div><script>${body}</script>`);
  assert.doesNotMatch(html, /<script>/);
  const match = /<script src="\/_carbs\/inline\/([0-9a-f]{32}\.js)"><\/script>/.exec(html);
  assert.ok(match?.[1]);
  assert.equal(loadInlineScript(match[1]), body);
});

test("scripts with a src or a type are left alone", () => {
  const html =
    '<script type="module" src="/_nuxt/entry.js"></script><script type="application/json">{}</script>';
  assert.equal(externalizeInlineScripts(html), html);
});

test("the file name is derived from the body, so the same body gives the same file", () => {
  assert.equal(storeInlineScript("a=1"), storeInlineScript("a=1"));
  assert.notEqual(storeInlineScript("a=1"), storeInlineScript("a=2"));
});

test("only names produced by storeInlineScript are served", () => {
  assert.equal(loadInlineScript("../../etc/passwd"), undefined);
  assert.equal(loadInlineScript("00000000000000000000000000000000.js"), undefined);
});

test("prerender: the body travels with the page and is extracted into a file", () => {
  const body = "window.__NUXT__={}";
  const embedded = externalizeInlineScripts(`<script>${body}</script>`, true);
  assert.match(embedded, /data-carbs-body="/);
  const { html, files } = extractEmbeddedScripts(embedded);
  assert.doesNotMatch(html, /data-carbs-body/);
  assert.equal(files.length, 1);
  assert.equal(files[0].body, body);
  assert.ok(html.includes(`/_carbs/inline/${files[0].name}`));
});
