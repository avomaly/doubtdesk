import {
  NCEngine,
  ConnectionStatusHandler,
  MessageHandler,
} from '@nexconn/chat';

type Listener = () => void;
const listeners = new Set<Listener>();
let initialized = false;
let connecting: Promise<string> | null = null;

export function onActivity(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function initNexconn() {
  if (initialized) return;
  NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY });

  NCEngine.addConnectionStatusHandler(
    'doubtdesk',
    new ConnectionStatusHandler({
      onConnectionStatusChanged({ status, code }) {
        console.log('Connection status:', status, 'code:', code);
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

export function connectUser(token: string): Promise<string> {
  initNexconn();
  if (!connecting) {
    connecting = NCEngine.connect({ token }).then((res) => {
      if (res.code === 0 && res.data) return res.data.userId;
      throw new Error(`Connect failed. Code: ${res.code}`);
    });
    connecting.catch(() => {
      connecting = null;
    });
  }
  return connecting;
}