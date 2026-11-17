import { BaseChannel, GroupChannel, SendTextMessageParams } from '@nexconn/chat';

export type RoomMessage = {
  messageId: string;
  sentTime: number;
  senderUserId: string;
  content?: { text?: string; content?: string };
  metadata?: Map<string, string> | Record<string, string>;
  setMetadata: (metadata: Record<string, string>) => Promise<{ code: number }>;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function postAPI(path: string, payload: Record<string, unknown>, sessionToken?: string) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? "Can't reach the DoubtDesk API. Start everything with `npm run dev:all`."
        : "Can't reach the DoubtDesk API. Check your connection and try again.",
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const apiMessage =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    const message =
      res.status === 401
        ? 'Your sign-in expired. Sign in again and retry.'
        : res.status === 403
          ? 'The API rejected this origin. Check CORS_ORIGIN on the server.'
          : res.status === 429
            ? 'Too many requests. Wait a minute and try again.'
            : path === '/api/rooms/create'
              ? `Could not create the room: ${apiMessage}. Check that the room code is unused.`
              : path === '/api/login' && apiMessage.includes('not configured')
                ? 'Login service is temporarily unconfigured. Please contact support.'
                : apiMessage;
    throw new Error(message);
  }
  return body;
}

export async function checkAPI(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function loginUser(
  name: string,
): Promise<{ userId: string; accessToken: string; sessionToken: string }> {
  const body = await postAPI('/api/login', { name });
  if (
    !body ||
    typeof body !== 'object' ||
    !('userId' in body) ||
    typeof body.userId !== 'string' ||
    !('accessToken' in body) ||
    typeof body.accessToken !== 'string' ||
    !('sessionToken' in body) ||
    typeof body.sessionToken !== 'string'
  ) {
    throw new Error('Login response was incomplete');
  }
  return { userId: body.userId, accessToken: body.accessToken, sessionToken: body.sessionToken };
}

export async function createRoom(
  channelId: string,
  name: string,
  invitees: string[],
  sessionToken: string,
) {
  await postAPI('/api/rooms/create', { channelId, name, invitees }, sessionToken);
}

export async function joinRoom(groupId: string) {
  const { code } = await new GroupChannel(groupId).join();
  if (code === 0 || code === 25412) return; // 0 = joined, 25412 = already a member
  if (code === 25414) {
    throw new Error('This room requires an invite from the owner and does not allow open joining.');
  }
  if (code === 25410) {
    throw new Error('Room code not found. Check the code and try again.');
  }
  if (code === 25411) {
    throw new Error('This room has reached the maximum capacity of 300 members.');
  }
  throw new Error(`Could not join room (Code: ${code}).`);
}

export async function fetchRoomMessages(
  groupId: string,
  startTime = 0,
): Promise<RoomMessage[]> {
  const channel = new GroupChannel(groupId);
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: channel.identifier,
    startTime,
    pageSize: 50,
    isAscending: false,
  });
  const { code, data } = await query.loadNextPage();
  if (code === 22406) {
    throw new Error('You are not a member of this room. Ask for an invitation or join with a room code.');
  }
  if (code !== 0) throw new Error(`Could not load room history (Code: ${code}).`);
  const list: RoomMessage[] = Array.isArray(data)
    ? (data as RoomMessage[])
    : ((data as { data?: RoomMessage[] })?.data ?? []);
  return [...list].reverse(); // oldest first
}

// Client rate limiter: maximum 5 messages per second across all channels
let lastSendTimestamps: number[] = [];
async function throttleSend() {
  const now = Date.now();
  lastSendTimestamps = lastSendTimestamps.filter((t) => now - t < 1000);
  if (lastSendTimestamps.length >= 5) {
    const oldest = lastSendTimestamps[0];
    const waitMs = Math.max(50, 1000 - (now - oldest) + 50);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastSendTimestamps.push(Date.now());
}

async function sendTagged(groupId: string, text: string, meta: Record<string, string>) {
  await throttleSend();
  const { code, data } = await new GroupChannel(groupId).sendMessage(
    new SendTextMessageParams({ text })
  );
  if (code !== 0 || !data) {
    if (code === 22406) throw new Error('You are not a member of this room. Please join first.');
    if (code === 30001 || code === 30002) throw new Error('Connection paused. Reconnecting to chat...');
    throw new Error(`Send failed (Code: ${code})`);
  }
  const message = data as RoomMessage;
  const res = await message.setMetadata(meta);
  if (res.code !== 0) {
    console.warn(`Tagging failed with code ${res.code}, message sent.`);
  }
  return message;
}

export const postDoubt = (groupId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'doubt', status: 'open' });

export const postReply = (groupId: string, doubtId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'reply', replyTo: doubtId });

export const postAIReply = (groupId: string, doubtId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'reply', replyTo: doubtId, author: 'ai' });

export async function askAI(question: string, sessionToken?: string): Promise<string> {
  const body = await postAPI('/api/ask', { question }, sessionToken);
  if (!body || typeof body !== 'object' || !('answer' in body) || typeof body.answer !== 'string') {
    throw new Error('AI response was incomplete');
  }
  return body.answer as string;
}

export async function markSolved(message: RoomMessage) {
  const res = await message.setMetadata({ status: 'solved' });
  if (res.code !== 0) throw new Error(`Could not mark doubt as solved (Code: ${res.code})`);
}

export const textOf = (m: RoomMessage): string =>
  m?.content?.text ?? m?.content?.content ?? (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));

export const metaOf = (m: RoomMessage): Record<string, string> => {
  const meta = m?.metadata;
  if (meta instanceof Map) return Object.fromEntries(meta);
  return meta && typeof meta === 'object' ? meta : {};
};
