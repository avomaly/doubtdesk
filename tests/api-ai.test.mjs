import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

process.env.GEMINI_API_KEY = 'test-key';
process.env.NEXCONN_APP_SECRET = 'test-app-secret-1234567890';
const { handleApiRequest, createAppSession } = await import('../lib/api-handler.mjs');

const validSession = createAppSession('student12345');

function createRequest(question, ip, authHeader = `Bearer ${validSession}`) {
  const req = Readable.from([JSON.stringify({ question })]);
  req.method = 'POST';
  req.url = '/api/ask';
  req.headers = authHeader ? { authorization: authHeader } : {};
  req.socket = { remoteAddress: ip };
  return req;
}

async function ask(question, ip, authHeader = `Bearer ${validSession}`) {
  const result = { status: 0, body: '' };
  const res = {
    writeHead(status) {
      result.status = status;
    },
    end(body) {
      result.body = body;
    },
  };
  await handleApiRequest(createRequest(question, ip, authHeader), res);
  return { status: result.status, body: JSON.parse(result.body) };
}

function geminiResponse(text, finishReason = 'STOP') {
  return {
    candidates: [{
      finishReason,
      content: { parts: [{ text }] },
    }],
  };
}

test('rejects unauthenticated requests to /api/ask with 401', async () => {
  const { status, body } = await ask('What is gravity?', '127.0.0.1', '');
  assert.equal(status, 401);
  assert.match(body.error, /Sign in/i);
});

test('rejects forged or expired session tokens on /api/ask with 401', async () => {
  const { status, body } = await ask('What is gravity?', '127.0.0.1', 'Bearer invalid.token.payload');
  assert.equal(status, 401);
  assert.match(body.error, /Sign in/i);
});

test('retries a truncated Gemini answer and returns only a complete answer', async () => {
  const originalFetch = globalThis.fetch;
  const models = [];
  const responses = [
    geminiResponse('A ball slows down because gravity pulls it', 'MAX_TOKENS'),
    geminiResponse('Gravity pulls downward against the ball’s upward motion, reducing its speed until it reaches the top.'),
  ];
  globalThis.fetch = async (url) => {
    models.push(new URL(url).pathname.match(/models\/([^:]+)/)?.[1]);
    return { ok: true, status: 200, json: async () => responses.shift() };
  };

  try {
    const { status, body } = await ask('Why does a ball thrown upward slow down?', '127.0.0.11');
    assert.equal(status, 200);
    assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    assert.match(body.answer, /reaches the top\.\n\nCheck with a senior or your teacher\.$/);
    assert.doesNotMatch(body.answer, /A ball slows down because gravity pulls it/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a Gemini continuation response instead of returning partial text', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    geminiResponse('The ball slows down because gravity', 'CONTINUATION'),
    geminiResponse('Gravity pulls downward against the ball’s upward motion.'),
  ];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responses.shift(),
  });

  try {
    const { status, body } = await ask('Why does a ball thrown upward slow down?', '127.0.0.15');
    assert.equal(status, 200);
    assert.match(body.answer, /Gravity pulls downward against the ball’s upward motion\./);
    assert.doesNotMatch(body.answer, /The ball slows down because gravity/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not return an answer when both models produce incomplete text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => geminiResponse('It slows down because gravity pulls'),
  });

  try {
    const { status, body } = await ask('Why does a ball thrown upward slow down?', '127.0.0.12');
    assert.equal(status, 502);
    assert.match(body.error, /complete answer/);
    assert.equal('answer' in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries the fallback model after a primary timeout', async () => {
  const originalFetch = globalThis.fetch;
  const models = [];
  globalThis.fetch = async (url) => {
    const model = new URL(url).pathname.match(/models\/([^:]+)/)?.[1];
    models.push(model);
    if (model === 'gemini-3.5-flash-lite') {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }
    return {
      ok: true,
      status: 200,
      json: async () => geminiResponse('Gravity pulls downward against the ball’s upward motion.'),
    };
  };

  try {
    const { status, body } = await ask('Why does a ball thrown upward slow down?', '127.0.0.14');
    assert.equal(status, 200);
    assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    assert.match(body.answer, /Gravity pulls downward/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps long answers within the word cap without cutting a sentence', async () => {
  const originalFetch = globalThis.fetch;
  const firstSentence = `${Array.from({ length: 55 }, (_, index) => `word${index}`).join(' ')}.`;
  const secondSentence = `${Array.from({ length: 60 }, (_, index) => `extra${index}`).join(' ')}.`;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => geminiResponse(`${firstSentence} ${secondSentence}`),
  });

  try {
    const { status, body } = await ask('Explain a physics concept.', '127.0.0.13');
    const answer = body.answer.split('\n\n')[0];
    assert.equal(status, 200);
    assert.ok(answer.split(/\s+/).length <= 110);
    assert.equal(answer, firstSentence);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gracefully handles 429 quota exhaustion with student-friendly fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'Resource has been exhausted (quota exceeded)', status: 'RESOURCE_EXHAUSTED' } }),
  });

  try {
    const { status, body } = await ask('Explain wave-particle duality.', '127.0.0.99');
    assert.equal(status, 200);
    assert.match(body.answer, /temporarily at capacity.*senior/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
