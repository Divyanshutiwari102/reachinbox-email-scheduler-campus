'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the scheduled view as the default dashboard
    router.replace('/dashboard/scheduled');
  }, [router]);

  return null; // Nothing to render – we redirect immediately
}