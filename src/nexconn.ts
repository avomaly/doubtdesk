import {
  NCEngine,
  ConnectionStatusHandler,
  MessageHandler,
  ConnectionStatus,
} from '@nexconn/chat';

type Listener = () => void;
export type ConnectionStatusType = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

const activityListeners = new Set<Listener>();
const statusListeners = new Set<(status: ConnectionStatusType) => void>();
let initialized = false;
let currentToken: string | null = null;
let connectingPromise: Promise<string> | null = null;
let currentStatus: ConnectionStatusType = 'disconnected';

export function getConnectionState(): ConnectionStatusType {
  return currentStatus;
}

export function onConnectionStateChange(fn: (status: ConnectionStatusType) => void) {
  statusListeners.add(fn);
  fn(currentStatus);
  return () => {
    statusListeners.delete(fn);
  };
}

function updateStatus(status: ConnectionStatusType) {
  if (currentStatus === status) return;
  currentStatus = status;
  statusListeners.forEach((fn) => fn(status));
}

export function onActivity(fn: Listener) {
  activityListeners.add(fn);
  return () => {
    activityListeners.delete(fn);
  };
}

function notify() {
  activityListeners.forEach((fn) => fn());
}

export function initNexconn(overrideKey?: string) {
  if (initialized) return;
  const appKey =
    overrideKey ||
    (typeof window !== 'undefined' ? window.sessionStorage?.getItem('doubtdesk.appKey') : null) ||
    import.meta.env.VITE_NEXCONN_APP_KEY;
  if (!appKey) return;
  NCEngine.initialize({ appKey });

  NCEngine.addConnectionStatusHandler(
    'doubtdesk',
    new ConnectionStatusHandler({
      onConnectionStatusChanged({ status, code }) {
        if (status === ConnectionStatus.CONNECTED) {
          updateStatus('connected');
        } else if (status === ConnectionStatus.CONNECTING) {
          updateStatus('connecting');
        } else if (status === ConnectionStatus.SUSPENDED) {
          updateStatus('reconnecting');
        } else {
          updateStatus('disconnected');
        }
        if (code === 31020 || code === 31005) {
          updateStatus('disconnected');
        }
      },
    })
  );

  NCEngine.addMessageHandler(
    'doubtdesk',
    new MessageHandler({
      onMessageReceived() {
        notify();
      },
      onMessageMetadataUpdated() {
        notify();
      },
      onMessageMetadataDeleted() {
        notify();
      },
    })
  );
  initialized = true;
}

export function connectUser(token: string, overrideKey?: string): Promise<string> {
  initNexconn(overrideKey);
  if (connectingPromise && currentToken === token) {
    return connectingPromise;
  }
  currentToken = token;
  updateStatus('connecting');
  connectingPromise = NCEngine.connect({ token })
    .then((res) => {
      if (res.code === 0 && res.data) {
        updateStatus('connected');
        return res.data.userId;
      }
      updateStatus('disconnected');
      connectingPromise = null;
      currentToken = null;
      if (res.code === 31020) throw new Error('Your chat session expired. Please sign in again.');
      throw new Error(`Connect failed (Code: ${res.code})`);
    })
    .catch((err) => {
      connectingPromise = null;
      currentToken = null;
      updateStatus('disconnected');
      throw err;
    });
  return connectingPromise;
}

export async function disconnectUser(): Promise<void> {
  connectingPromise = null;
  currentToken = null;
  updateStatus('disconnected');
  try {
    await NCEngine.disconnect();
  } catch (err) {
    console.warn('NCEngine.disconnect error:', err);
  }
}
