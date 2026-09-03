'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Star, Archive, Trash2, ChevronDown, Paperclip } from 'lucide-react';
import { useRouter } from 'next/navigation';
import apiFetch from '@/lib/apiFetch';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

interface Email {
  id: string;
  sender_id: string;
  recipient: string;
  subject: string;
  content: string;
  scheduled_at: string;
  sent_at: string | null;
  status: 'pending' | 'sent' | 'failed';
  idempotency_key: string;
  bullmq_job_id: string | null;
  created_at: string;
  updated_at: string;
  rate_limited_count?: number;
  is_starred?: boolean;
  is_archived?: boolean;
  sender_email?: string;
  sender_name?: string;
}

export default function EmailDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendAgainSuccess, setSendAgainSuccess] = useState<boolean>(false);
  const [sendAgainError, setSendAgainError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const { data: session } = useSession();
  const router = useRouter();

  const formatDate = (isoString: string): string => {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(isoString).toLocaleDateString(undefined, options);
  };

  useEffect(() => {
    const fetchEmail = async () => {
      setLoading(true);
      setError(null);
      try {
                const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${id}`);
                if (res.status === 404) {
                  setError('Email not found');
                  setLoading(false);
                  return;
                }
                if (!res.ok) {
                  throw new Error('Failed to fetch email');
                }
                const data: Email = await res.json();
                setEmail(data);
                setLoading(false);
          } catch (err) {
            console.error(err);
            setError('Failed to load email');
            setLoading(false);
          }
      };

      fetchEmail();
    }, [id]);

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-500">{error}</div>;
  }

  if (!email) {
    notFound();
  }

  const isStarred = email.is_starred ?? false;
  const isArchived = email.is_archived ?? false;

  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  const senderInitials = getInitials(email.sender_name || email.sender_email || '?');

  const toggleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedEmail = { ...email, is_starred: !isStarred };
    setEmail(updatedEmail);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${id}/star`, { method: 'PATCH' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to toggle star: ${res.status}`);
        setToastMessage('Star updated successfully');
        setToastType('success');
        window.dispatchEvent(new Event('email-data-changed'));
      })
      .catch((err) => {
        console.error('Error toggling star:', err);
        setEmail(email);
        setToastMessage('Failed to update star');
        setToastType('error');
      });
  };

  const toggleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newArchivedState = !isArchived;
    const updatedEmail = { ...email, is_archived: newArchivedState };
    setEmail(updatedEmail);
    const endpoint = newArchivedState ? 'archive' : 'unarchive';
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${id}/${endpoint}`, { method: 'PATCH' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to ${endpoint}: ${res.status}`);
        setToastMessage(newArchivedState ? 'Email archived successfully' : 'Email unarchived successfully');
        setToastType('success');
        window.dispatchEvent(new Event('email-data-changed'));
      })
      .catch((err) => {
        console.error(`Error ${endpoint}ing email:`, err);
        setEmail(email);
        setToastMessage(`Failed to ${endpoint} email`);
        setToastType('error');
      });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this email? This action cannot be undone.')) {
      return;
    }
    setEmail(null);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${id}`, { method: 'DELETE' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
        setToastMessage('Email deleted successfully');
        setToastType('success');
        window.dispatchEvent(new Event('email-data-changed'));
        setTimeout(() => {
          router.push('/dashboard/sent');
        }, 1500);
      })
      .catch((err) => {
        console.error('Error deleting email:', err);
        setEmail(email);
        setToastMessage('Failed to delete email');
        setToastType('error');
      });
  };

  const handleResend = (e: React.MouseEvent) => {
    e.stopPropagation();
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/emails/${id}/resend`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to resend: ${res.status}`);
        setSendAgainSuccess(true);
        setSendAgainError(null);
        setToastMessage('Email resent successfully');
        setToastType('success');
        window.dispatchEvent(new Event('email-data-changed'));
        setTimeout(() => {
          router.push('/dashboard/sent');
        }, 1500);
      })
      .catch((err) => {
        console.error('Error resending email:', err);
        setSendAgainSuccess(false);
        setSendAgainError(err.message || 'Unknown error');
        setToastMessage('Failed to resend email');
        setToastType('error');
      });
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      {toastMessage && (
        <div className={`px-4 py-3 rounded mb-4 ${
          toastType === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          {toastMessage}
        </div>
      )}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center space-x-3">
          <ArrowLeft className="h-5 w-5 text-gray-500 hover:text-gray-700" onClick={() => router.back()} />
          <h1 className="text-xl font-bold">{email.subject}</h1>
        </div>
        <div className="flex items-center space-x-3">
          <Star
            className={`h-4 w-4 ${isStarred ? 'text-yellow-400' : 'text-gray-400'} hover:text-yellow-400`}
            onClick={toggleStar}
          />
          <Archive
            className={`h-4 w-4 ${isArchived ? 'text-blue-400' : 'text-gray-400'} hover:text-blue-400`}
            onClick={toggleArchive}
          />
          <Trash2
            className="h-4 w-4 text-gray-400 hover:text-red-400"
            onClick={handleDelete}
          />
          <div className="relative">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt="Avatar"
                width={40}
                height={40}
                className="rounded-full"
              />
            ) : (
              <span className="text-gray-600">?</span>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center mb-2">
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt="Avatar"
              width={32}
              height={32}
              className="rounded-full mr-2"
            />
          ) : (
            <span className="text-gray-600 mr-2">?</span>
          )}
          <div>
            <p className="font-medium">{email.sender_name || email.sender_email || 'Unknown Sender'}
{email.sender_email ? ` <${email.sender_email}>` : ''}</p>
            <p className="text-sm text-gray-500 flex items-center">
              To: {email.recipient?.replace(/,/g, ', ') || 'Unknown'} <ChevronDown className="ml-1 h-3 w-3" /> {formatDate(email.scheduled_at)}
            </p>
          </div>
        </div>
        <p className="text-right text-sm text-gray-500">{formatDate(email.scheduled_at)}</p>
      </div>

      <div className="prose prose-sm max-w-none">
        {email.content.split('\n\n').map((para, idx) => (
          <p key={idx}>{para}</p>
        ))}
      </div>

      <div className="mt-6">
        <h2 className="font-semibold mb-2">Attachments</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-gray-200 rounded flex items-center justify-center">
                <Paperclip className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="font-medium">document.pdf</p>
                <p className="text-sm text-gray-500">2.4 MB</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-end space-x-3">
          <button
            className={`px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded ${isArchived ? 'bg-blue-100' : ''}`}
            onClick={toggleArchive}
          >
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            className="px-4 py-2 bg-red-50 hover:bg-red-100 rounded text-red-600"
            onClick={handleDelete}
          >
            Delete
          </button>
          <button
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded text-white"
            onClick={handleResend}
          >
            Send Again
          </button>
        </div>
      </div>
    </div>
  );
}