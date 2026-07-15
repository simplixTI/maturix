import { io, type Socket } from 'socket.io-client';

// Single shared Socket.IO connection to the backend for realtime events:
//   session:status, session:qr, session:pairing-code, alert:new,
//   log:entry, metrics:update
// In dev, the Vite proxy forwards /socket.io to :3000 at the page origin.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function subscribeAccount(accountId: string): void {
  getSocket().emit('subscribe:account', accountId);
}

export function unsubscribeAccount(accountId: string): void {
  getSocket().emit('unsubscribe:account', accountId);
}
