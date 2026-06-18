import { io } from 'socket.io-client';

// Token is read on every (re)connect via the `auth` function so a fresh login
// upgrades the socket from anonymous to admin without rebuilding the singleton.
const socket = io('/', {
  transports: ['websocket'],
  autoConnect: true,
  auth: (cb) => {
    try { cb({ token: localStorage.getItem('mg_token') || '' }); }
    catch { cb({ token: '' }); }
  },
});

// Call after the JWT in localStorage changes (login / logout) so the server's
// handshake middleware re-tags this socket with the new role.
export const refreshSocketAuth = () => {
  try {
    if (socket.connected) socket.disconnect();
    socket.connect();
  } catch {}
};

export default socket;
