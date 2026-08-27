import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
  }
  return socket;
}

export function useSocket(event, callback) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const s = getSocket();
    const handler = (...args) => savedCallback.current(...args);
    s.on(event, handler);
    return () => s.off(event, handler);
  }, [event]);
}

export function useSocketRoom(room) {
  useEffect(() => {
    const s = getSocket();
    s.emit(`join:${room}`);
    return () => s.emit(`leave:${room}`);
  }, [room]);
}

export function emitSocket(event, data) {
  const s = getSocket();
  s.emit(event, data);
}

export default useSocket;
