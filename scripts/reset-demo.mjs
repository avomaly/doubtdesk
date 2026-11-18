import { createHash, randomBytes } from 'node:crypto';

const key = process.env.NEXCONN_APP_KEY;
const secret = process.env.NEXCONN_APP_SECRET;

const rooms = ['physics101', 'chemistry101', 'calculus101'];

async function dismiss(channelId) {
  const nonce = randomBytes(9).toString('hex');
  const timestamp = String(Date.now());
  const sig = createHash('sha1').update(secret + nonce + timestamp).digest('hex');
  const res = await fetch('https://api.sg-light-api.com/v4/group-channel/dismiss', {
    method: 'POST',
    headers: { 'App-Key': key, Nonce: nonce, Timestamp: timestamp, Signature: sig, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  const data = await res.json().catch(() => null);
  console.log(`Dismissed ${channelId}:`, res.status, data);
}

for (const r of rooms) {
  await dismiss(r);
}
console.log('Reset complete: all demo rooms dismissed.');
