'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ChevronDown, Clock, MessageSquare, Search, RefreshCw, Filter, Star, Archive, Trash } from 'lucide-react';
import apiFetch from '@/lib/apiFetch';

interface Email {
  id: string;
  sender_id: string;
  recipient: string;
  subject: string;
  content: string;
  scheduled_at: string; // ISO string
  sent_at: string | null;
  status: 'pending' | 'sent' | 'failed';
  idempotency_key: string;
  bullmq_job_id: string | null;
  created_at: string;
  updated_at: string;
  rate_limited_count?: number;
  is_starred?: boolean;
  is_archived?: boolean;
  formattedTime?: string;
}

interface Props {
  type: 'scheduled' | 'sent' | 'archived';
}

export default function EmailList({ type }: Props) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Sent' | 'Failed'>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Format date to relative time or time string
  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Fetch emails based on type, search, and filter
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        let data: Email[] = [];
        if (debouncedSearchTerm.trim() === '') {
          // Not searching
          if (type === 'archived') {
            // For archived type, we fetch both scheduled and sent and then filter by is_archived
            const [scheduleRes, sentRes] = await Promise.all([
              apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/scheduled`),
              apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/sent`),
            ]);
            if (!scheduleRes.ok || !sentRes.ok) {
              throw new Error('Failed to fetch emails');
            }
            const scheduled: Email[] = await scheduleRes.json();
            const sent: Email[] = await sentRes.json();
            if (!Array.isArray(scheduled) || !Array.isArray(sent)) {
              throw new Error('Unexpected response format');
            }
            data = [...scheduled, ...sent];
          } else if (type === 'sent') {
            // For sent type, we can use the filter to specify status
            let url = `${process.env.NEXT_PUBLIC_API_URL || ''}/emails/sent`;
            if (filter && filter !== 'All') {
              url += `?status=${filter.toLowerCase()}`;
            }
            const res = await apiFetch(url);
            if (!res.ok) {
              throw new Error(`Request failed with status ${res.status}`);
            }
            const fetchedData: Email[] = await res.json();
            if (!Array.isArray(fetchedData)) {
              throw new Error('Unexpected response format');
            }
            data = fetchedData;
          } else {
            // scheduled type
            const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${type}`);
            if (!res.ok) {
              throw new Error(`Request failed with status ${res.status}`);
            }
            const fetchedData: Email[] = await res.json();
            if (!Array.isArray(fetchedData)) {
              throw new Error('Unexpected response format');
            }
            data = fetchedData;
          }
        } else {
          // Searching
          const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/search?q=${encodeURIComponent(debouncedSearchTerm)}&type=${type}`);
          if (!res.ok) {
            throw new Error(`Request failed with status ${res.status}`);
          }
          const fetchedData: Email[] = await res.json();
          if (!Array.isArray(fetchedData)) {
            throw new Error('Unexpected response format');
          }
          data = fetchedData;
        }

        const formatted = data.map((email) => ({
          ...email,
          formattedTime: email.sent_at ? formatTime(email.sent_at) : formatTime(email.scheduled_at),
        }));
        setEmails(formatted);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to load emails');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [type, debouncedSearchTerm, filter]);

  // Show toast for a few seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, toastType]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <input
              type="search"
              placeholder="Search emails..."
              className="w-full bg-gray-50 rounded-full px-4 py-2 pl-10 text-sm focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
          </div>
          <div className="flex gap-2">
            {type !== 'archived' && (
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100"
              >
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Sent">Sent</option>
                <option value="Failed">Failed</option>
              </select>
            )}
            <button className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex space-x-4">
              <div className="h-6 w-20 bg-gray-200 rounded"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-48"></div>
                <div className="h-4 bg-gray-200 rounded w-64"></div>
                <div className="h-4 bg-gray-200 rounded w-32"></div>
              </div>
              <div className="h-6 w-6 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <div className="p-6 text-red-500">{error}</div>;

  const isEmpty = emails.length === 0;

  // Filter emails based on selected filter, search term, and archived/deleted state
  const filteredEmails = emails.filter((email) => {
    // For archived type, we want to show only archived emails
    if (type === 'archived') {
      if (!email.is_archived) {
        return false;
      }
    } else {
      // For scheduled and sent types, we exclude archived emails
      if (email.is_archived) {
        return false;
      }

      // Status filter (only applies when not searching and type is sent)
      if (type === 'sent' && debouncedSearchTerm.trim() === '' && filter !== 'All') {
        if (email.status !== filter.toLowerCase()) {
          return false;
        }
      }
    }

    // Search term filter (case-insensitive)
    if (debouncedSearchTerm.trim() !== '') {
      const term = debouncedSearchTerm.toLowerCase();
      const matchesRecipient = email.recipient?.toLowerCase().includes(term) ?? false;
      const matchesSubject = email.subject?.toLowerCase().includes(term) ?? false;
      const matchesContent = email.content?.toLowerCase().includes(term) ?? false;
      if (!matchesRecipient && !matchesSubject && !matchesContent) {
        return false;
      }
    }

    return true;
  });

  const isFilteredEmpty = filteredEmails.length === 0;

  return (
    <div className="space-y-4">
      {toastMessage && (
        <div className={`px-4 py-3 rounded mb-4 ${
          toastType === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          {toastMessage}
        </div>
      )}
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <input
            type="search"
            placeholder="Search emails..."
            className="w-full bg-gray-50 rounded-full px-4 py-2 pl-10 text-sm focus:ring-2 focus:ring-emerald-500 focus:bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
        </div>
        <div className="flex gap-2">
          {type !== 'archived' && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100"
            >
              <option value="All">All</option>
              <option value="Pending">Pending</option>
              <option value="Sent">Sent</option>
              <option value="Failed">Failed</option>
            </select>
          )}
          <button className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 text-gray-600" />
          </button>
        </div>
      </div>

      {isFilteredEmpty ? (
        <div className="text-center py-16">
          <div className="mx-auto h-16 w-16 text-gray-500 mb-6">
            {type === 'scheduled' ? <Clock className="h-6 w-6" /> : type === 'sent' ? <MessageSquare className="h-6 w-6" /> : <Archive className="h-6 w-6" />}
          </div>
          <p className="text-base text-gray-600">
            {type === 'scheduled'
              ? 'No scheduled emails yet'
              : type === 'sent'
                ? 'No sent emails yet'
                : 'No archived emails yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEmails.map((email) => {
            return (
              <Link key={email.id} href={`/dashboard/email/${email.id}`} className="flex space-x-4 items-start py-3 border-b border-gray-200 last:border-b-0">
                <div className="flex-shrink-0">
                  {type === 'scheduled' ? (
                    <>
                      <span className="inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                        <Clock className="h-3 w-3 mr-1" />
                        {email.formattedTime}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={`inline-flex items-center px-2.5 rounded-full text-xs font-medium ${
                        email.status === 'sent' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                      }`}>
                        {email.status === 'sent' ? 'Sent' : 'Failed'}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex-col flex-1 space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {type === 'scheduled' ? (
                      <>
                        <span className="inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          <Clock className="h-3 w-3 mr-1" />
                          {email.formattedTime}
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                        Sent
                      </span>
                    )}
                    {email.rate_limited_count && email.rate_limited_count > 0 ? (
                      <span className="inline-flex items-center px-2.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        Rescheduled {email.rate_limited_count}x
                      </span>
                    ) : null}
                  </div>
                  <p className="line-clamp-1 font-medium">{email.subject}</p>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    - {email.content?.split('\n')[0].slice(0, 100)}
                    {email.content?.length > 100 ? '...' : ''}
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center space-x-2">
                  <Star
                    className={`h-4 w-4 ${email.is_starred ? 'text-yellow-400' : 'text-gray-400'} hover:text-yellow-400`}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent triggering the link navigation
                      const updatedEmails = emails.map((e) =>
                        e.id === email.id ? { ...e, is_starred: !e.is_starred } : e
                      );
                      setEmails(updatedEmails);
                      // Optimistically update, then make API call
                      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${email.id}/star`, {
                        method: 'PATCH',
                      })
                        .then(async (res) => {
                          if (!res.ok) {
                            throw new Error(`Failed to toggle star: ${res.status}`);
                          }
                          // Optionally, we could re-fetch to get the latest state, but we trust the API
                          // We'll show a success toast
                          setToastMessage('Star updated successfully');
                          setToastType('success');
                          window.dispatchEvent(new Event('email-data-changed'));
                        })
                        .catch((err) => {
                          console.error('Error toggling star:', err);
                          // Revert the optimistic update
                          setEmails(emails);
                          setToastMessage('Failed to update star');
                          setToastType('error');
                        });
                    }}
                  />
                  <Archive
                    className={`h-4 w-4 ${email.is_archived ? 'text-blue-400' : 'text-gray-400'} hover:text-blue-400`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const updatedEmails = emails.map((e) =>
                        e.id === email.id ? { ...e, is_archived: true } : e
                      );
                      setEmails(updatedEmails);
                      // If we are not in the archived type, remove the email from the list after a short delay
                      // to show a smooth transition (optional)
                      // We'll make the API call and then update the state again on success
                      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${email.id}/archive`, {
                        method: 'PATCH',
                      })
                        .then(async (res) => {
                          if (!res.ok) {
                            throw new Error(`Failed to archive: ${res.status}`);
                          }
                          // Re-fetch the list to get the latest state (including is_archived from backend)
                          // We'll also show a toast
                          setToastMessage('Email archived successfully');
                          setToastType('success');
                          window.dispatchEvent(new Event('email-data-changed'));
                          // Trigger a refetch by toggling a dummy state? We'll just call fetchData again
                          // But we don't have access to fetchData here. We'll instead update the emails state by removing the email if not in archived type
                          // For simplicity, we'll just show the toast and let the user navigate or wait for next fetch.
                          // Alternatively, we can refetch by keying the fetch effect on something else, but we don't want to overcomplicate.
                          // We'll do nothing here; the email will still show as archived in the UI due to the optimistic update.
                          // When the user navigates away and back, it will fetch fresh data.
                        })
                        .catch((err) => {
                          console.error('Error archiving email:', err);
                          // Revert the optimistic update
                          setEmails(emails);
                          setToastMessage('Failed to archive email');
                          setToastType('error');
                        });
                    }}
                  />
                  <Trash
                    className={`h-4 w-4 hover:text-red-400`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          'Are you sure you want to delete this email? This action cannot be undone.'
                        )
                      ) {
                        // Optimistically remove the email from the list
                        setEmails(emails.filter((e) => e.id !== email.id));
                        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${email.id}`, {
                          method: 'DELETE',
                        })
                          .then(async (res) => {
                            if (!res.ok) {
                              throw new Error(`Failed to delete: ${res.status}`);
                            }
                            setToastMessage('Email deleted successfully');
                            setToastType('success');
                            window.dispatchEvent(new Event('email-data-changed'));
                            // We could re-fetch here, but we already removed it optimistically.
                            // To be safe, we can re-fetch to confirm, but we'll trust the DELETE.
                          })
                          .catch((err) => {
                            console.error('Error deleting email:', err);
                            // Revert the optimistic update
                            setEmails([email, ...emails]);
                            setToastMessage('Failed to delete email');
                            setToastType('error');
                          });
                      }
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}