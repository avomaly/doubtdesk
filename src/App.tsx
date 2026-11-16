import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  DoorOpen,
  LayoutDashboard,
  Library,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react';
import './App.css';
import { connectUser, onActivity } from './nexconn';
import {
  checkAPI, loginUser, createRoom, joinRoom, fetchRoomMessages, postDoubt, postReply,
  postAIReply, askAI, markSolved, textOf, metaOf,
  type RoomMessage,
} from './chat';

type RoomEntry = { id: string; name: string };
type PageKey = 'dashboard' | 'rooms' | 'my-doubts' | 'answer-bank' | 'room';
type DoubtEntry = {
  doubt: RoomMessage;
  room: RoomEntry;
  replies: RoomMessage[];
};

const PRESET_SUBJECTS = [
  { name: 'Physics 101', code: 'physics101' },
  { name: 'Chemistry 101', code: 'chemistry101' },
  { name: 'Calculus 101', code: 'calculus101' },
];

const PRIMARY_NAV = [
  { key: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { key: 'rooms' as const, label: 'Rooms', icon: DoorOpen },
  { key: 'my-doubts' as const, label: 'My doubts', icon: NotebookPen },
  { key: 'answer-bank' as const, label: 'Answer bank', icon: Library },
];

const AI_NOTE = 'Check with a senior or your teacher.';

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

function aiText(text: string) {
  return text
    .replace(/\s*\n*\(AI answer - confirm with your seniors or teacher\.\)$/i, '')
    .replace(/\s*\n*Check with a senior or your teacher\.$/i, '');
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => localStorage.getItem('doubtdesk.theme') === 'dark' ? 'dark' : 'light',
  );
  const [displayName, setDisplayName] = useState(
    () => sessionStorage.getItem('doubtdesk.name') ?? '',
  );
  const [apiReachable, setApiReachable] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [roomWorking, setRoomWorking] = useState(false);
  const [me, setMe] = useState('');
  const [apiSession, setApiSession] = useState('');
  const [notice, setNotice] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomName, setRoomName] = useState('');
  const [invitees, setInvitees] = useState('');
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(window.location.search).get('room') ?? '',
  );
  const [rooms, setRooms] = useState<RoomEntry[]>(readRooms);
  const [room, setRoom] = useState('');
  const [page, setPage] = useState<PageKey>('dashboard');
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, RoomMessage[]>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [loadingRooms, setLoadingRooms] = useState<Set<string>>(new Set());
  const [hasMoreByRoom, setHasMoreByRoom] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [view, setView] = useState<'open' | 'solved'>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [solvingMessage, setSolvingMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const reachable = await checkAPI();
      if (active) setApiReachable(reachable);
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const rememberRoom = useCallback((entry: RoomEntry) => {
    setRooms((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)];
      sessionStorage.setItem('doubtdesk.rooms', JSON.stringify(next));
      return next;
    });
  }, []);

  const refreshRoom = useCallback(async (id: string) => {
    setLoadingRooms((current) => new Set(current).add(id));
    try {
      const latest = await fetchRoomMessages(id);
      setMessagesByRoom((current) => ({
        ...current,
        [id]: mergeMessages(current[id] ?? [], latest),
      }));
      setHasMoreByRoom((current) => ({ ...current, [id]: latest.length >= 50 }));
      setHistoryErrors((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (error) {
      setHistoryErrors((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : 'Could not load this room history.',
      }));
    } finally {
      setLoadingRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const refreshAllRooms = useCallback(async () => {
    await Promise.all(rooms.map((entry) => refreshRoom(entry.id)));
  }, [refreshRoom, rooms]);

  useEffect(() => {
    if (!me) return;
    void refreshAllRooms();
    return onActivity(() => { void refreshAllRooms(); });
  }, [me, refreshAllRooms]);

  const roomEntries = useMemo(
    () => rooms.map((entry) => ({ ...entry, messages: messagesByRoom[entry.id] ?? [] })),
    [messagesByRoom, rooms],
  );
  const doubtEntries = useMemo<DoubtEntry[]>(() => roomEntries.flatMap((entry) => {
    const doubts = entry.messages.filter((message) => metaOf(message).kind === 'doubt');
    return doubts.map((doubt) => ({
      doubt,
      room: { id: entry.id, name: entry.name },
      replies: entry.messages.filter(
        (message) => metaOf(message).kind === 'reply' && metaOf(message).replyTo === doubt.messageId,
      ),
    }));
  }).sort((left, right) => right.doubt.sentTime - left.doubt.sentTime), [roomEntries]);
  const activeRoom = rooms.find((entry) => entry.id === room);
  const activeEntries = doubtEntries.filter((entry) => entry.room.id === room);
  const myDoubts = doubtEntries.filter((entry) => entry.doubt.senderUserId === me);
  const openDoubts = doubtEntries.filter((entry) => metaOf(entry.doubt).status !== 'solved');
  const solvedDoubts = doubtEntries.filter((entry) => metaOf(entry.doubt).status === 'solved');
  const needsAnswer = openDoubts.filter(
    (entry) => !entry.replies.some((reply) => metaOf(reply).author !== 'ai'),
  );
  const filteredRoomEntries = activeEntries.filter(
    (entry) => (metaOf(entry.doubt).status === 'solved') === (view === 'solved'),
  );
  const filteredMyDoubts = myDoubts.filter(
    (entry) => (metaOf(entry.doubt).status === 'solved') === (view === 'solved'),
  );
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const filteredAnswers = solvedDoubts.filter((entry) =>
    !normalizedSearch ||
    [entry.doubt, ...entry.replies].some((message) =>
      textOf(message).toLocaleLowerCase().includes(normalizedSearch),
    ),
  );
  const normalizedGlobalSearch = globalSearch.trim().toLocaleLowerCase();
  const globalResults = doubtEntries.filter((entry) =>
    normalizedGlobalSearch &&
    [entry.doubt, ...entry.replies].some((message) =>
      textOf(message).toLocaleLowerCase().includes(normalizedGlobalSearch),
    ),
  ).slice(0, 8);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    }
  }

  const connect = () => run(async () => {
    const name = displayName.trim();
    if (!name) throw new Error('Enter a display name to continue.');
    if (authenticating) return;
    setAuthenticating(true);
    try {
      const { userId, accessToken, sessionToken } = await loginUser(name);
      const id = await connectUser(accessToken);
      if (id !== userId) throw new Error('Could not confirm your Nexconn account. Sign in again.');
      sessionStorage.setItem('doubtdesk.name', name);
      setApiSession(sessionToken);
      setMe(id);
      const sharedCode = roomCodeFrom(joinCode);
      if (sharedCode) {
        await joinRoom(sharedCode);
        rememberRoom({ id: sharedCode, name: sharedCode });
        setRoom(sharedCode);
        setPage('room');
      }
    } finally {
      setAuthenticating(false);
    }
  });

  const create = () => run(async () => {
    const id = roomInput.trim();
    const label = roomName.trim() || id;
    const list = invitees.split(',').map((item) => item.trim()).filter(Boolean);
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) {
      throw new Error('Use a room code with 1–64 letters or numbers.');
    }
    setRoomWorking(true);
    try {
      await createRoom(id, label, list, apiSession);
      rememberRoom({ id, name: label });
      setRoom(id);
      setPage('room');
      setView('open');
    } finally {
      setRoomWorking(false);
    }
  });

  const join = () => run(async () => {
    const id = roomCodeFrom(joinCode);
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) {
      throw new Error('Enter a room code with 1–64 letters or numbers.');
    }
    setRoomWorking(true);
    try {
      await joinRoom(id);
      const existing = rooms.find((entry) => entry.id === id);
      rememberRoom(existing ?? { id, name: id });
      setRoom(id);
      setPage('room');
      setView('open');
    } finally {
      setRoomWorking(false);
    }
  });

  async function askBot(doubtId: string, question: string) {
    setAiStatus('AI is drafting a first answer.');
    try {
      const answer = await askAI(question);
      await postAIReply(room, doubtId, answer);
      await refreshRoom(room);
      setAiStatus('');
    } catch (error) {
      console.error('AI answer failed:', error);
      setAiStatus("AI couldn't answer. A senior can help.");
    }
  }

  const submit = () => {
    if (sending || !room) return;
    return run(async () => {
      const question = text.trim();
      if (!question) return;
      setSending(true);
      try {
        if (replyTo) {
          await postReply(room, replyTo, question);
          setText('');
          setReplyTo(null);
          await refreshRoom(room);
          return;
        }
        const doubt = await postDoubt(room, question);
        setText('');
        await refreshRoom(room);
        void askBot(doubt.messageId, question);
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
        await refreshRoom(room);
      } finally {
        setSolvingMessage(null);
      }
    });
  };

  const loadOlder = () => run(async () => {
    const targets = page === 'room' && room
      ? [room]
      : rooms.filter((entry) => hasMoreByRoom[entry.id]).map((entry) => entry.id);
    if (!targets.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      await Promise.all(targets.map(async (id) => {
        const current = messagesByRoom[id] ?? [];
        if (!current.length) return;
        const older = await fetchRoomMessages(id, current[0].sentTime - 1);
        setMessagesByRoom((cached) => ({
          ...cached,
          [id]: mergeMessages(older, cached[id] ?? []),
        }));
        setHasMoreByRoom((cached) => ({ ...cached, [id]: older.length >= 50 }));
      }));
    } finally {
      setLoadingOlder(false);
    }
  });

  function openRoom(id: string) {
    setRoom(id);
    setPage('room');
    setView('open');
  }

  function selectNavigation(next: PageKey) {
    setPage(next);
    setNotice('');
  }

  function openSearchResult(entry: DoubtEntry) {
    setRoom(entry.room.id);
    setPage('room');
    setView(metaOf(entry.doubt).status === 'solved' ? 'solved' : 'open');
    setSearchTerm(globalSearch);
    setSearchOpen(false);
  }

  const currentTitle = page === 'room'
    ? activeRoom?.name ?? room
    : PRIMARY_NAV.find((item) => item.key === page)?.label ?? 'Dashboard';
  const hasOlder = page === 'room'
    ? Boolean(hasMoreByRoom[room])
    : rooms.some((entry) => hasMoreByRoom[entry.id]);

  function renderDoubt(entry: DoubtEntry, showRoom = false) {
    const metadata = metaOf(entry.doubt);
    const solved = metadata.status === 'solved';
    return (
      <article className="doubt-entry" key={entry.doubt.messageId}>
        <div className="doubt-meta">
          <div className="doubt-meta-left">
            <span className={solved ? 'status-label is-solved' : 'status-label'}>
              {solved ? 'SOLVED' : 'OPEN'}
            </span>
            <span>{entry.doubt.senderUserId === me ? 'You' : entry.doubt.senderUserId}</span>
          </div>
          <time dateTime={new Date(entry.doubt.sentTime).toISOString()}>
            {formatTime(entry.doubt.sentTime)}
          </time>
        </div>
        <h3 className="doubt-title">{textOf(entry.doubt)}</h3>
        {showRoom && (
          <button className="room-context" onClick={() => openRoom(entry.room.id)}>
            {entry.room.name}<ArrowUpRight size={13} strokeWidth={1.5} />
          </button>
        )}
        {entry.replies.length > 0 ? (
          <div className="reply-list">
            {entry.replies.map((reply) => {
              const isAI = metaOf(reply).author === 'ai';
              return (
                <article className={isAI ? 'reply-entry ai-reply' : 'reply-entry'} key={reply.messageId}>
                  <div className="reply-meta">
                    <strong>
                      {isAI ? 'DoubtDesk AI' : reply.senderUserId === me ? 'You' : reply.senderUserId}
                    </strong>
                    {isAI && <span className="ai-badge">AI DRAFT</span>}
                    <time dateTime={new Date(reply.sentTime).toISOString()}>
                      {formatTime(reply.sentTime)}
                    </time>
                  </div>
                  <p>{isAI ? aiText(textOf(reply)) : textOf(reply)}</p>
                  {isAI && <p className="ai-note">{AI_NOTE}</p>}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="no-replies">No replies yet.</p>
        )}
        <div className="doubt-actions">
          <button className="text-action" onClick={() => setReplyTo(entry.doubt.messageId)} disabled={sending}>
            Reply
          </button>
          {!solved && entry.doubt.senderUserId === me && (
            <button
              className="text-action"
              onClick={() => void solve(entry.doubt)}
              disabled={solvingMessage !== null}
            >
              {solvingMessage === entry.doubt.messageId ? 'Saving…' : 'Mark solved'}
            </button>
          )}
        </div>
      </article>
    );
  }

  function renderStatusTabs(entries: DoubtEntry[]) {
    const openCount = entries.filter((entry) => metaOf(entry.doubt).status !== 'solved').length;
    const solvedCount = entries.length - openCount;
    return (
      <div className="status-tabs" role="tablist" aria-label="Doubt status">
        <button
          className={view === 'open' ? 'status-tab active' : 'status-tab'}
          role="tab"
          aria-selected={view === 'open'}
          onClick={() => setView('open')}
        >
          Open <span>{openCount}</span>
        </button>
        <button
          className={view === 'solved' ? 'status-tab active' : 'status-tab'}
          role="tab"
          aria-selected={view === 'solved'}
          onClick={() => setView('solved')}
        >
          Solved <span>{solvedCount}</span>
        </button>
      </div>
    );
  }

  function renderEmpty(title: string, detail: string) {
    return (
      <div className="empty-state">
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    );
  }

  return (
    <div className="app" data-theme={theme}>
      {!me ? (
        <main className="login-page">
          <div className="login-brand">
            <NotebookPen size={19} strokeWidth={1.5} />
            <span>DoubtDesk</span>
          </div>
          <section className="login-panel">
            <p className="section-kicker">STUDY ROOMS</p>
            <h1>Sign in</h1>
            <p className="login-description">Use a display name your classmates recognize.</p>
            {notice && <p className="notice" role="alert">{notice}</p>}
            {!apiReachable && (
              <p className="api-banner" role="alert">
                <strong>API server unreachable.</strong> Start the app with <code>npm run dev:all</code>, then try again.
              </p>
            )}
            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label htmlFor="display-name">Display name</label>
              <input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. Maya"
                maxLength={40}
                autoComplete="nickname"
                required
              />
              <button className="primary-button" type="submit" disabled={authenticating}>
                {authenticating ? 'Signing in…' : 'Continue'}
              </button>
            </form>
            <p className="login-footnote">No password needed for this demo.</p>
          </section>
          <button
            className="login-theme"
            onClick={() => {
              const next = theme === 'light' ? 'dark' : 'light';
              localStorage.setItem('doubtdesk.theme', next);
              setTheme(next);
            }}
          >
            {theme === 'light'
              ? <><Moon size={15} strokeWidth={1.5} /> Dark mode</>
              : <><Sun size={15} strokeWidth={1.5} /> Light mode</>}
          </button>
        </main>
      ) : (
        <div className="app-layout">
          <aside className="desktop-sidebar">
            <div className="brand-lockup">
              <NotebookPen size={19} strokeWidth={1.5} />
              <span>DoubtDesk</span>
            </div>
            <nav className="primary-nav" aria-label="Main navigation">
              {PRIMARY_NAV.map((item) => {
                const Icon = item.icon;
                const active = page === item.key || (item.key === 'rooms' && page === 'room');
                return (
                  <button
                    className={active ? 'nav-item active' : 'nav-item'}
                    key={item.key}
                    onClick={() => selectNavigation(item.key)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="sidebar-room-section">
              <div className="sidebar-section-heading">
                <span>YOUR ROOMS</span>
                <button aria-label="Create or join a room" onClick={() => selectNavigation('rooms')}>
                  <Plus size={15} strokeWidth={1.5} />
                </button>
              </div>
              <div className="sidebar-room-list">
                {rooms.map((entry) => {
                  const count = (messagesByRoom[entry.id] ?? []).filter(
                    (message) =>
                      metaOf(message).kind === 'doubt' && metaOf(message).status !== 'solved',
                  ).length;
                  return (
                    <button
                      className={page === 'room' && entry.id === room ? 'sidebar-room active' : 'sidebar-room'}
                      key={entry.id}
                      onClick={() => openRoom(entry.id)}
                    >
                      <span className="room-marker" />
                      <span className="sidebar-room-name">{entry.name}</span>
                      {count > 0 && <span className="sidebar-room-count">{count}</span>}
                    </button>
                  );
                })}
                {rooms.length === 0 && <p className="sidebar-empty">No rooms yet.</p>}
              </div>
            </div>
            <div className="sidebar-account">
              <span className="account-mark">{displayName.slice(0, 1).toUpperCase() || 'S'}</span>
              <span className="account-name">{displayName || 'Student'}</span>
            </div>
          </aside>

          <div className="app-main">
            <header className="topbar">
              <div className="topbar-title">
                <p className="section-kicker">{page === 'room' ? 'ROOM' : 'DOUBTDESK'}</p>
                <h1>{currentTitle || 'Rooms'}</h1>
              </div>
              <div className="topbar-actions">
                <button className="search-trigger" onClick={() => setSearchOpen(true)}>
                  <Search size={16} strokeWidth={1.5} />
                  <span>Search</span>
                  <kbd>⌘K</kbd>
                </button>
                <button
                  className="icon-action"
                  aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                  onClick={() => {
                    const next = theme === 'light' ? 'dark' : 'light';
                    localStorage.setItem('doubtdesk.theme', next);
                    setTheme(next);
                  }}
                >
                  {theme === 'light'
                    ? <Moon size={16} strokeWidth={1.5} />
                    : <Sun size={16} strokeWidth={1.5} />}
                </button>
              </div>
            </header>

            <main className="content-area">
              {!apiReachable && (
                <p className="api-banner" role="alert">
                  <strong>API server unreachable.</strong> Start the app with <code>npm run dev:all</code>, then try again.
                </p>
              )}
              {notice && <p className="notice" role="alert">{notice}</p>}
              {aiStatus && <p className="ai-status" role="status">{aiStatus}</p>}

              {page === 'dashboard' && (
                <section className="reading-column">
                  <p className="page-description">Recent activity from rooms you can access.</p>
                  {Object.entries(historyErrors).map(([id, message]) => (
                    <p className="error-message" role="alert" key={id}>
                      {rooms.find((entry) => entry.id === id)?.name ?? id}: {message}
                    </p>
                  ))}
                  <div className="metrics-row" aria-label="Room summary">
                    <div className="metric">
                      <span>ROOMS</span>
                      <strong>{rooms.length}</strong>
                    </div>
                    <div className="metric">
                      <span>OPEN DOUBTS</span>
                      <strong>{openDoubts.length}</strong>
                    </div>
                    <div className="metric">
                      <span>NEED A REPLY</span>
                      <strong>{needsAnswer.length}</strong>
                    </div>
                    <div className="metric">
                      <span>SOLVED</span>
                      <strong>{solvedDoubts.length}</strong>
                    </div>
                  </div>
                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">OPEN DOUBTS</p>
                      <h2>Needs an answer</h2>
                    </div>
                    <span className="section-count">{needsAnswer.length}</span>
                  </div>
                  {loadingRooms.size > 0 && doubtEntries.length === 0 ? (
                    <p className="state-message">Loading room history…</p>
                  ) : needsAnswer.length > 0 ? (
                    <div className="doubt-list">
                      {needsAnswer.slice(0, 12).map((entry) => renderDoubt(entry, true))}
                    </div>
                  ) : renderEmpty(
                    rooms.length ? 'No doubts need a reply.' : 'No rooms yet.',
                    rooms.length
                      ? 'New questions without a classmate reply will appear here.'
                      : 'Create a subject room or join one with a room code.',
                  )}
                  {rooms.length > 0 && (
                    <button className="inline-link" onClick={() => selectNavigation('rooms')}>
                      View rooms <ChevronRight size={15} strokeWidth={1.5} />
                    </button>
                  )}
                </section>
              )}

              {page === 'rooms' && (
                <section className="wide-column">
                  <p className="page-description">Create a subject room or join with a classmate’s room code.</p>
                  <div className="rooms-layout">
                    <div className="rooms-panel">
                      <div className="section-heading">
                        <div>
                          <p className="section-kicker">SUBJECTS</p>
                          <h2>Your rooms</h2>
                        </div>
                        <span className="section-count">{rooms.length}</span>
                      </div>
                      {rooms.length ? (
                        <div className="room-directory">
                          {rooms.map((entry) => {
                            const messages = messagesByRoom[entry.id] ?? [];
                            const openCount = messages.filter(
                              (message) => metaOf(message).kind === 'doubt' && metaOf(message).status !== 'solved',
                            ).length;
                            const solvedCount = messages.filter(
                              (message) => metaOf(message).kind === 'doubt' && metaOf(message).status === 'solved',
                            ).length;
                            return (
                              <button className="room-directory-row" key={entry.id} onClick={() => openRoom(entry.id)}>
                                <span className="room-directory-mark"><BookOpen size={17} strokeWidth={1.5} /></span>
                                <span className="room-directory-main">
                                  <strong>{entry.name}</strong>
                                  <small>{entry.id}</small>
                                </span>
                                <span className="room-directory-counts">
                                  <span>{openCount} open</span>
                                  <span>{solvedCount} solved</span>
                                </span>
                                <ArrowUpRight size={15} strokeWidth={1.5} />
                              </button>
                            );
                          })}
                        </div>
                      ) : renderEmpty('No rooms yet.', 'Create a room for your course or enter a code from a classmate.')}
                    </div>

                    <div className="room-forms">
                      <form
                        className="form-panel"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void create();
                        }}
                      >
                        <p className="section-kicker">NEW ROOM</p>
                        <h2>Create a room</h2>
                        <label htmlFor="room-name">Subject name</label>
                        <input
                          id="room-name"
                          value={roomName}
                          onChange={(event) => setRoomName(event.target.value)}
                          placeholder="e.g. Physics 101"
                          maxLength={64}
                        />
                        <label htmlFor="room-code">Room code</label>
                        <input
                          id="room-code"
                          value={roomInput}
                          onChange={(event) => setRoomInput(event.target.value)}
                          placeholder="Letters and numbers"
                          maxLength={64}
                          required
                        />
                        <label htmlFor="room-invitees">Invitee IDs <span>(optional)</span></label>
                        <input
                          id="room-invitees"
                          value={invitees}
                          onChange={(event) => setInvitees(event.target.value)}
                          placeholder="Separate IDs with commas"
                        />
                        <div className="preset-list" aria-label="Preset subjects">
                          {PRESET_SUBJECTS.map((preset) => (
                            <button
                              className="preset-button"
                              key={preset.name}
                              type="button"
                              onClick={() => {
                                setRoomName(preset.name);
                                setRoomInput(`${preset.code}${Date.now().toString(36).slice(-5)}`);
                              }}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                        <button className="primary-button" type="submit" disabled={roomWorking}>
                          <Plus size={15} strokeWidth={1.5} />
                          {roomWorking ? 'Creating…' : 'Create room'}
                        </button>
                      </form>

                      <form
                        className="form-panel"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void join();
                        }}
                      >
                        <p className="section-kicker">JOIN ROOM</p>
                        <h2>Enter a room code</h2>
                        <label htmlFor="join-code">Room code or invite link</label>
                        <input
                          id="join-code"
                          value={joinCode}
                          onChange={(event) => setJoinCode(event.target.value)}
                          placeholder="Paste a code or link"
                          required
                        />
                        <button className="secondary-button" type="submit" disabled={roomWorking}>
                          <DoorOpen size={15} strokeWidth={1.5} />
                          {roomWorking ? 'Joining…' : 'Join room'}
                        </button>
                      </form>
                    </div>
                  </div>
                </section>
              )}

              {page === 'room' && (
                <section className="reading-column room-page">
                  {activeRoom ? (
                    <>
                      <div className="room-heading">
                        <div>
                          <p className="section-kicker">ROOM CODE · {activeRoom.id}</p>
                          <h2>{activeRoom.name}</h2>
                        </div>
                        <button
                          className="secondary-button compact"
                          onClick={() => {
                            const link = new URL(window.location.href);
                            link.searchParams.set('room', room);
                            void navigator.clipboard.writeText(link.toString())
                              .then(() => setNotice('Invite link copied.'))
                              .catch(() => setNotice(`Share this room code: ${room}`));
                          }}
                        >
                          Share room
                        </button>
                      </div>
                      {renderStatusTabs(activeEntries)}
                      {historyErrors[room] && (
                        <p className="error-message" role="alert">{historyErrors[room]}</p>
                      )}
                      {loadingRooms.has(room) && !messagesByRoom[room] ? (
                        <p className="state-message">Loading room history…</p>
                      ) : filteredRoomEntries.length ? (
                        <div className="doubt-list">
                          {filteredRoomEntries.map((entry) => renderDoubt(entry))}
                        </div>
                      ) : renderEmpty(
                        view === 'solved' ? 'No solved doubts in this room yet.' : 'No open doubts in this room.',
                        view === 'solved'
                          ? 'Solve a doubt and it will show up here.'
                          : 'Ask a doubt to start the discussion.',
                      )}
                      {hasOlder && (
                        <button className="secondary-button load-more" onClick={() => void loadOlder()} disabled={loadingOlder}>
                          {loadingOlder ? 'Loading…' : 'Load older doubts'}
                        </button>
                      )}
                      {view === 'open' && (
                        <form
                          className="composer"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                          }}
                        >
                          {replyTo && (
                            <div className="replying-to">
                              <span>Replying to a doubt</span>
                              <button type="button" className="text-action" onClick={() => setReplyTo(null)}>Cancel</button>
                            </div>
                          )}
                          <textarea
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder={replyTo ? 'Write a reply' : 'Ask a doubt'}
                            maxLength={2000}
                            rows={3}
                          />
                          <div className="composer-footer">
                            <span>{replyTo ? 'Replies stay with their doubt.' : 'Keep the question specific.'}</span>
                            <button className="primary-button" type="submit" disabled={sending || !text.trim()}>
                              {sending ? 'Sending…' : replyTo ? 'Send reply' : 'Ask a doubt'}
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  ) : renderEmpty('Choose a room.', 'Open a subject room from the navigation or join with a room code.')}
                </section>
              )}

              {page === 'my-doubts' && (
                <section className="reading-column">
                  <p className="page-description">Doubts you started across your rooms.</p>
                  {renderStatusTabs(myDoubts)}
                  {filteredMyDoubts.length ? (
                    <div className="doubt-list">{filteredMyDoubts.map((entry) => renderDoubt(entry, true))}</div>
                  ) : renderEmpty(
                    view === 'solved' ? 'No solved doubts from you yet.' : 'You have not asked a doubt yet.',
                    view === 'solved' ? 'Solved doubts you started will appear here.' : 'Open a room and ask a course question.',
                  )}
                </section>
              )}

              {page === 'answer-bank' && (
                <section className="reading-column">
                  <p className="page-description">Solved questions and their replies from loaded room history.</p>
                  <label className="search-field">
                    <Search size={16} strokeWidth={1.5} />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search solved doubts and replies"
                      aria-label="Search solved doubts and replies"
                    />
                  </label>
                  {filteredAnswers.length ? (
                    <div className="doubt-list">{filteredAnswers.map((entry) => renderDoubt(entry, true))}</div>
                  ) : renderEmpty(
                    normalizedSearch ? 'No matching solved answers.' : 'No solved doubts yet.',
                    normalizedSearch
                      ? 'Try another phrase or load more room history.'
                      : 'Solve one and it will show up here.',
                  )}
                  {hasOlder && (
                    <button className="secondary-button load-more" onClick={() => void loadOlder()} disabled={loadingOlder}>
                      {loadingOlder ? 'Loading…' : 'Load older room history'}
                    </button>
                  )}
                </section>
              )}
            </main>
          </div>

          <nav className="mobile-nav" aria-label="Main navigation">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = page === item.key || (item.key === 'rooms' && page === 'room');
              return (
                <button
                  className={active ? 'mobile-nav-item active' : 'mobile-nav-item'}
                  key={item.key}
                  onClick={() => selectNavigation(item.key)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={1.5} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {searchOpen && (
        <div
          className="search-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false);
          }}
        >
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search DoubtDesk">
            <div className="search-dialog-input">
              <Search size={18} strokeWidth={1.5} />
              <input
                ref={searchInputRef}
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Search doubts and replies"
                aria-label="Search doubts and replies"
              />
              <button className="icon-action" aria-label="Close search" onClick={() => setSearchOpen(false)}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="search-results">
              {normalizedGlobalSearch ? globalResults.length ? globalResults.map((entry) => (
                <button className="search-result" key={entry.doubt.messageId} onClick={() => openSearchResult(entry)}>
                  <span className={metaOf(entry.doubt).status === 'solved' ? 'status-label is-solved' : 'status-label'}>
                    {metaOf(entry.doubt).status === 'solved' ? 'SOLVED' : 'OPEN'}
                  </span>
                  <span className="search-result-copy">
                    <strong>{textOf(entry.doubt)}</strong>
                    <small>{entry.room.name} · {entry.replies.length} replies</small>
                  </span>
                  <ArrowUpRight size={15} strokeWidth={1.5} />
                </button>
              )) : <p className="search-hint">No matching loaded doubts or replies.</p>
                : <p className="search-hint">Search the doubts and replies in your loaded room history.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
