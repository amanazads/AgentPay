import React, { useState, useEffect } from 'react';
import Header from './Header';
import MobileNav from './MobileNav';
import { api } from '../../services/api';
import { io } from 'socket.io-client';

export default function Layout({ children }) {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetchPendingApprovals();

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';
    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    socket.on('approval:created', () => fetchPendingApprovals());
    socket.on('approval:decided', () => fetchPendingApprovals());
    socket.on('connect_error', () => {
      // Graceful fallback without console spam
    });

    return () => {
      socket.off('approval:created');
      socket.off('approval:decided');
      socket.disconnect();
    };
  }, []);

  const fetchPendingApprovals = async () => {
    try {
      const res = await api.getApprovals('pending');
      if (res && res.approvals) {
        setPendingCount(res.approvals.length);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      <Header pendingCount={pendingCount} />
      <main style={{ flex: 1 }}>
        {children}
      </main>
      <MobileNav pendingCount={pendingCount} />
    </div>
  );
}
