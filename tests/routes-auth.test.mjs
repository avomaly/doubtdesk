import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

process.env.NEXCONN_APP_KEY = 'test-key';
process.env.NEXCONN_APP_SECRET = 'test-secret-1234567890';
const { handleApiRequest, createAppSession } = await import('../lib/api-handler.mjs');

function mockReq(method, path, body, headers = {}) {
  const req = Readable.from(body ? [typeof body === 'string' ? body : JSON.stringify(body)] : []);
  req.method = method;
  req.url = path;
  req.headers = { ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

async function request(method, path, body, headers = {}) {
  const result = { status: 0, headers: {}, body: '' };
  const res = {
    writeHead(status, hdrs) {
      result.status = status;
      result.headers = hdrs || {};
    },
    end(data) {
      if (data) result.body = data;
    },
  };
  await handleApiRequest(mockReq(method, path, body, headers), res);
  return {
    status: result.status,
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

test('GET /api/health returns 200 { ok: true }', async () => {
  const { status, body } = await request('GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});

test('POST /api/login rejects empty or control character display names', async () => {
  const r1 = await request('POST', '/api/login', { name: '' });
  assert.equal(r1.status, 400);

  const r2 = await request('POST', '/api/login', { name: '   ' });
  assert.equal(r2.status, 400);

  const r3 = await request('POST', '/api/login', { name: 'Alex\x00Hacker' });
  assert.equal(r3.status, 400);

  const r4 = await request('POST', '/api/login', { name: 'A'.repeat(45) });
  assert.equal(r4.status, 400);
});

test('POST /api/rooms/create rejects unauthenticated requests with 401', async () => {
  const { status, body } = await request('POST', '/api/rooms/create', {
    channelId: 'physics101',
    name: 'Physics 101',
    invitees: [],
  });
  assert.equal(status, 401);
  assert.match(body.error, /Sign in/i);
});

test('POST /api/rooms/create validates room channel ID and invitee limits', async () => {
  const validToken = createAppSession('student_tester');
  const headers = { authorization: `Bearer ${validToken}` };

  const r1 = await request('POST', '/api/rooms/create', {
    channelId: 'invalid channel with spaces!',
    name: 'Physics 101',
    invitees: [],
  }, headers);
  assert.equal(r1.status, 400);

  const r2 = await request('POST', '/api/rooms/create', {
    channelId: 'valid101',
    name: '',
    invitees: [],
  }, headers);
  assert.equal(r2.status, 400);

  const r3 = await request('POST', '/api/rooms/create', {
    channelId: 'valid101',
    name: 'Physics',
    invitees: Array.from({ length: 35 }, (_, i) => `student${i}`),
  }, headers);
  assert.equal(r3.status, 400);
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const result = { status: 0, headers: {}, ended: false };
  const res = {
    writeHead(status, hdrs) {
      result.status = status;
      result.headers = hdrs;
    },
    end() {
      result.ended = true;
    },
  };
  await handleApiRequest(mockReq('OPTIONS', '/api/login', null, { origin: 'http://localhost:5173' }), res);
  assert.equal(result.status, 204);
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

function restoreEnv(prev) {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test('production CORS: same-origin accepted when Origin matches own host', async () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };
  process.env.NODE_ENV = 'production';
  delete process.env.CORS_ORIGIN;
  try {
    // 1. Matches via Host header
    const r1 = await request('GET', '/api/health', null, {
      origin: 'https://doubtdesk-silk.vercel.app',
      host: 'doubtdesk-silk.vercel.app',
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.headers['Access-Control-Allow-Origin'], 'https://doubtdesk-silk.vercel.app');

    // 2. Matches via x-forwarded-host header
    const r2 = await request('GET', '/api/health', null, {
      origin: 'https://doubtdesk-silk.vercel.app',
      'x-forwarded-host': 'doubtdesk-silk.vercel.app',
      host: 'internal.proxy.local',
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers['Access-Control-Allow-Origin'], 'https://doubtdesk-silk.vercel.app');

    // 3. Trailing slash on request origin is trimmed and matches
    const r3 = await request('GET', '/api/health', null, {
      origin: '  https://doubtdesk-silk.vercel.app/  ',
      'x-forwarded-host': 'doubtdesk-silk.vercel.app/',
    });
    assert.equal(r3.status, 200);
    assert.equal(r3.headers['Access-Control-Allow-Origin'], 'https://doubtdesk-silk.vercel.app');
  } finally {
    restoreEnv(prev);
  }
});

test('production CORS: listed origin accepted', async () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = 'https://partner-portal.com, https://another-portal.com';
  try {
    const r = await request('GET', '/api/health', null, {
      origin: 'https://partner-portal.com',
      host: 'doubtdesk-silk.vercel.app',
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://partner-portal.com');
  } finally {
    restoreEnv(prev);
  }
});

test('production CORS: trailing-slash config still works', async () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = ' https://partner-portal.com/ , https://another-portal.com/// ';
  try {
    // Exact match with configured entry that had trailing slash
    const r1 = await request('GET', '/api/health', null, {
      origin: 'https://partner-portal.com',
      host: 'doubtdesk-silk.vercel.app',
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.headers['Access-Control-Allow-Origin'], 'https://partner-portal.com');

    // Request origin that also has trailing slash
    const r2 = await request('GET', '/api/health', null, {
      origin: 'https://another-portal.com/',
      host: 'doubtdesk-silk.vercel.app',
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers['Access-Control-Allow-Origin'], 'https://another-portal.com');
  } finally {
    restoreEnv(prev);
  }
});

test('production CORS: unknown origin rejected (403 with a clear message)', async () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = 'https://trusted-site.com';
  try {
    const r = await request('POST', '/api/login', { name: 'Alice' }, {
      origin: 'https://untrusted-attacker.com',
      host: 'doubtdesk-silk.vercel.app',
    });
    assert.equal(r.status, 403);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    assert.match(r.body.error, /The API rejected this origin\. Check CORS_ORIGIN/i);

    // Also verify preflight OPTIONS from unknown origin is rejected with 403
    const result = { status: 0, headers: {}, body: '' };
    const res = {
      writeHead(status, hdrs) {
        result.status = status;
        result.headers = hdrs;
      },
      end(data) {
        if (data) result.body = data;
      },
    };
    await handleApiRequest(
      mockReq('OPTIONS', '/api/login', null, {
        origin: 'https://untrusted-attacker.com',
        host: 'doubtdesk-silk.vercel.app',
      }),
      res
    );
    assert.equal(result.status, 403);
    const parsed = JSON.parse(result.body);
    assert.match(parsed.error, /The API rejected this origin\. Check CORS_ORIGIN/i);
  } finally {
    restoreEnv(prev);
  }
});
