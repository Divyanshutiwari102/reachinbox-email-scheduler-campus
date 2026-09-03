'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import { useSender } from '@/context/SenderContext';
import apiFetch from '@/lib/apiFetch';
import { useState, useEffect } from 'react';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut({ redirect: false });
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const { sender } = useSender();
  const [slackStatus, setSlackStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');

  useEffect(() => {
    if (!sender?.id) {
      setSlackStatus('disconnected');
      return;
    }

    const fetchSlackStatus = async () => {
      try {
        const res = await apiFetch(`/senders/me/slack-status`);
        const data = await res.json();
        setSlackStatus(data.connected ? 'connected' : 'disconnected');
      } catch (err) {
        console.error('Failed to fetch Slack status:', err);
        setSlackStatus('disconnected');
      }
    };

    fetchSlackStatus();
  }, [sender?.id]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-12 w-12 border-2 border-gray-300 rounded-full flex items-center justify-center">
            <span className="text-gray-400">?</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Back link */}
        <div className="flex items-center space-x-2">
          <Link href="/dashboard/scheduled">
            <ArrowLeft className="h-4 w-4 text-gray-500 hover:text-gray-700" />
          </Link>
          <span className="text-sm font-medium text-gray-700">Back to Dashboard</span>
        </div>

        {/* Profile card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* Avatar */}
          <div className="flex items-center justify-center">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt={`${session.user.name}'s avatar`}
                width={80}
                height={80}
                className="rounded-full"
              />
            ) : (
              <div className="h-20 w-20 rounded-full bg-emerald-50 flex items-center justify-center text-gray-600 text-2xl font-medium">
                ?
              </div>
            )}
          </div>

          {/* Name and email */}
          <div className="space-y-2 text-center">
            <p className="text-xl font-bold text-gray-900">{session?.user?.name ?? 'Demo User'}</p>
            <p className="text-sm text-gray-500">{session?.user?.email ?? 'user@example.com'}</p>
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg border border-red-200 transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Integrations card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Integrations
          </h3>
          {slackStatus === 'loading' ? (
            <p className="text-gray-500">Loading Slack connection status...</p>
          ) : slackStatus === 'connected' ? (
            <p className="flex items-center text-green-600">
              ✓ Slack Connected
            </p>
          ) : (
            <button
              onClick={() => {
                window.location.href = `${process.env.NEXT_PUBLIC_API_URL || ''}/slack/oauth/start?senderId=${sender?.id}`;
              }}
              disabled={!sender?.id}
              className="w-full flex items-center justify-center px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-600 font-medium rounded-lg border border-purple-200 transition-colors"
            >
              {sender?.id ? 'Connect Slack' : 'Loading...'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}