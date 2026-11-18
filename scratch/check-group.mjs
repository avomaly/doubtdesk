import { createHash, randomBytes } from 'node:crypto';

const key = process.env.NEXCONN_APP_KEY;
const secret = process.env.NEXCONN_APP_SECRET;

async function call(path, payload) {
  const nonce = randomBytes(9).toString('hex');
  const timestamp = String(Date.now());
  const sig = createHash('sha1').update(secret + nonce + timestamp).digest('hex');
  const res = await fetch('https://api.sg-light-api.com' + path, {
    method: 'POST',
    headers: { 'App-Key': key, Nonce: nonce, Timestamp: timestamp, Signature: sig, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  console.log(path, res.status, data);
}

await call('/v4/group-channel/dismiss', { channelId: 'physics101' });
