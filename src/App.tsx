import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  DoorOpen,
  Flame,
  HelpCircle,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import './App.css';
import {
  connectUser,
  disconnectUser,
  onActivity,
  onConnectionStateChange,
  type ConnectionStatusType,
} from './nexconn';
import {
  checkAPI,
  loginUser,
  createRoom,
  joinRoom,
  fetchRoomMessages,
  postDoubt,
  postReply,
  postAIReply,
  askAI,
  markSolved,
  textOf,
  metaOf,
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
  pages.flat().forEach((message) => {
    if (message?.messageId) {
      messages.set(message.messageId, message);
    }
  });
  return [...messages.values()].sort((left, right) => {
    if (left.sentTime !== right.sentTime) return left.sentTime - right.sentTime;
    return left.messageId.localeCompare(right.messageId);
  });
}

function subjectClass(name: string) {
  const subject = name.toLowerCase();
  if (subject.includes('physics')) return 'subject-physics';
  if (subject.includes('chemistry')) return 'subject-chemistry';
  if (subject.includes('calculus') || subject.includes('math')) return 'subject-math';
  return 'subject-default';
}

function userColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 46%, 42%)`;
}

function userInitials(id: string) {
  if (!id) return 'ST';
  const clean = id.replace(/^student_?/, '');
  return clean.slice(0, 2).toUpperCase() || 'ST';
}

function greetingMessage(name: string) {
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : hour < 22
          ? 'Good evening'
          : 'Late study session';
  return `${timeGreeting}, ${name || 'student'}.`;
}

function studyStreakDays(messages: RoomMessage[], userId: string) {
  const activeDays = new Set(
    messages
      .filter((message) => message.senderUserId === userId)
      .map((message) => {
        const date = new Date(message.sentTime);
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      }),
  );
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const keyOf = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (!activeDays.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDays.has(keyOf(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function aiText(text: string) {
  return text
    .replace(/\s*\n*\(AI answer - confirm with your seniors or teacher\.\)$/i, '')
    .replace(/\s*\n*Check with a senior or your teacher\.$/i, '');
}

function EmptyIllustration({ type }: { type: 'notebook' | 'archive' | 'search' }) {
  if (type === 'notebook') {
    return (
      <svg
        className="empty-svg"
        width="60"
        height="60"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 10h38a4 4 0 0 1 4 4v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" />
        <path d="M24 10v44" />
        <path d="M8 18h16" />
        <path d="M8 28h16" />
        <path d="M8 38h16" />
        <path d="M32 22h16" />
        <path d="M32 30h12" />
        <path d="M32 38h8" />
      </svg>
    );
  }
  if (type === 'archive') {
    return (
      <svg
        className="empty-svg"
        width="60"
        height="60"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="14" y="12" width="36" height="14" rx="2" />
        <rect x="14" y="26" width="36" height="14" rx="2" />
        <rect x="14" y="40" width="36" height="14" rx="2" />
        <line x1="28" y1="19" x2="36" y2="19" />
        <line x1="28" y1="33" x2="36" y2="33" />
        <line x1="28" y1="47" x2="36" y2="47" />
      </svg>
    );
  }
  return (
    <svg
      className="empty-svg"
      width="60"
      height="60"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="28" cy="28" r="16" />
      <line x1="40" y1="40" x2="52" y2="52" />
      <path d="M22 28h12" />
      <path d="M28 22v12" />
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('doubtdesk.theme') === 'dark' ? 'dark' : 'light'),
  );
  const [displayName, setDisplayName] = useState(
    () => sessionStorage.getItem('doubtdesk.name') ?? '',
  );
  const [me, setMe] = useState(
    () => sessionStorage.getItem('doubtdesk.userId') ?? '',
  );
  const [apiSession, setApiSession] = useState(
    () => sessionStorage.getItem('doubtdesk.session') ?? '',
  );
  const [connectionState, setConnectionState] = useState<ConnectionStatusType>('disconnected');
  const [apiReachable, setApiReachable] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [roomWorking, setRoomWorking] = useState(false);
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
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('doubtdesk.name');
    sessionStorage.removeItem('doubtdesk.userId');
    sessionStorage.removeItem('doubtdesk.token');
    sessionStorage.removeItem('doubtdesk.session');
    setMe('');
    setApiSession('');
    setDisplayName('');
    setRoom('');
    setPage('dashboard');
    await disconnectUser();
  }, []);

  // Health check polling
  useEffect(() => {
    let active = true;
    const check = async () => {
      const reachable = await checkAPI();
      if (active) setApiReachable(reachable);
    };
    void check();
    const interval = window.setInterval(() => {
      void check();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  // Subscribe to real-time chat connection status
  useEffect(() => {
    return onConnectionStateChange((state) => {
      setConnectionState(state);
    });
  }, []);

  // Auto-reconnect active session on page reload
  useEffect(() => {
    const token = sessionStorage.getItem('doubtdesk.token');
    const savedUserId = sessionStorage.getItem('doubtdesk.userId');
    if (token && savedUserId) {
      connectUser(token).catch((err) => {
        console.warn('Auto-reconnect on reload failed:', err);
        if (String(err).includes('expired') || String(err).includes('31020')) {
          void signOut();
        }
      });
    }
  }, [signOut]);

  // Shortcut ⌘K / Ctrl+K
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
    if (!id || connectionState !== 'connected') return;
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
        [id]: error instanceof Error ? error.message : 'Could not load room history.',
      }));
    } finally {
      setLoadingRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [connectionState]);

  const refreshAllRooms = useCallback(async () => {
    if (!rooms.length) return;
    await Promise.all(rooms.map((entry) => refreshRoom(entry.id)));
  }, [refreshRoom, rooms]);

  useEffect(() => {
    if (!me || connectionState !== 'connected') return;
    void refreshAllRooms();
    return onActivity(() => {
      void refreshAllRooms();
    });
  }, [me, connectionState, refreshAllRooms]);

  const roomEntries = useMemo(
    () => rooms.map((entry) => ({ ...entry, messages: messagesByRoom[entry.id] ?? [] })),
    [messagesByRoom, rooms],
  );

  const doubtEntries = useMemo<DoubtEntry[]>(() => {
    return roomEntries
      .flatMap((entry) => {
        const doubts = entry.messages.filter((message) => metaOf(message).kind === 'doubt');
        const doubtMap = new Map<string, RoomMessage>(doubts.map((d) => [d.messageId, d]));
        const repliesByDoubt = new Map<string, RoomMessage[]>();
        const orphanReplies: RoomMessage[] = [];

        entry.messages.forEach((message) => {
          const meta = metaOf(message);
          if (meta.kind === 'reply' && meta.replyTo) {
            if (doubtMap.has(meta.replyTo)) {
              const list = repliesByDoubt.get(meta.replyTo) || [];
              list.push(message);
              repliesByDoubt.set(meta.replyTo, list);
            } else {
              orphanReplies.push(message);
            }
          }
        });

        const mappedDoubts: DoubtEntry[] = doubts.map((doubt) => ({
          doubt,
          room: { id: entry.id, name: entry.name },
          replies: repliesByDoubt.get(doubt.messageId) || [],
        }));

        if (orphanReplies.length > 0) {
          orphanReplies.forEach((reply) => {
            const meta = metaOf(reply);
            const placeholder: RoomMessage = {
              messageId: meta.replyTo || reply.messageId,
              sentTime: reply.sentTime - 1,
              senderUserId: 'classmate',
              content: { text: '(Earlier doubt from history)' },
              metadata: { kind: 'doubt', status: 'open' },
              setMetadata: async () => ({ code: 0 }),
            };
            mappedDoubts.push({
              doubt: placeholder,
              room: { id: entry.id, name: entry.name },
              replies: [reply],
            });
          });
        }

        return mappedDoubts;
      })
      .sort((left, right) => right.doubt.sentTime - left.doubt.sentTime);
  }, [roomEntries]);

  const activeRoom = rooms.find((entry) => entry.id === room);
  const activeEntries = doubtEntries.filter((entry) => entry.room.id === room);
  const myDoubts = doubtEntries.filter((entry) => entry.doubt.senderUserId === me);
  const openDoubts = doubtEntries.filter((entry) => metaOf(entry.doubt).status !== 'solved');
  const solvedDoubts = doubtEntries.filter((entry) => metaOf(entry.doubt).status === 'solved');
  const needsAnswer = openDoubts.filter(
    (entry) => !entry.replies.some((reply) => metaOf(reply).author !== 'ai'),
  );
  const studyStreak = studyStreakDays(
    roomEntries.flatMap((entry) => entry.messages),
    me,
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

  const connect = () =>
    run(async () => {
      const name = displayName.trim();
      if (!name) throw new Error('Enter a display name to continue.');
      if (authenticating) return;
      setAuthenticating(true);
      try {
        const { userId, accessToken, sessionToken } = await loginUser(name);
        const id = await connectUser(accessToken);
        if (id !== userId) throw new Error('Could not confirm your Nexconn account. Sign in again.');
        sessionStorage.setItem('doubtdesk.name', name);
        sessionStorage.setItem('doubtdesk.userId', id);
        sessionStorage.setItem('doubtdesk.token', accessToken);
        sessionStorage.setItem('doubtdesk.session', sessionToken);
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

  const create = () =>
    run(async () => {
      const id = roomInput.trim();
      const label = roomName.trim() || id;
      const list = invitees.split(',').map((item) => item.trim()).filter(Boolean);
      if (!/^[A-Za-z0-9]{1,64}$/.test(id)) {
        throw new Error('Use a room code with 1–64 letters or numbers.');
      }
      setRoomWorking(true);
      try {
        await createRoom(id, label, list, apiSession);
        await joinRoom(id);
        rememberRoom({ id, name: label });
        setRoom(id);
        setPage('room');
        setView('open');
      } finally {
        setRoomWorking(false);
      }
    });

  const join = () =>
    run(async () => {
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

  async function askBot(targetRoom: string, doubtId: string, question: string) {
    setAiStatus('AI is drafting a first answer…');
    try {
      const answer = await askAI(question, apiSession);
      await postAIReply(targetRoom, doubtId, answer);
      await refreshRoom(targetRoom);
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
        const currentRoom = room;
        const doubt = await postDoubt(currentRoom, question);
        setText('');
        await refreshRoom(currentRoom);
        void askBot(currentRoom, doubt.messageId, question);
      } finally {
        setSending(false);
      }
    });
  };

  const solve = (targetRoomId: string, message: RoomMessage) => {
    if (solvingMessage) return;
    return run(async () => {
      setSolvingMessage(message.messageId);
      try {
        await markSolved(message);
        await refreshRoom(targetRoomId);
      } finally {
        setSolvingMessage(null);
      }
    });
  };

  const loadOlder = () =>
    run(async () => {
      const targets =
        page === 'room' && room
          ? [room]
          : rooms.filter((entry) => hasMoreByRoom[entry.id]).map((entry) => entry.id);
      if (!targets.length || loadingOlder) return;
      setLoadingOlder(true);
      try {
        await Promise.all(
          targets.map(async (id) => {
            const current = messagesByRoom[id] ?? [];
            if (!current.length) return;
            const older = await fetchRoomMessages(id, current[0].sentTime - 1);
            setMessagesByRoom((cached) => ({
              ...cached,
              [id]: mergeMessages(older, cached[id] ?? []),
            }));
            setHasMoreByRoom((cached) => ({ ...cached, [id]: older.length >= 50 }));
          }),
        );
      } finally {
        setLoadingOlder(false);
      }
    });

  function openRoom(id: string) {
    setRoom(id);
    setPage('room');
    setView('open');
    if (connectionState === 'connected') {
      void refreshRoom(id);
    }
  }

  function startDoubtInRoom(targetRoomId?: string) {
    const roomId = targetRoomId || (rooms.length > 0 ? rooms[0].id : '');
    if (roomId) {
      openRoom(roomId);
      setTimeout(() => composerTextareaRef.current?.focus(), 150);
    } else {
      selectNavigation('rooms');
    }
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

  const currentTitle =
    page === 'room'
      ? activeRoom?.name ?? room
      : PRIMARY_NAV.find((item) => item.key === page)?.label ?? 'Dashboard';
  const hasOlder =
    page === 'room'
      ? Boolean(hasMoreByRoom[room])
      : rooms.some((entry) => hasMoreByRoom[entry.id]);

  function renderDoubt(entry: DoubtEntry, showRoom = false) {
    const metadata = metaOf(entry.doubt);
    const solved = metadata.status === 'solved';
    const isMyDoubt = entry.doubt.senderUserId === me;

    return (
      <article className={solved ? 'doubt-entry is-resolved' : 'doubt-entry'} key={entry.doubt.messageId}>
        <div className="doubt-meta">
          <div className="doubt-meta-left">
            <span className={solved ? 'status-label is-solved' : 'status-label'}>
              {solved ? (
                <>
                  <svg className="solved-check-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M3 8.5L6.5 12L13 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  SOLVED
                </>
              ) : (
                'OPEN'
              )}
            </span>
            <div
              className="avatar-chip"
              style={{ backgroundColor: userColor(entry.doubt.senderUserId) }}
              title={`Student ${entry.doubt.senderUserId}`}
            >
              {userInitials(entry.doubt.senderUserId)}
            </div>
            <span className="author-name">{isMyDoubt ? 'You' : `Peer ${entry.doubt.senderUserId.slice(-4)}`}</span>
          </div>
          <time dateTime={new Date(entry.doubt.sentTime).toISOString()}>
            {formatTime(entry.doubt.sentTime)}
          </time>
        </div>
        <h3 className="doubt-title">{textOf(entry.doubt)}</h3>
        {showRoom && (
          <button className="room-context" onClick={() => openRoom(entry.room.id)}>
            <span className={`room-dot ${subjectClass(entry.room.name)}`} />
            {entry.room.name}
            <ArrowUpRight size={13} strokeWidth={1.5} />
          </button>
        )}
        {entry.replies.length > 0 ? (
          <div className="reply-list">
            {entry.replies.map((reply) => {
              const isAI = metaOf(reply).author === 'ai';
              const isMe = reply.senderUserId === me;
              return (
                <article
                  className={isAI ? 'reply-entry ai-reply' : 'reply-entry'}
                  key={reply.messageId}
                >
                  <div className="reply-meta">
                    <div className="reply-author-lockup">
                      <div
                        className={isAI ? 'avatar-chip ai-chip' : 'avatar-chip'}
                        style={
                          isAI ? undefined : { backgroundColor: userColor(reply.senderUserId) }
                        }
                      >
                        {isAI ? 'AI' : userInitials(reply.senderUserId)}
                      </div>
                      <strong>
                        {isAI ? 'DoubtDesk AI' : isMe ? 'You' : `Peer ${reply.senderUserId.slice(-4)}`}
                      </strong>
                    </div>
                    {isAI && (
                      <span className="ai-badge">
                        <Sparkles size={10} strokeWidth={2} /> AI DRAFT
                      </span>
                    )}
                    <time dateTime={new Date(reply.sentTime).toISOString()}>
                      {formatTime(reply.sentTime)}
                    </time>
                  </div>
                  <p>{isAI ? aiText(textOf(reply)) : textOf(reply)}</p>
                  {isAI && (
                    <p className="ai-note">
                      <HelpCircle size={12} strokeWidth={1.5} /> {AI_NOTE}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="no-replies">No classmate replies yet.</p>
        )}
        <div className="doubt-actions">
          <button
            className="text-action"
            onClick={() => {
              if (page !== 'room') openRoom(entry.room.id);
              setReplyTo(entry.doubt.messageId);
              setTimeout(() => composerTextareaRef.current?.focus(), 100);
            }}
            disabled={sending}
          >
            Reply
          </button>
          {!solved && isMyDoubt && (
            <button
              className="solve-action-button"
              onClick={() => void solve(entry.room.id, entry.doubt)}
              disabled={solvingMessage !== null}
            >
              <Check size={13} strokeWidth={2} />
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
          Open doubts <span>{openCount}</span>
        </button>
        <button
          className={view === 'solved' ? 'status-tab active' : 'status-tab'}
          role="tab"
          aria-selected={view === 'solved'}
          onClick={() => setView('solved')}
        >
          Solved threads <span>{solvedCount}</span>
        </button>
      </div>
    );
  }

  function renderEmpty(title: string, detail: string, type: 'notebook' | 'archive' | 'search' = 'notebook') {
    return (
      <div className="empty-state glass">
        <EmptyIllustration type={type} />
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
            <NotebookPen size={22} strokeWidth={1.5} />
            <span>DoubtDesk</span>
          </div>
          <section className="login-panel glass-strong">
            <p className="section-kicker">STUDY ROOMS & COMMUNITY DOUBTS</p>
            <h1>Enter the study desk</h1>
            <p className="login-description">Use a display name your classmates and peers recognize.</p>
            {notice && (
              <p className="notice glass-strong" role="alert">
                {notice}
              </p>
            )}
            {!apiReachable && (
              <p className="api-banner glass-strong" role="alert">
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
                placeholder="e.g. Maya or Alex"
                maxLength={40}
                autoComplete="nickname"
                required
              />
              <button className="primary-button" type="submit" disabled={authenticating}>
                {authenticating ? 'Signing in…' : 'Continue to Study Desk'}
              </button>
            </form>
            <p className="login-footnote">No password needed for this course demo.</p>
          </section>
          <button
            className="login-theme"
            onClick={() => {
              const next = theme === 'light' ? 'dark' : 'light';
              localStorage.setItem('doubtdesk.theme', next);
              setTheme(next);
            }}
          >
            {theme === 'light' ? (
              <>
                <Moon size={15} strokeWidth={1.5} /> Dark mode
              </>
            ) : (
              <>
                <Sun size={15} strokeWidth={1.5} /> Light mode
              </>
            )}
          </button>
        </main>
      ) : (
        <div className="app-layout">
          <aside className="desktop-sidebar glass">
            <div className="brand-lockup">
              <div className="brand-icon-wrap">
                <NotebookPen size={18} strokeWidth={1.5} />
              </div>
              <div className="brand-text">
                <span className="brand-name">DoubtDesk</span>
                <span className="brand-tag">Study Desk</span>
              </div>
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
                <button
                  aria-label="Create or join a room"
                  onClick={() => selectNavigation('rooms')}
                >
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
                      className={
                        page === 'room' && entry.id === room
                          ? 'sidebar-room active'
                          : 'sidebar-room'
                      }
                      key={entry.id}
                      onClick={() => openRoom(entry.id)}
                    >
                      <span className={`room-marker ${subjectClass(entry.name)}`} />
                      <span className="sidebar-room-name">{entry.name}</span>
                      {count > 0 && <span className="sidebar-room-count">{count}</span>}
                    </button>
                  );
                })}
                {rooms.length === 0 && <p className="sidebar-empty">No rooms yet.</p>}
              </div>
            </div>
            <div className="sidebar-account">
              <div
                className="account-mark"
                style={{ backgroundColor: userColor(me) }}
                title={`User ID: ${me}`}
              >
                {displayName.slice(0, 1).toUpperCase() || 'S'}
              </div>
              <span className="account-name">{displayName || 'Student'}</span>
              <button
                className="signout-button"
                title="Sign out of DoubtDesk"
                onClick={() => void signOut()}
                aria-label="Sign out"
              >
                <LogOut size={15} strokeWidth={1.5} />
              </button>
            </div>
          </aside>

          <div className="app-main">
            <header className="topbar glass">
              <div className="topbar-title">
                <p className="section-kicker">{page === 'room' ? 'ACTIVE ROOM' : 'DOUBTDESK'}</p>
                <h1>{currentTitle || 'Rooms'}</h1>
              </div>
              <div className="topbar-actions">
                <button
                  className="search-trigger"
                  aria-label="Search doubts and replies"
                  aria-keyshortcuts="Meta+K Control+K"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search size={16} strokeWidth={1.5} />
                  <span>Search bank</span>
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
                  {theme === 'light' ? (
                    <Moon size={16} strokeWidth={1.5} />
                  ) : (
                    <Sun size={16} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </header>

            <main className="content-area">
              {!apiReachable && (
                <p className="api-banner glass-strong" role="alert">
                  <strong>API server unreachable.</strong> Start the app with <code>npm run dev:all</code>, then try again.
                </p>
              )}
              {connectionState !== 'connected' && (
                <div className="connection-banner glass-strong" role="status">
                  <WifiOff size={14} strokeWidth={1.5} />
                  <span>
                    {connectionState === 'connecting'
                      ? 'Connecting to chat…'
                      : connectionState === 'reconnecting'
                        ? 'Chat connection paused. Automatically reconnecting…'
                        : 'Disconnected from chat.'}
                  </span>
                </div>
              )}
              {notice && (
                <p className="notice glass-strong" role="alert">
                  {notice}
                </p>
              )}
              {aiStatus && (
                <p className="ai-status" role="status">
                  <Sparkles size={14} className="sparkle-spin" /> {aiStatus}
                </p>
              )}

              {page === 'dashboard' && (
                <section className="reading-column">
                  <div className="dashboard-greeting glass">
                    <div className="hero-text">
                      <p className="section-kicker">YOUR STUDY DESK</p>
                      <h2>{greetingMessage(displayName)}</h2>
                      <p>
                        {needsAnswer.length
                          ? `${needsAnswer.length} ${needsAnswer.length === 1 ? 'doubt has' : 'doubts have'} no peer reply yet. Jump in to help a peer!`
                          : 'All current doubts have peer replies. Ask your next question or review solved answers.'}
                      </p>
                    </div>
                    <div className="hero-action">
                      <button className="primary-button hero-ask-btn" onClick={() => startDoubtInRoom()}>
                        <Plus size={16} strokeWidth={1.5} />
                        Ask a doubt
                      </button>
                    </div>
                  </div>

                  {Object.entries(historyErrors).map(([id, message]) => (
                    <p className="error-message glass-strong" role="alert" key={id}>
                      {rooms.find((entry) => entry.id === id)?.name ?? id}: {message}
                    </p>
                  ))}

                  <div className="metrics-row" aria-label="Study summary">
                    <div className="metric glass">
                      <span>ROOMS</span>
                      <strong>{rooms.length}</strong>
                    </div>
                    <div className="metric glass">
                      <span>OPEN DOUBTS</span>
                      <strong>{openDoubts.length}</strong>
                    </div>
                    <div className="metric glass">
                      <span>NEED REPLY</span>
                      <strong className={needsAnswer.length > 0 ? 'text-accent' : undefined}>
                        {needsAnswer.length}
                      </strong>
                    </div>
                    <div className="metric glass">
                      <span>SOLVED</span>
                      <strong className="text-solved">{solvedDoubts.length}</strong>
                    </div>
                    <div className="metric streak-metric glass">
                      <span>HELPING STREAK</span>
                      <strong>
                        <Flame size={16} className="flame-icon" strokeWidth={2} />
                        {studyStreak} <small>{studyStreak === 1 ? 'day' : 'days'}</small>
                      </strong>
                    </div>
                  </div>

                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">UNANSWERED PEER QUESTIONS</p>
                      <h2>Waiting for a classmate</h2>
                    </div>
                    <span className="section-count">{needsAnswer.length}</span>
                  </div>

                  {loadingRooms.size > 0 && doubtEntries.length === 0 ? (
                    <p className="state-message">Loading room history…</p>
                  ) : needsAnswer.length > 0 ? (
                    <div className="doubt-list glass-strong">
                      {needsAnswer.slice(0, 12).map((entry) => renderDoubt(entry, true))}
                    </div>
                  ) : (
                    renderEmpty(
                      rooms.length ? 'No doubts need a reply.' : 'No study rooms joined yet.',
                      rooms.length
                        ? 'New questions without a classmate reply will appear here.'
                        : 'Create a course room or join one with your classmates’ room code.',
                      'notebook',
                    )
                  )}

                  {rooms.length > 0 && (
                    <button className="inline-link" onClick={() => selectNavigation('rooms')}>
                      Browse all rooms <ChevronRight size={15} strokeWidth={1.5} />
                    </button>
                  )}
                </section>
              )}

              {page === 'rooms' && (
                <section className="wide-column">
                  <p className="page-description">
                    Create a subject room for your course or join with a classmate’s code.
                  </p>
                  <div className="rooms-layout">
                    <div className="rooms-panel glass">
                      <div className="section-heading">
                        <div>
                          <p className="section-kicker">SUBJECT ROOMS</p>
                          <h2>Enrolled channels</h2>
                        </div>
                        <span className="section-count">{rooms.length}</span>
                      </div>
                      {rooms.length ? (
                        <div className="room-directory glass-strong">
                          {rooms.map((entry) => {
                            const messages = messagesByRoom[entry.id] ?? [];
                            const openCount = messages.filter(
                              (message) =>
                                metaOf(message).kind === 'doubt' &&
                                metaOf(message).status !== 'solved',
                            ).length;
                            const solvedCount = messages.filter(
                              (message) =>
                                metaOf(message).kind === 'doubt' &&
                                metaOf(message).status === 'solved',
                            ).length;
                            return (
                              <button
                                className="room-directory-row"
                                key={entry.id}
                                onClick={() => openRoom(entry.id)}
                              >
                                <span className={`room-directory-mark ${subjectClass(entry.name)}`}>
                                  <BookOpen size={17} strokeWidth={1.5} />
                                </span>
                                <span className="room-directory-main">
                                  <strong>{entry.name}</strong>
                                  <small>Code: {entry.id}</small>
                                </span>
                                <span className="room-directory-counts">
                                  <span className="badge-open">{openCount} open</span>
                                  <span className="badge-solved">{solvedCount} solved</span>
                                </span>
                                <ArrowUpRight size={15} strokeWidth={1.5} />
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        renderEmpty(
                          'No rooms joined yet.',
                          'Create a room for your study group or enter an invite code.',
                          'notebook',
                        )
                      )}
                    </div>

                    <div className="room-forms">
                      <form
                        className="form-panel glass"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void create();
                        }}
                      >
                        <p className="section-kicker">NEW COURSE ROOM</p>
                        <h2>Create a room</h2>
                        <label htmlFor="room-name">Course subject name</label>
                        <input
                          id="room-name"
                          value={roomName}
                          onChange={(event) => setRoomName(event.target.value)}
                          placeholder="e.g. Physics 101 or Organic Chem"
                          maxLength={64}
                        />
                        <label htmlFor="room-code">Room code (unique)</label>
                        <input
                          id="room-code"
                          value={roomInput}
                          onChange={(event) => setRoomInput(event.target.value)}
                          placeholder="Letters and numbers only"
                          maxLength={64}
                          required
                        />
                        <label htmlFor="room-invitees">
                          Invitee student IDs <span>(optional)</span>
                        </label>
                        <input
                          id="room-invitees"
                          value={invitees}
                          onChange={(event) => setInvitees(event.target.value)}
                          placeholder="student_alice, student_bob"
                        />
                        <div className="preset-list" aria-label="Preset subjects">
                          {PRESET_SUBJECTS.map((preset) => (
                            <button
                              className="preset-button"
                              key={preset.name}
                              type="button"
                              onClick={() => {
                                setRoomName(preset.name);
                                setRoomInput(`${preset.code}${Date.now().toString(36).slice(-4)}`);
                              }}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                        <button className="primary-button" type="submit" disabled={roomWorking}>
                          <Plus size={15} strokeWidth={1.5} />
                          {roomWorking ? 'Creating…' : 'Create course room'}
                        </button>
                      </form>

                      <form
                        className="form-panel glass"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void join();
                        }}
                      >
                        <p className="section-kicker">ENTER EXISTING ROOM</p>
                        <h2>Join with room code</h2>
                        <label htmlFor="join-code">Room code or invite link</label>
                        <input
                          id="join-code"
                          value={joinCode}
                          onChange={(event) => setJoinCode(event.target.value)}
                          placeholder="e.g. physics101"
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
                      <div className="room-heading glass">
                        <div>
                          <p className="section-kicker">
                            <span className={`room-dot ${subjectClass(activeRoom.name)}`} />
                            COURSE CODE · {activeRoom.id}
                          </p>
                          <h2>{activeRoom.name}</h2>
                        </div>
                        <button
                          className="secondary-button compact"
                          onClick={() => {
                            const link = new URL(window.location.href);
                            link.searchParams.set('room', room);
                            void navigator.clipboard
                              .writeText(link.toString())
                              .then(() => setNotice('Invite link copied to clipboard.'))
                              .catch(() => setNotice(`Share this room code: ${room}`));
                          }}
                        >
                          Share room
                        </button>
                      </div>

                      {renderStatusTabs(activeEntries)}

                      {historyErrors[room] && (
                        <p className="error-message glass-strong" role="alert">
                          {historyErrors[room]}
                        </p>
                      )}

                      {loadingRooms.has(room) && !messagesByRoom[room] ? (
                        <p className="state-message">Loading room history…</p>
                      ) : filteredRoomEntries.length ? (
                        <div className="doubt-list glass-strong">
                          {filteredRoomEntries.map((entry) => renderDoubt(entry))}
                        </div>
                      ) : (
                        renderEmpty(
                          view === 'solved'
                            ? 'No solved doubts in this room yet.'
                            : 'No open doubts in this room.',
                          view === 'solved'
                            ? 'Mark a doubt solved and its solution will be stored here.'
                            : 'Post a question below to start the peer thread.',
                          'notebook',
                        )
                      )}

                      {hasOlder && (
                        <button
                          className="secondary-button load-more"
                          onClick={() => void loadOlder()}
                          disabled={loadingOlder}
                        >
                          {loadingOlder ? 'Loading older history…' : 'Load older doubts'}
                        </button>
                      )}

                      {view === 'open' && (
                        <form
                          className="composer glass-strong"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                          }}
                        >
                          {replyTo && (
                            <div className="replying-to">
                              <span>Replying to thread #{replyTo.slice(-6)}</span>
                              <button
                                type="button"
                                className="text-action"
                                onClick={() => setReplyTo(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          <textarea
                            ref={composerTextareaRef}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder={replyTo ? 'Write a peer explanation or solution…' : 'Ask your course doubt (e.g. Why does a ball thrown upward slow down?)…'}
                            maxLength={2000}
                            rows={3}
                          />
                          <div className="composer-footer">
                            <span className="composer-hint">
                              {replyTo
                                ? 'Classmate replies stay bound to this doubt.'
                                : 'Gemini will provide a first draft within seconds.'}
                            </span>
                            <button
                              className="primary-button"
                              type="submit"
                              disabled={sending || !text.trim() || connectionState !== 'connected'}
                            >
                              {sending
                                ? 'Sending…'
                                : connectionState !== 'connected'
                                  ? 'Connecting…'
                                  : replyTo
                                    ? 'Post reply'
                                    : 'Post doubt'}
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  ) : (
                    renderEmpty(
                      'Select a course room.',
                      'Open a subject room from the left navigation or join with a room code.',
                      'notebook',
                    )
                  )}
                </section>
              )}

              {page === 'my-doubts' && (
                <section className="reading-column">
                  <p className="page-description">Questions you initiated across your enrolled subjects.</p>
                  {renderStatusTabs(myDoubts)}
                  {filteredMyDoubts.length ? (
                    <div className="doubt-list glass-strong">
                      {filteredMyDoubts.map((entry) => renderDoubt(entry, true))}
                    </div>
                  ) : (
                    renderEmpty(
                      view === 'solved'
                        ? 'No solved doubts from you yet.'
                        : 'You haven’t posted any doubts yet.',
                      view === 'solved'
                        ? 'Solved threads you started will appear here in your answer archive.'
                        : 'Open a room and post your course questions to get help.',
                      'notebook',
                    )
                  )}
                </section>
              )}

              {page === 'answer-bank' && (
                <section className="reading-column">
                  <p className="page-description">
                    Searchable repository of resolved doubts and peer solutions across all subjects.
                  </p>
                  <label className="search-field glass">
                    <Search size={16} strokeWidth={1.5} />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search solved answers, formulas, or keywords…"
                      aria-label="Search solved doubts and replies"
                    />
                  </label>
                  {filteredAnswers.length ? (
                    <div className="doubt-list glass-strong">
                      {filteredAnswers.map((entry) => renderDoubt(entry, true))}
                    </div>
                  ) : (
                    renderEmpty(
                      normalizedSearch ? 'No matching solved answers found.' : 'No solved doubts in the answer bank yet.',
                      normalizedSearch
                        ? 'Try different search keywords or load older history in your rooms.'
                        : 'When doubts are marked solved by the asker, they automatically archive here.',
                      'archive',
                    )
                  )}
                  {hasOlder && (
                    <button
                      className="secondary-button load-more"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                    >
                      {loadingOlder ? 'Loading older history…' : 'Load more room history'}
                    </button>
                  )}
                </section>
              )}
            </main>
          </div>

          <nav className="mobile-nav glass" aria-label="Main navigation">
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
          <section
            className="search-dialog glass-strong"
            role="dialog"
            aria-modal="true"
            aria-label="Search DoubtDesk Answer Bank"
          >
            <div className="search-dialog-input">
              <Search size={18} strokeWidth={1.5} />
              <input
                ref={searchInputRef}
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Search across all doubts and answers…"
                aria-label="Search doubts and replies"
              />
              <button
                className="icon-action"
                aria-label="Close search"
                onClick={() => setSearchOpen(false)}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="search-results">
              {normalizedGlobalSearch ? (
                globalResults.length ? (
                  globalResults.map((entry) => (
                    <button
                      className="search-result"
                      key={entry.doubt.messageId}
                      onClick={() => openSearchResult(entry)}
                    >
                      <span
                        className={
                          metaOf(entry.doubt).status === 'solved'
                            ? 'status-label is-solved'
                            : 'status-label'
                        }
                      >
                        {metaOf(entry.doubt).status === 'solved' ? 'SOLVED' : 'OPEN'}
                      </span>
                      <span className="search-result-copy">
                        <strong>{textOf(entry.doubt)}</strong>
                        <small>
                          {entry.room.name} · {entry.replies.length} replies
                        </small>
                      </span>
                      <ArrowUpRight size={15} strokeWidth={1.5} />
                    </button>
                  ))
                ) : (
                  <p className="search-hint">No matching doubts or answers found.</p>
                )
              ) : (
                <p className="search-hint">Type any formula, concept, or doubt to search loaded room history.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
