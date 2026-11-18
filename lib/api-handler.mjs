import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FALLBACK_MODEL = 'gemini-3.6-flash';
const NEXCONN_HOSTS = ['https://api.sg-light-api.com', 'https://api-b.sg-light-api.com'];
const MAX_QUESTION_LENGTH = 2000;
const ANSWER_WORD_LIMIT = 110;
const ANSWER_NOTE = 'Check with a senior or your teacher.';
const AI_TOTAL_TIMEOUT_MS = 16000;
const AI_PRIMARY_TIMEOUT_MS = 8000;
const rateLimits = new Map();

function getAppSecret() {
  return process.env.NEXCONN_APP_SECRET || '';
}

function getAppKey() {
  return process.env.NEXCONN_APP_KEY || process.env.VITE_NEXCONN_APP_KEY || '';
}

function getGeminiKey() {
  return process.env.GEMINI_API_KEY || '';
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
}

export function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  return trimmed.replace(/^(https:\/\/[^/:]+):443$/, '$1');
}

export function getRequestOwnOrigin(req) {
  const rawHost = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!rawHost || typeof rawHost !== 'string') return '';
  const host = rawHost.split(',')[0].trim().replace(/\/+$/, '');
  if (!host) return '';
  const cleanHost = host.replace(/^https?:\/\//i, '').replace(/:443$/, '');
  if (!cleanHost) return '';
  return normalizeOrigin(`https://${cleanHost}`);
}

export function getAllowedOrigins() {
  return new Set(
    (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean)
  );
}

export function originAllowed(origin, req) {
  if (!origin) return true;
  const cleanOrigin = normalizeOrigin(origin);
  if (!cleanOrigin) return false;

  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

  if (isProduction) {
    const ownOrigin = getRequestOwnOrigin(req);
    if (ownOrigin && cleanOrigin === ownOrigin) {
      return true;
    }
    const allowed = getAllowedOrigins();
    return allowed.has(cleanOrigin);
  }

  // Development / local test environment: allow localhost & loopback
  try {
    const url = new URL(cleanOrigin);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    ) {
      return true;
    }
  } catch {}

  // In non-production, also accept own host and listed CORS_ORIGIN
  const ownOrigin = getRequestOwnOrigin(req);
  if (ownOrigin && cleanOrigin === ownOrigin) {
    return true;
  }
  const allowed = getAllowedOrigins();
  return allowed.has(cleanOrigin);
}

export function corsHeaders(origin, req) {
  const cleanOrigin = normalizeOrigin(origin);
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (cleanOrigin && originAllowed(cleanOrigin, req)) {
    headers['Access-Control-Allow-Origin'] = cleanOrigin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}


function completeAnswer(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) return { text: '', retryable: true };
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    return {
      text: '',
      retryable: ['MAX_TOKENS', 'CONTINUATION'].includes(candidate.finishReason),
    };
  }

  const answer = (candidate.content?.parts ?? [])
    .filter((part) => part && part.thought !== true)
    .map((part) => part.text ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!answer || !/[.!?…]["'’”)\]}]*$/.test(answer)) {
    return { text: '', retryable: true };
  }

  const words = answer.split(/\s+/);
  if (words.length <= ANSWER_WORD_LIMIT) return { text: answer, retryable: false };

  const bounded = words.slice(0, ANSWER_WORD_LIMIT).join(' ');
  let sentenceEnd = -1;
  for (const match of bounded.matchAll(/[.!?…]["'’”)\]}]*(?=\s|$)/g)) {
    sentenceEnd = match.index + match[0].length;
  }
  return sentenceEnd < 0
    ? { text: '', retryable: true }
    : { text: bounded.slice(0, sentenceEnd).trim(), retryable: false };
}

function rateLimited(req, route, limit, identifier) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : req.socket?.remoteAddress || 'unknown';
  const key = `${route}:${identifier || ip}`;
  const now = Date.now();
  if (rateLimits.size > 1000) {
    for (const [limitedKey, entry] of rateLimits) {
      if (now - entry.start >= 60_000) rateLimits.delete(limitedKey);
    }
  }
  const entry = rateLimits.get(key);
  if (!entry || now - entry.start >= 60_000) {
    rateLimits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

async function readJson(req, maxBytes) {
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      const error = new Error('Request is too large');
      error.statusCode = 413;
      throw error;
    }
    try {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      const error = new Error('Bad JSON');
      error.statusCode = 400;
      throw error;
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) {
      req.resume();
      const error = new Error('Request is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Bad JSON');
    error.statusCode = 400;
    throw error;
  }
}

async function issueAccessToken(name) {
  const appKey = getAppKey();
  const appSecret = getAppSecret();
  if (!appKey || !appSecret) {
    throw new Error('Login service is not configured on the server');
  }
  const userId = `student${createHmac('sha256', appSecret)
    .update(name.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24)}`;
  const body = await callNexconnApi('/v4/auth/access-token/issue', { userId, name });
  const accessToken = body?.result?.accessToken;
  if (!accessToken) throw new Error('Nexconn did not return an access token');
  return { userId: body.result.userId || userId, accessToken };
}

async function callNexconnApi(path, payload) {
  const appKey = getAppKey();
  const appSecret = getAppSecret();
  if (!appKey || !appSecret) {
    throw new Error('Nexconn server APIs are not configured');
  }

  let lastError = null;
  for (const host of NEXCONN_HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
      try {
        const nonce = randomBytes(9).toString('hex');
        const timestamp = String(Date.now());
        const signature = createHash('sha1')
          .update(appSecret + nonce + timestamp)
          .digest('hex');
        const response = await fetch(`${host}${path}`, {
          method: 'POST',
          headers: {
            'App-Key': appKey,
            Nonce: nonce,
            Timestamp: timestamp,
            Signature: signature,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(attempt === 0 ? 6000 : 9000),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.code !== 0) {
          const message = body?.message || `Nexconn request failed (HTTP ${response.status}, code ${body?.code ?? 'unknown'})`;
          if (response.status < 500 && body?.code !== undefined) {
            throw new Error(message);
          }
          lastError = new Error(message);
          continue;
        }
        return body;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkOrTimeout =
          lastError.name === 'TimeoutError' ||
          lastError.name === 'AbortError' ||
          lastError instanceof TypeError;
        if (!isNetworkOrTimeout) {
          throw lastError;
        }
      }
    }
  }
  throw lastError || new Error('Nexconn server API is temporarily unavailable.');
}

export function createAppSession(userId) {
  const appSecret = getAppSecret();
  if (!appSecret) throw new Error('Server session signing not configured');
  const payload = Buffer.from(`${userId}:${Date.now() + 12 * 60 * 60 * 1000}`).toString('base64url');
  const signature = createHmac('sha256', appSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readAppSession(req) {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const [payload, signature] = authorization.slice(7).split('.');
  const appSecret = getAppSecret();
  if (!payload || !signature || !appSecret) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const [userId, expiry] = Buffer.from(payload, 'base64url').toString().split(':');
    if (!userId || !/^[A-Za-z0-9_]+$/.test(userId) || Number(expiry) <= Date.now()) return null;
    return { userId };
  } catch {
    return null;
  }
}

export async function handleApiRequest(req, res, routeOverride) {
  const origin = req.headers?.origin;
  const path = routeOverride || req.url?.split('?')[0];

  const send = (r, status, obj, orig = origin, request = req) => {
    r.writeHead(status, { ...corsHeaders(orig, request), 'Content-Type': 'application/json' });
    r.end(JSON.stringify(obj));
  };

  if (!originAllowed(origin, req)) {
    return send(res, 403, { error: 'The API rejected this origin. Check CORS_ORIGIN on the server.' }, origin, req);
  }
  if (path === '/api/health' && req.method === 'GET') {
    return send(res, 200, { ok: true }, origin);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin, req));
    return res.end();
  }
  if (req.method !== 'POST') {
    return send(res, 404, { error: 'Not found' }, origin);
  }
  if (path !== '/api/login' && path !== '/api/rooms/create' && path !== '/ask' && path !== '/api/ask') {
    return send(res, 404, { error: 'Not found' }, origin);
  }

  const isLogin = path === '/api/login';
  const isCreateRoom = path === '/api/rooms/create';
  const isAsk = path === '/ask' || path === '/api/ask';

  // Read Session for protected routes
  const session = readAppSession(req);
  if (!isLogin && !session) {
    return send(res, 401, { error: 'Sign in to DoubtDesk to continue.' }, origin);
  }

  if (isLogin && rateLimited(req, 'login', 10)) {
    return send(res, 429, { error: 'Too many sign-in attempts. Please try again in a minute.' }, origin);
  }
  if (isCreateRoom && (rateLimited(req, 'rooms', 10, session?.userId) || rateLimited(req, 'rooms', 15))) {
    return send(res, 429, { error: 'Too many rooms created. Please wait a minute.' }, origin);
  }
  if (isAsk && (rateLimited(req, 'ask', 20, session?.userId) || rateLimited(req, 'ask', 30))) {
    return send(res, 429, { error: 'Too many AI questions. Please wait a minute.' }, origin);
  }

  let payload;
  try {
    payload = await readJson(
      req,
      isLogin ? 2048 : isCreateRoom ? 4096 : MAX_QUESTION_LENGTH * 4 + 1024,
    );
  } catch (e) {
    return send(res, e.statusCode || 400, { error: e.message }, origin);
  }

  if (isLogin) {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const hasControlChars = [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    if (!name || name.length > 40 || hasControlChars) {
      return send(res, 400, { error: 'Enter a display name of 1–40 characters.' }, origin);
    }
    try {
      const account = await issueAccessToken(name);
      return send(res, 200, {
        ...account,
        sessionToken: createAppSession(account.userId),
      }, origin);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Nexconn login failed:', message);
      return send(res, 502, { error: message }, origin);
    }
  }

  if (isCreateRoom) {
    const channelId = typeof payload?.channelId === 'string' ? payload.channelId.trim() : '';
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const invitees = payload?.invitees;
    if (
      !/^[A-Za-z0-9]{1,64}$/.test(channelId) ||
      !name ||
      name.length > 64 ||
      !Array.isArray(invitees) ||
      invitees.length > 30 ||
      !invitees.every((id) => typeof id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(id))
    ) {
      return send(res, 400, { error: 'Room details or invitee IDs are invalid.' }, origin);
    }
    try {
      await callNexconnApi('/v4/group-channel/create', {
        channelId,
        name,
        owner: session.userId,
        userIds: [...new Set(invitees)],
        permissions: { joinPerm: 1 },
      });
      return send(res, 200, { channelId }, origin);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('25409') || message.includes('ALREADY_EXIST')) {
        // Group channel already exists in Nexconn; allow creator/member to enter
        return send(res, 200, { channelId, alreadyExisted: true }, origin);
      }
      console.error('Nexconn room creation failed:', message);
      return send(res, 502, { error: message }, origin);
    }
  }

  // Handle /ask and /api/ask
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  if (!question) return send(res, 400, { error: 'Empty question' }, origin);
  if (question.length > MAX_QUESTION_LENGTH) {
    return send(res, 400, { error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer` }, origin);
  }
  const key = getGeminiKey();
  if (!key) {
    return send(res, 503, { error: 'AI answers are not configured on the server.' }, origin);
  }

  const prompt =
    "You are DoubtDesk's AI helper for college students. Give a clear, correct first answer " +
    'in under 90 words using complete sentences. Plain text, no markdown. If the question is ' +
    'ambiguous, state your assumption. End with a complete sentence.\n\nQuestion: ' +
    question;

  try {
    const primaryModel = getGeminiModel();
    const models = primaryModel === FALLBACK_MODEL ? [primaryModel] : [primaryModel, FALLBACK_MODEL];
    const deadline = Date.now() + AI_TOTAL_TIMEOUT_MS;

    for (const [index, model] of models.entries()) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return send(res, 504, { error: 'Gemini request timed out' }, origin);
      }
      if (index > 0) {
        // Backoff delay before fallback model
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const timeoutMs = Math.min(
        remainingMs,
        index === 0 && models.length > 1 ? AI_PRIMARY_TIMEOUT_MS : remainingMs,
      );
      let r;
      try {
        r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 300 },
            }),
          }
        );
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        const networkError = e instanceof TypeError;
        if ((timedOut || networkError) && model !== FALLBACK_MODEL) {
          console.warn(`Gemini ${model} request failed; retrying with ${FALLBACK_MODEL}`);
          continue;
        }
        throw e;
      }

      const data = await r.json().catch(() => null);
      if (!r.ok) {
        if ([429, 500, 502, 503, 504].includes(r.status) && model !== FALLBACK_MODEL) {
          console.warn(`Gemini ${model} returned ${r.status}; retrying with ${FALLBACK_MODEL}`);
          continue;
        }
        console.error('Gemini error:', JSON.stringify(data));
        // Gracefully handle 429, 503, and quota/capacity exhaustion
        if (
          r.status === 429 ||
          r.status === 503 ||
          r.status === 504 ||
          data?.error?.status === 'RESOURCE_EXHAUSTED' ||
          data?.error?.status === 'UNAVAILABLE' ||
          data?.error?.message?.toLowerCase().includes('quota') ||
          data?.error?.message?.toLowerCase().includes('demand')
        ) {
          return send(res, 200, {
            answer: `The AI helper is temporarily at capacity. Ask your classmates or seniors in this room!\n\n${ANSWER_NOTE}`,
          }, origin);
        }
        return send(res, 502, { error: data?.error?.message ?? 'Gemini error' }, origin);
      }

      const result = completeAnswer(data);
      if (!result.text) {
        if (result.retryable && model !== FALLBACK_MODEL) {
          console.warn(`Gemini ${model} returned an incomplete answer; retrying with ${FALLBACK_MODEL}`);
          continue;
        }
        return send(res, 502, { error: 'Gemini did not return a complete answer. Please retry or ask a senior.' }, origin);
      }
      return send(res, 200, { answer: `${result.text}\n\n${ANSWER_NOTE}` }, origin);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('AI request failed:', message);
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    send(res, timedOut ? 504 : 502, { error: timedOut ? 'Gemini request timed out' : message }, origin);
  }
}
