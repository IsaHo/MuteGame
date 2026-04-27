import { io } from 'socket.io-client';

const socket = io('/', { transports: ['websocket'], autoConnect: true });
export default socket;
