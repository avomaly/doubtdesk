import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { connectUser, onActivity } from './nexconn';
import {
  loginUser, createRoom, joinRoom, fetchRoomMessages, postDoubt, postReply,
  postAIReply, askAI, markSolved, textOf, metaOf,
  type RoomMessage,
} from './chat';

type RoomEntry = { id: string; name: string };

const PRESET_ROOMS: RoomEntry[] = [
  { id: 'physics26', name: 'Physics 101' },
  { id: 'chemistry26', name: 'Chemistry 101' },
  { id: 'calculus26', name: 'Calculus 101' },
];

function readRooms(): RoomEntry[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem('doubtdesk.rooms') ?? '[]');
    return Array.isArray(stored)
      ? stored.filter(
          (room): room is RoomEntry =>
            room &&
            typeof room.id === 'string' &&
            typeof room.name === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function roomCodeFrom(value: string) {
  const input = value.trim();
  try {
    const url = new URL(input);
    return url.searchParams.get('room')?.trim() ?? '';
  } catch {
    return input;
  }
}

function formatTime(sentTime: number) {
  const date = new Date(sentTime);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function mergeMessages(...pages: RoomMessage[][]) {
  const messages = new Map<string, RoomMessage>();
  pages.flat().forEach((message) => messages.set(message.messageId, message));
  return [...messages.values()].sort((left, right) => left.sentTime - right.sentTime);
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => localStorage.getItem('doubtdesk.theme') === 'dark' ? 'dark' : 'light',
  );
  const [displayName, setDisplayName] = useState(
    () => sessionStorage.getItem('doubtdesk.name') ?? '',
  );
  const [authenticating, setAuthenticating] = useState(false);
  const [me, setMe] = useState('');
  const [apiSession, setApiSession] = useState('');
  const [status, setStatus] = useState('Not connected');
  const [aiStatus, setAiStatus] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomName, setRoomName] = useState('');
  const [invitees, setInvitees] = useState('');
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(window.location.search).get('room') ?? '',
  );
  const [rooms, setRooms] = useState<RoomEntry[]>(readRooms);
  const [room, setRoom] = useState('');
  const [msgs, setMsgs] = useState<RoomMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [sending, setSending] = useState(false);
  const [solvingMessage, setSolvingMessage] = useState<string | null>(null);
  const [view, setView] = useState<'open' | 'solved'>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRoom = useRef('');

  function rememberRoom(entry: RoomEntry) {
    setRooms((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)];
      sessionStorage.setItem('doubtdesk.rooms', JSON.stringify(next));
      return next;
    });
  }

  const refresh = useCallback(async () => {
    if (!room) {
      setMsgs([]);
      return;
    }
    setLoadingMessages(true);
    setRoomError('');
    try {
      const latest = await fetchRoomMessages(room);
      if (messageRoom.current === room) {
        setMsgs((current) => mergeMessages(current, latest));
      } else {
        setMsgs(latest);
        messageRoom.current = room;
      }
      setHasMore(latest.length >= 50);
    } catch (e) {
      setRoomError((e as Error).message);
    } finally {
      setLoadingMessages(false);
    }
  }, [room]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const unsubscribe = onActivity(() => { void refresh(); });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, view]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const connect = () => run(async () => {
    const name = displayName.trim();
    if (!name) throw new Error('Enter a display name to continue.');
    if (authenticating) return;
    setAuthenticating(true);
    setStatus('Signing in...');
    try {
      const { userId, accessToken, sessionToken } = await loginUser(name);
      const id = await connectUser(accessToken);
      if (id !== userId) throw new Error('Nexconn connected with an unexpected user ID');
      sessionStorage.setItem('doubtdesk.name', name);
      setApiSession(sessionToken);
      setMe(id);
      setStatus(`Connected as ${id}`);
      const sharedCode = roomCodeFrom(joinCode);
      if (sharedCode) {
        await joinRoom(sharedCode);
        rememberRoom({ id: sharedCode, name: sharedCode });
        setRoom(sharedCode);
      }
    } finally {
      setAuthenticating(false);
    }
  });

  const create = () =>
    run(async () => {
      const id = roomInput.trim();
      const label = roomName.trim() || id;
      const list = invitees.split(',').map((s) => s.trim()).filter(Boolean);
      await createRoom(id, label, list, apiSession);
      rememberRoom({ id, name: label });
      setRoom(id);
    });

  const join = () =>
    run(async () => {
      const id = roomCodeFrom(joinCode);
      if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error('Enter a valid room code or invite link.');
      await joinRoom(id);
      rememberRoom({ id, name: id });
      setRoom(id);
    });

  async function askBot(doubtId: string, question: string) {
    setAiStatus('🤖 AI is answering...');
    try {
      const answer = await askAI(question);
      await postAIReply(room, doubtId, answer);
      await refresh();
      setAiStatus('');
    } catch (e) {
      console.error('AI answer failed:', e);
      setAiStatus("AI couldn't answer, a senior will help.");
    }
  }

  const submit = () => {
    if (sending || !room) return;
    return run(async () => {
      const q = text.trim();
      if (!q) return;
      setSending(true);
      try {
        if (replyTo) {
          await postReply(room, replyTo, q);
          setText('');
          setReplyTo(null);
          await refresh();
          return;
        }
        const doubt = await postDoubt(room, q);
        setText('');
        await refresh();
        void askBot(doubt.messageId, q);
      } finally {
        setSending(false);
      }
    });
  };

  const solve = (message: RoomMessage) => {
    if (solvingMessage) return;
    return run(async () => {
      setSolvingMessage(message.messageId);
      try {
        await markSolved(message);
        await refresh();
      } finally {
        setSolvingMessage(null);
      }
    });
  };

  const loadMore = () => run(async () => {
    if (!room || messageRoom.current !== room || !msgs.length || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const older = await fetchRoomMessages(room, msgs[0].sentTime - 1);
      setMsgs((current) => mergeMessages(older, current));
      setHasMore(older.length >= 50);
    } finally {
      setLoadingMore(false);
    }
  });

  const doubts = msgs.filter((message) => metaOf(message).kind === 'doubt');
  const repliesOf = (id: string) =>
    msgs.filter((message) => metaOf(message).kind === 'reply' && metaOf(message).replyTo === id);
  const statusDoubts = doubts.filter(
    (message) => (metaOf(message).status === 'solved') === (view === 'solved'),
  );
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const visibleDoubts = statusDoubts.filter((doubt) => {
    if (view !== 'solved' || !normalizedSearch) return true;
    return [doubt, ...repliesOf(doubt.messageId)].some((message) =>
      textOf(message).toLocaleLowerCase().includes(normalizedSearch),
    );
  });

  return (
    <div className="app" data-theme={theme}>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">?</span>
            <div>
              <h1>DoubtDesk</h1>
              <p>Questions that find an answer.</p>
            </div>
          </div>
          <div className="header-actions">
            {me && <span className="identity">Connected as {me}</span>}
            <button
              className="theme-toggle"
              onClick={() => {
                const next = theme === 'light' ? 'dark' : 'light';
                localStorage.setItem('doubtdesk.theme', next);
                setTheme(next);
              }}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'light' ? '☾ Dark' : '☀ Light'}
            </button>
          </div>
        </header>

        <p className="app-status" role="status">{status}</p>
        {aiStatus && <p className="ai-status" role="status">{aiStatus}</p>}

        {!me ? (
          <main className="welcome-panel">
            <span className="eyebrow">YOUR CAMPUS, ONE ANSWER CLOSER</span>
            <h2>Good questions deserve better than a busy group chat.</h2>
            <p>Sign in with a display name to ask, discuss, and save answers with your classmates.</p>
            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label htmlFor="display-name">Display name</label>
              <div className="login-controls">
                <input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Maya"
                  maxLength={40}
                  autoComplete="nickname"
                />
                <button type="submit" disabled={authenticating}>
                  {authenticating ? 'Signing in…' : 'Continue'}
                </button>
              </div>
              <small>No password needed for the demo.</small>
            </form>
          </main>
        ) : (
        <div className="workspace">
          <aside className="sidebar">
            <section>
              <h3>Subject rooms</h3>
              <div className="room-list">
                {rooms.map((entry) => (
                  <button
                    className={entry.id === room ? 'room-link active' : 'room-link'}
                    key={entry.id}
                    onClick={() => setRoom(entry.id)}
                  >
                    <span>{entry.name}</span>
                    <small>{entry.id}</small>
                  </button>
                ))}
                {rooms.length === 0 && <p className="muted">Your rooms will appear here.</p>}
              </div>
            </section>

            <section className="room-tools">
              <h3>Create a room</h3>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Subject name"
                maxLength={64}
              />
              <input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="Room code (letters/numbers)"
                maxLength={64}
              />
              <input
                value={invitees}
                onChange={(e) => setInvitees(e.target.value)}
                placeholder="Invitee IDs (optional, comma separated)"
              />
              <div className="preset-list">
                {PRESET_ROOMS.map((preset) => (
                  <button
                    key={preset.id}
                    className="preset"
                    onClick={() => {
                      setRoomName(preset.name);
                      setRoomInput(preset.id);
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <button onClick={create}>Create room</button>
            </section>

            <section className="room-tools">
              <h3>Join by code</h3>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Paste a room code or invite link"
              />
              <button onClick={join}>Join room</button>
            </section>
          </aside>

          <main className="room-main">
            <header className="room-header">
              <div>
                <h3>{rooms.find((entry) => entry.id === room)?.name ?? (room || 'Choose a room')}</h3>
                {room && <small>Room code: {room}</small>}
              </div>
              {room && (
                <button
                  onClick={() => {
                    const link = new URL(window.location.href);
                    link.searchParams.set('room', room);
                    void navigator.clipboard.writeText(link.toString())
                      .then(() => setStatus('Invite link copied.'))
                      .catch(() => setStatus(`Share this room code: ${room}`));
                  }}
                >
                  Share invite link
                </button>
              )}
            </header>

            {room ? (
              <>
              <div className="board-tabs" role="tablist" aria-label="Doubt status">
                <button
                  className={view === 'open' ? 'tab active' : 'tab'}
                  role="tab"
                  aria-selected={view === 'open'}
                  onClick={() => setView('open')}
                >
                  Open <span>{doubts.filter((message) => metaOf(message).status !== 'solved').length}</span>
                </button>
                <button
                  className={view === 'solved' ? 'tab active' : 'tab'}
                  role="tab"
                  aria-selected={view === 'solved'}
                  onClick={() => setView('solved')}
                >
                  Solved <span>{doubts.filter((message) => metaOf(message).status === 'solved').length}</span>
                </button>
              </div>

              {view === 'solved' && (
                <input
                  className="answer-search"
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search solved doubts and replies"
                  aria-label="Search solved doubts and replies"
                />
              )}
              {loadingMessages && <p className="state-message">Loading doubts…</p>}
              {roomError && <p className="error-message" role="alert">{roomError}</p>}
              {!loadingMessages && !roomError && visibleDoubts.length === 0 && (
                <div className="empty-board">
                  <h3>
                    {normalizedSearch
                      ? 'No matching solved answers'
                      : view === 'open' ? 'No open doubts' : 'No solved doubts yet'}
                  </h3>
                  <p>
                    {normalizedSearch
                      ? 'Try another phrase or load more history.'
                      : view === 'open' ? 'Post a question and start the conversation.' : 'Solved answers will be saved here.'}
                  </p>
                </div>
              )}

              <div className="doubt-list">
              {visibleDoubts.map((doubt) => {
                const solved = metaOf(doubt).status === 'solved';
                return (
                  <article className="doubt-card" key={doubt.messageId}>
                    <div className="doubt-meta">
                      <span className={solved ? 'status-pill solved' : 'status-pill'}>{solved ? 'Solved' : 'Open'}</span>
                      <span>{doubt.senderUserId === me ? 'You' : doubt.senderUserId}</span>
                      <time dateTime={new Date(doubt.sentTime).toISOString()}>{formatTime(doubt.sentTime)}</time>
                    </div>
                    <p className="doubt-text">{textOf(doubt)}</p>
                    <div className="reply-list">
                    {repliesOf(doubt.messageId).map((reply) => {
                      const isAI = metaOf(reply).author === 'ai';
                      return (
                        <article className={isAI ? 'reply-card ai-reply' : 'reply-card'} key={reply.messageId}>
                          <div className="reply-meta">
                            <strong>{isAI ? '🤖 DoubtDesk AI' : reply.senderUserId === me ? 'You' : reply.senderUserId}</strong>
                            {isAI && <span className="ai-badge">AI first answer</span>}
                            <time dateTime={new Date(reply.sentTime).toISOString()}>{formatTime(reply.sentTime)}</time>
                          </div>
                          <p>{textOf(reply)}</p>
                        </article>
                      );
                    })}
                    {repliesOf(doubt.messageId).length === 0 && (
                      <p className="muted">No replies yet. Be the first to help.</p>
                    )}
                    </div>
                    <div className="card-actions">
                      <button onClick={() => setReplyTo(doubt.messageId)} disabled={sending}>Reply</button>
                      {!solved && doubt.senderUserId === me && (
                        <button
                          onClick={() => void solve(doubt)}
                          disabled={solvingMessage !== null}
                        >
                          {solvingMessage === doubt.messageId ? 'Saving…' : 'Mark solved'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              <div ref={bottomRef} />
              </div>
              {hasMore && (
                <button className="load-more" onClick={loadMore} disabled={loadingMore || loadingMessages}>
                  {loadingMore ? 'Loading…' : 'Load older doubts'}
                </button>
              )}

              <div className="composer">
                {replyTo && (
                  <div className="replying-to">
                    Replying to a doubt <button onClick={() => setReplyTo(null)}>Cancel</button>
                  </div>
                )}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={replyTo ? 'Write a reply' : 'Post a new doubt'}
                  maxLength={2000}
                  rows={2}
                />
                <button onClick={submit} disabled={sending || !text.trim()}>
                  {sending ? 'Sending…' : replyTo ? 'Send reply' : 'Post doubt'}
                </button>
              </div>
              </>
            ) : (
              <div className="empty-room">
                <h3>Make every doubt count.</h3>
                <p>Create a subject room or join a classmate with a room code.</p>
              </div>
            )}
          </main>
        </div>
        )}
      </div>
    </div>
  );
}