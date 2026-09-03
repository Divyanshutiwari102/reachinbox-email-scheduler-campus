'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { Clock, MessageSquare, Archive, LogOut, Search } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import apiFetch from '@/lib/apiFetch';

interface SidebarProps {
  session: any;
  pathname: string;
  counts: { scheduled: number; sent: number; archived: number };
  loading: boolean;
  fetchCounts: () => Promise<void>;
}

export default function Sidebar({ session, pathname, counts, loading, fetchCounts }: SidebarProps) {
  const router = useRouter();

  // Determine active tab based on pathname
  const isScheduled = pathname === '/dashboard/scheduled' || pathname.startsWith('/dashboard/scheduled/');
  const isSent = pathname === '/dashboard/sent' || pathname.startsWith('/dashboard/sent/');
  const isArchived = pathname === '/dashboard/archived' || pathname.startsWith('/dashboard/archived/');
  const isSearch = pathname === '/dashboard/search';

  // Listen for email data changes to update counts in real-time
  useEffect(() => {
    const handleEmailDataChanged = () => {
      fetchCounts();
    };
    window.addEventListener('email-data-changed', handleEmailDataChanged);
    return () => {
      window.removeEventListener('email-data-changed', handleEmailDataChanged);
    };
  }, [fetchCounts]); // refetch when pathname changes (navigate)

  const handleLogout = async () => {
    try {
      await signOut({ redirect: false });
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    // Show skeleton counts while loading
    return (
      <aside className="w-64 flex-shrink-0 h-screen sticky top-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
        <div className="p-4">
          <h1 className="text-xl font-bold tracking-tight">RIS</h1>
        </div>
        <Link href="/dashboard/profile" className="flex items-center p-4 space-x-3 border-b border-gray-200 cursor-pointer hover:bg-gray-50">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-full bg-emerald-50 flex items-center justify-center cursor-pointer">
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt={`${session.user.name}'s avatar`}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
              ) : (
                <span className="text-gray-600">?</span>
              )}
            </div>
            <div className="space-y-1 min-w-0">
              <p className="font-medium">{session?.user?.name ?? 'Demo User'}</p>
              <p className="text-sm text-gray-500 truncate" title={session?.user?.email ?? 'user@example.com'}>
                {session?.user?.email ?? 'user@example.com'}
              </p>
            </div>
          </div>
        </Link>
        <div className="mx-4 my-4">
          <p className="text-xs font-medium text-gray-500 uppercase">CORE</p>
        </div>
        <nav className="flex-1 overflow-y-auto">
          <Link
            href="/dashboard/compose"
            className="flex items-center justify-center px-4 py-2 mt-4 mx-4 rounded-lg border border-emerald-600 text-emerald-600 hover:bg-emerald-50 font-medium transition-colors"
          >
            Compose
            Compose
          </Link>
          <Link
            href="/dashboard/search"
            className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isSearch ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
          >
            <Search className="mr-3 h-4 w-4" />
            <span>Search</span>
          </Link>
          <Link
            href="/dashboard/scheduled"
            className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isScheduled ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
          >
            <Clock className="mr-3 h-4 w-4" />
            <span>Scheduled</span>
            <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
              {/* Skeleton for scheduled count */}
              <div className="h-2 w-16 bg-gray-200 rounded" />
            </span>
          </Link>
          <Link
            href="/dashboard/sent"
            className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isSent ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
          >
            <MessageSquare className="mr-3 h-4 w-4" />
            <span>Sent</span>
            <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
              {/* Skeleton for sent count */}
              <div className="h-2 w-16 bg-gray-200 rounded" />
            </span>
          </Link>
          <Link
            href="/dashboard/archived"
            className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isArchived ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
          >
            <Archive className="mr-3 h-4 w-4" />
            <span>Archived</span>
            <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
              {/* Skeleton for archived count */}
              <div className="h-2 w-16 bg-gray-200 rounded" />
            </span>
          </Link>
        </nav>
      </aside>
    );
  }

  return (
    <aside className="w-64 flex-shrink-0 h-screen sticky top-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
      <div className="p-4">
        <h1 className="text-xl font-bold tracking-tight">RIS</h1>
      </div>
      <Link href="/dashboard/profile" className="flex items-center p-4 space-x-3 border-b border-gray-200 cursor-pointer hover:bg-gray-50">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-full bg-emerald-50 flex items-center justify-center cursor-pointer">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt={`${session.user.name}'s avatar`}
                width={40}
                height={40}
                className="rounded-full"
              />
            ) : (
              <span className="text-gray-600">?</span>
            )}
          </div>
          <div className="space-y-1 min-w-0">
            <p className="font-medium">{session?.user?.name ?? 'Demo User'}</p>
            <p className="text-sm text-gray-500 truncate" title={session?.user?.email ?? 'user@example.com'}>
              {session?.user?.email ?? 'user@example.com'}
            </p>
          </div>
        </div>
      </Link>
      <button
        onClick={handleLogout}
        className="ml-4 flex h-10 w-10 items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg border border-red-200 transition-colors"
      >
        <LogOut className="mr-2 h-4 w-4" />
        <span className="sr-only">Logout</span>
      </button>
      <Link
        href="/dashboard/compose"
        className="flex items-center justify-center px-4 py-2 mt-4 mx-4 rounded-lg border border-emerald-600 text-emerald-600 hover:bg-emerald-50 font-medium transition-colors"
      >
        Compose
      </Link>
      <div className="mx-4 my-4">
        <p className="text-xs font-medium text-gray-500 uppercase">CORE</p>
      </div>
      <nav className="flex-1 overflow-y-auto">
        <Link
          href="/dashboard/scheduled"
          className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isScheduled ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
        >
          <Clock className="mr-3 h-4 w-4" />
          <span>Scheduled</span>
          <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
            {counts.scheduled}
          </span>
        </Link>
        <Link
          href="/dashboard/sent"
          className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isSent ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
        >
          <MessageSquare className="mr-3 h-4 w-4" />
          <span>Sent</span>
          <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
            {counts.sent}
          </span>
        </Link>
        <Link
          href="/dashboard/archived"
          className={`flex w-full items-center px-4 py-2 text-sm font-medium rounded-lg ${isArchived ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
        >
          <Archive className="mr-3 h-4 w-4" />
          <span>Archived</span>
          <span className="ml-auto inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
            {counts.archived}
          </span>
        </Link>
      </nav>
    </aside>
  );
}