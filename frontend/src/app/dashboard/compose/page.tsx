'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Paperclip, Clock, Send, Mail, ChevronDown } from 'lucide-react';
import RecipientInput from '@/components/RecipientInput';
import ComposeToolbar from '@/components/ComposeToolbar';
import SendLaterPopover from '@/components/SendLaterPopover';
import { useSender } from '@/context/SenderContext';
import apiFetch from '@/lib/apiFetch';

export default function ComposePage() {
  const { sender } = useSender();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState<string>('');
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [delayBetweenEmails, setDelayBetweenEmails] = useState('0');
  const [hourlyLimit, setHourlyLimit] = useState('0');
  const [attachments, setAttachments] = useState<{ name: string; size: string }[]>([]);
  const [openSendLater, setOpenSendLater] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<boolean>(false);
  const [selectedSender, setSelectedSender] = useState<string>(sender?.id || '');

  useEffect(() => {
    if (sender?.id) {
      setSelectedSender(sender.id);
    }
  }, [sender?.id]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSendLaterOpen = () => {
    if (!scheduledAt) {
      setScheduledAt(new Date().toISOString().slice(0, 16));
    }
    setOpenSendLater(true);
  };

  const handleScheduleChange = (date: string) => {
    setScheduledAt(date);
    setOpenSendLater(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;

    if (recipients.length === 0) {
      setSendError('Please add at least one recipient');
      return;
    }
    if (!subject.trim()) {
      setSendError('Subject is required');
      return;
    }
    if (!body.trim()) {
      setSendError('Body is required');
      return;
    }
    if (!selectedSender) {
      setSendError('Please select a sender');
      return;
    }

    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    // If no explicit "Send Later" time was picked, default to right now (immediate send)
    const resolvedScheduledAt = scheduledAt
      ? new Date(scheduledAt).toISOString()
      : new Date().toISOString();

    const delayMsVal = parseInt(delayBetweenEmails, 10);
    const hourlyLimitVal = parseInt(hourlyLimit, 10);

    // Backend expects ONE row per recipient (schema: emails.recipient is a single email),
    // so for multiple recipients we send POST /schedule requests in batches to avoid
    // overwhelming the backend with too many concurrent requests.
    const batchSize = 5;
    const results: PromiseSettledResult<Awaited<ReturnType<typeof apiFetch>>>[] = [];
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((recipient) =>
          apiFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/schedule`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              recipient,
              subject: subject.trim(),
              body: body.trim(),
              scheduledAt: resolvedScheduledAt,
              senderId: selectedSender,
              ...(delayMsVal > 0 ? { delayMs: delayMsVal } : {}),
              ...(hourlyLimitVal > 0 ? { hourlyLimit: hourlyLimitVal } : {}),
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              throw new Error(errorData.error || `Failed for ${recipient}`);
            }
            return res.json();
          })
        )
      );
      results.push(...batchResults);
      // Delay between batches to avoid overwhelming the backend
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    setSending(false);

    if (failed.length > 0 && succeeded.length === 0) {
      setSendError(failed[0].reason?.message || 'Failed to schedule email(s)');
      return;
    }

    if (failed.length > 0) {
      setSendError(`${succeeded.length} scheduled, ${failed.length} failed`);
    } else {
      setSendError(null);
    }

    setSendSuccess(true);
    setRecipients([]);
    setSubject('');
    setBody('');
    setScheduledAt(null);
    setDelayBetweenEmails('0');
    setHourlyLimit('0');
    setAttachments([]);
    window.dispatchEvent(new Event('email-data-changed'));
  };

  const buttonText = scheduledAt ? 'Send Later' : 'Send';

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <div className="flex-1 p-6">
          <div className="flex justify-between items-start mb-4">
            <Link href="/dashboard" className="flex items-center space-x-2">
              <ArrowLeft className="h-5 w-5 text-gray-500 hover:text-gray-700" />
              <span className="text-sm font-medium">Back to Dashboard</span>
            </Link>
            <h1 className="text-xl font-bold">Compose New Email</h1>
            <div className="flex items-center space-x-2">
              {attachments.length > 0 && (
                <span className="flex items-center bg-emerald-50 text-emerald-800 text-xs px-2 py-1 rounded">
                  <Paperclip className="h-3 w-3 mr-1" />
                  {attachments.length}{attachments.length > 1 ? ' files' : ' file'}
                </span>
              )}
              <Clock className="h-4 w-4 text-gray-600 hover:text-gray-800" onClick={handleSendLaterOpen} />
              <button
                onClick={handleSend}
                className="flex items-center gap-1 px-3 py-1 bg-gray-50 hover:bg-gray-100 rounded text-sm font-medium"
              >
                {buttonText}
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">From</label>
            <div className="relative">
              <select
                value={selectedSender}
                onChange={(e) => setSelectedSender(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              >
                {sender ? (
                  <option key={sender.id} value={sender.id}>
                    {sender.email}
                  </option>
                ) : (
                  <option value="">Loading...</option>
                )}
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>

          <RecipientInput
            value={recipients}
            onChange={setRecipients}
            placeholder="Enter recipient email"
          />

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter subject"
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white"
            />
          </div>

          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Delay between 2 emails (ms)</label>
              <input
                type="number"
                value={delayBetweenEmails}
                onChange={(e) => setDelayBetweenEmails(e.target.value)}
                placeholder="00"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Hourly Limit</label>
              <input
                type="number"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value)}
                placeholder="00"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <ComposeToolbar />

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Body</label>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type Your Reply..."
              className="w-full h-96 p-3 bg-white border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
              rows={5}
            />
          </div>

          {attachments.length > 0 && (
            <div className="mb-4">
              <h2 className="font-semibold mb-2">Attachments</h2>
              <div className="grid grid-cols-2 gap-4">
                {attachments.map((att, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3">
                      <div className="h-10 w-10 bg-gray-200 rounded flex items-center justify-center">
                        {att.name.endsWith('.pdf') ? (
                          <span className="text-gray-500">PDF</span>
                        ) : (
                          <Paperclip className="h-5 w-5 text-gray-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{att.name}</p>
                        <p className="text-sm text-gray-500">{att.size}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full flex justify-center items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Email'}
            </button>
          </div>

          {sendError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {sendError}
            </div>
          )}
          {sendSuccess && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
              {recipients.length > 1 ? `${recipients.length} emails scheduled successfully!` : 'Email scheduled successfully!'}
              {scheduledAt ? ` Scheduled for ${new Date(scheduledAt).toLocaleString()}` : ''}
            </div>
          )}
        </div>

        <SendLaterPopover
          open={openSendLater}
          onOpenChange={setOpenSendLater}
          onScheduleChange={handleScheduleChange}
        />
      </div>
    </div>
  );
}