'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import apiFetch from '@/lib/apiFetch';

interface Sender {
  id: string;
  email: string;
  name: string | null;
}

interface SenderContextProps {
  sender: Sender | null;
  setSender: (sender: Sender | null) => void;
}

const SenderContext = createContext<SenderContextProps | undefined>(undefined);

export const SenderProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session, status } = useSession();
  const [sender, setSender] = useState<Sender | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      // Call the backend to ensure the sender exists and get the sender id
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/senders/ensure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: session.user.email,
          name: session.user.name || null,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to ensure sender: ${res.status}`);
          }
          const data = await res.json();
          setSender({
            id: data.id,
            email: data.email,
            name: data.name,
          });
        })
        .catch((err) => {
          console.error('Error ensuring sender:', err);
        });
    } else if (status === 'unauthenticated') {
      setSender(null);
    }
  }, [session?.user?.email, status]);

  return (
    <SenderContext.Provider value={{ sender, setSender }}>
      {children}
    </SenderContext.Provider>
  );
};

export const useSender = () => {
  const context = useContext(SenderContext);
  if (context === undefined) {
    throw new Error('useSender must be used within a SenderProvider');
  }
  return context;
};