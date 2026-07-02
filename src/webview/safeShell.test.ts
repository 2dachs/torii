import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeShellHtml } from './safeShell';

test('safe shell shows only the manual startup affordance', () => {
  const html = buildSafeShellHtml();

  assert.match(html, /Toriiを起動/);
  assert.match(html, /bootTorii/);
  assert.doesNotMatch(html, /dist\/webview/);
  assert.doesNotMatch(html, /index\.html/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
});

test('safe shell escapes dynamic status and error text', () => {
  const html = buildSafeShellHtml({
    status: '<script>alert("status")</script>',
    error: '<img src=x onerror=alert("error")>',
  });

  assert.match(html, /&lt;script&gt;alert\(&quot;status&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(&quot;error&quot;\)&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
});
