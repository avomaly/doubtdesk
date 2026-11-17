import assert from 'node:assert/strict';
import { test } from 'node:test';

// Test metadata and message helpers
function metaOf(m) {
  const meta = m?.metadata;
  if (meta instanceof Map) return Object.fromEntries(meta);
  return meta && typeof meta === 'object' ? meta : {};
}

function textOf(m) {
  return m?.content?.text ?? m?.content?.content ?? (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
}

function mergeMessages(...pages) {
  const messages = new Map();
  pages.flat().forEach((message) => {
    if (message?.messageId) {
      messages.set(message.messageId, message);
    }
  });
  return [...messages.values()].sort((a, b) => {
    if (a.sentTime !== b.sentTime) return a.sentTime - b.sentTime;
    return a.messageId.localeCompare(b.messageId);
  });
}

test('metaOf handles JavaScript Map from Nexconn SDK message history', () => {
  const map = new Map([
    ['kind', 'doubt'],
    ['status', 'open'],
  ]);
  const message = { messageId: 'm1', metadata: map };
  const result = metaOf(message);
  assert.deepEqual(result, { kind: 'doubt', status: 'open' });
});

test('metaOf handles plain object metadata from live event updates', () => {
  const message = { messageId: 'm2', metadata: { kind: 'reply', replyTo: 'm1', author: 'ai' } };
  const result = metaOf(message);
  assert.deepEqual(result, { kind: 'reply', replyTo: 'm1', author: 'ai' });
});

test('metaOf handles missing or invalid metadata safely', () => {
  assert.deepEqual(metaOf(null), {});
  assert.deepEqual(metaOf({}), {});
  assert.deepEqual(metaOf({ metadata: null }), {});
  assert.deepEqual(metaOf({ metadata: 'invalid' }), {});
});

test('textOf extracts content text correctly across different payload formats', () => {
  assert.equal(textOf({ content: { text: 'Hello world' } }), 'Hello world');
  assert.equal(textOf({ content: { content: 'Fallback content' } }), 'Fallback content');
  assert.equal(textOf({ content: 'Direct string' }), 'Direct string');
  assert.equal(textOf(null), '""');
});

test('mergeMessages de-duplicates by messageId and orders strictly by sentTime', () => {
  const page1 = [
    { messageId: 'msg-3', sentTime: 300, content: { text: 'Third' } },
    { messageId: 'msg-1', sentTime: 100, content: { text: 'First' } },
  ];
  const page2 = [
    { messageId: 'msg-1', sentTime: 100, content: { text: 'First updated' } },
    { messageId: 'msg-2', sentTime: 200, content: { text: 'Second' } },
  ];

  const merged = mergeMessages(page1, page2);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].messageId, 'msg-1');
  assert.equal(merged[0].content.text, 'First updated'); // latest page overrides
  assert.equal(merged[1].messageId, 'msg-2');
  assert.equal(merged[2].messageId, 'msg-3');
});
