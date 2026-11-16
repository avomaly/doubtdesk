import { BaseChannel, GroupChannel, SendTextMessageParams } from '@nexconn/chat';

export type RoomMessage = {
  messageId: string;
  sentTime: number;
  senderUserId: string;
  content?: { text?: string; content?: string };
  metadata?: Map<string, string> | Record<string, string>;
  setMetadata: (metadata: Record<string, string>) => Promise<{ code: number }>;
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');

async function postAPI(path: string, payload: Record<string, unknown>, sessionToken?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
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
  if (code !== 0) throw new Error(`Join failed. Code: ${code}`);
}

export async function fetchRoomMessages(
  groupId: string,
  startTime = Date.now(),
): Promise<RoomMessage[]> {
  const channel = new GroupChannel(groupId);
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: channel.identifier,
    startTime,
    pageSize: 50,
    isAscending: false,
  });
  const { code, data } = await query.loadNextPage();
  if (code !== 0) throw new Error(`Load messages failed. Code: ${code}`);
  const list: RoomMessage[] = Array.isArray(data)
    ? data as RoomMessage[]
    : (data as { data?: RoomMessage[] })?.data ?? [];
  return [...list].reverse(); // oldest first
}

async function sendTagged(groupId: string, text: string, meta: Record<string, string>) {
  const { code, data } = await new GroupChannel(groupId).sendMessage(
    new SendTextMessageParams({ text })
  );
  if (code !== 0 || !data) throw new Error(`Send failed. Code: ${code}`);
  const message = data as RoomMessage;
  const res = await message.setMetadata(meta);
  if (res.code !== 0) throw new Error(`Tagging failed. Code: ${res.code}`);
  return message;
}

export const postDoubt = (groupId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'doubt', status: 'open' });

export const postReply = (groupId: string, doubtId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'reply', replyTo: doubtId });

export const postAIReply = (groupId: string, doubtId: string, text: string): Promise<RoomMessage> =>
  sendTagged(groupId, text, { kind: 'reply', replyTo: doubtId, author: 'ai' });

export async function askAI(question: string): Promise<string> {
  const body = await postAPI('/api/ask', { question });
  if (!body || typeof body !== 'object' || !('answer' in body) || typeof body.answer !== 'string') {
    throw new Error('AI response was incomplete');
  }
  return body.answer as string;
}

export async function markSolved(message: RoomMessage) {
  const res = await message.setMetadata({ status: 'solved' });
  if (res.code !== 0) throw new Error(`Update failed. Code: ${res.code}`);
}

export const textOf = (m: RoomMessage): string =>
  m?.content?.text ?? m?.content?.content ?? JSON.stringify(m?.content ?? '');

export const metaOf = (m: RoomMessage): Record<string, string> => {
  const meta = m?.metadata;
  if (meta instanceof Map) return Object.fromEntries(meta);
  return meta && typeof meta === 'object' ? meta : {};
};