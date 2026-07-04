import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviewUrlTarget,
  isLocalPreviewUrl,
  normalizePreviewUrl,
} from './agentWindowPreview';

test('normalizePreviewUrl expands bare ports and localhost hosts', () => {
  assert.equal(normalizePreviewUrl('3000'), 'http://localhost:3000/');
  assert.equal(normalizePreviewUrl('localhost:5173'), 'http://localhost:5173/');
  assert.equal(normalizePreviewUrl('127.0.0.1:8080/path'), 'http://127.0.0.1:8080/path');
});

test('normalizePreviewUrl preserves explicit http and https URLs', () => {
  assert.equal(normalizePreviewUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(normalizePreviewUrl('https://example.com/docs'), 'https://example.com/docs');
});

test('normalizePreviewUrl rejects unsupported or malformed inputs', () => {
  assert.equal(normalizePreviewUrl(''), null);
  assert.equal(normalizePreviewUrl('nota url'), null);
  assert.equal(normalizePreviewUrl('file:///tmp/index.html'), null);
  assert.equal(normalizePreviewUrl('javascript:alert(1)'), null);
});

test('isLocalPreviewUrl only allows loopback HTTP URLs for iframe preview', () => {
  assert.equal(isLocalPreviewUrl('http://localhost:3000/'), true);
  assert.equal(isLocalPreviewUrl('https://127.0.0.1:8443/'), true);
  assert.equal(isLocalPreviewUrl('http://[::1]:5173/'), true);
  assert.equal(isLocalPreviewUrl('https://example.com/'), false);
  assert.equal(isLocalPreviewUrl('http://192.168.1.20:3000/'), false);
});

test('getPreviewUrlTarget routes local URLs to iframe and external URLs to Simple Browser', () => {
  assert.deepEqual(getPreviewUrlTarget('5173'), {
    kind: 'iframe',
    url: 'http://localhost:5173/',
  });
  assert.deepEqual(getPreviewUrlTarget('https://example.com'), {
    kind: 'simpleBrowser',
    url: 'https://example.com/',
  });
  assert.deepEqual(getPreviewUrlTarget('ftp://example.com'), {
    kind: 'invalid',
    url: null,
  });
});
