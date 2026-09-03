'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { SenderProvider } from '@/context/SenderContext';
import apiFetch from '@/lib/apiFetch';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [counts, setCounts] = useState({ scheduled: 0, sent: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const { data: session } = useSession();
  const router = useRouter();

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const [scheduledRes, sentRes] = await Promise.all([
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/scheduled`),
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/sent`),
      ]);
      const scheduledData = await scheduledRes.json();
      const sentData = await sentRes.json();

      // Scheduled endpoint already excludes archived emails (is_archived = false)
      const scheduledCount = scheduledData.length;

      // Sent endpoint returns both archived and non-archived; exclude archived for sent count
      const sentCount = sentData.filter((email: any) => !email.is_archived).length;

      // Archived count: emails with is_archived = true (from sent data; scheduled data has none)
      // For safety, also check scheduled data (should be zero)
      const archivedCount = [...scheduledData, ...sentData].filter(email => email.is_archived).length;

      setCounts({
        scheduled: scheduledCount,
        sent: sentCount,
        archived: archivedCount,
      });
    } catch (err) {
      console.error('Failed to fetch counts:', err);
      // In case of error, fall back to zero counts (or keep previous?)
      setCounts({ scheduled: 0, sent: 0, archived: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  
  // Determine active tab based on pathname
  const isScheduled = pathname === '/dashboard/scheduled' || pathname.startsWith('/dashboard/scheduled/');
  const isSent = pathname === '/dashboard/sent' || pathname.startsWith('/dashboard/sent/');
  const isArchived = pathname === '/dashboard/archived' || pathname.startsWith('/dashboard/archived/');

  // Fetch counts from API on mount and when pathname changes
  useEffect(() => {
    fetchCounts();
  }, [pathname, fetchCounts]);

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

  return (
    <SenderProvider>
      <div className="flex min-h-screen bg-white">
        <Sidebar
          session={session}
          pathname={pathname}
          counts={counts}
          loading={loading}
          fetchCounts={fetchCounts}
        />
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </SenderProvider>
  );
}