'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Mail } from 'lucide-react';

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export default function RecipientInput({ value, onChange, placeholder = 'Enter recipient email' }: Props) {
  // Local state for the master list of all recipients (including deselected)
  const [allRecipients, setAllRecipients] = useState<string[]>([]);
  // Local state for deselected recipients (subset of allRecipients)
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [inputValue, setInputValue] = useState('');
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local allRecipients with the prop value when it changes
  useEffect(() => {
    setAllRecipients(value);
  }, [value]);

  // Compute selected recipients
  const selectedRecipients = allRecipients.filter(r => !deselected.has(r));
  const selectedRecipientsKey = selectedRecipients.join(',');

  // Notify parent whenever the actual selection content changes (not just array reference)
  useEffect(() => {
    onChange(selectedRecipients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecipientsKey]);

  const toggleSelect = (email: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const selectAll = () => setDeselected(new Set());
  const deselectAll = () => setDeselected(new Set(allRecipients));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      const email = inputValue.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        // Avoid duplicates
        if (!allRecipients.includes(email)) {
          setAllRecipients((prev) => [...prev, email]);
          // New email is selected by default (not added to deselected)
        }
        setInputValue('');
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const removeEmail = (emailToRemove: string) => {
    setAllRecipients((prev) => prev.filter(v => v !== emailToRemove));
    setDeselected((prev) => {
      const next = new Set(prev);
      next.delete(emailToRemove);
      return next;
    });
  };

  const handleUploadButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(csv|txt)$/i)) {
      setUploadMessage('Please select a .csv or .txt file');
      setTimeout(() => setUploadMessage(null), 3000);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const potentialEmails = text
        .split(/\r?\n/)
        .flatMap(line => line.split(','))
        .map(entry => entry.trim())
        .filter(Boolean);

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const valid = potentialEmails.filter(email => emailRegex.test(email));
      const invalidCount = potentialEmails.length - valid.length;

      // Add new valid emails to allRecipients (avoiding duplicates)
      setAllRecipients((prev) => {
        const merged = [...new Set([...prev, ...valid])];
        return merged;
      });

      if (valid.length === 0) {
        setUploadMessage(`0 emails found in ${file.name}`);
      } else {
        setUploadMessage(`${valid.length} emails added from ${file.name} (${invalidCount} skipped)`);
      }
      setTimeout(() => setUploadMessage(null), 3000);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setUploadMessage('Failed to read file');
      setTimeout(() => setUploadMessage(null), 3000);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const renderChip = (email: string, idx: number) => {
    const isDeselected = deselected.has(email);
    return (
      <span
        key={idx}
        className={`flex items-center text-xs px-3 py-1 rounded-full cursor-pointer ${
          isDeselected ? 'bg-gray-100 text-gray-400' : 'bg-emerald-50 text-emerald-800'
        }`}
      >
        <span onClick={() => toggleSelect(email)}>{email}</span>
        <button
          onClick={() => removeEmail(email)}
          className={`ml-1 h-3 w-3 flex items-center justify-center rounded ${
            isDeselected ? 'text-gray-400 hover:bg-gray-200' : 'text-emerald-600 hover:bg-emerald-200'
          }`}
        >
          <X className="h-2 w-2" />
        </button>
      </span>
    );
  };

  return (
    <>
      <div className="mb-2">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`w-full ${allRecipients.length > 0 ? 'pl-10' : 'pl-4'} pr-4 py-2 bg-gray-50 rounded-full text-sm focus:ring-2 focus:ring-emerald-500 focus:bg-white`}
          />
          {allRecipients.length > 0 && (
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Mail className="h-4 w-4 text-gray-400" />
            </div>
          )}
        </div>
      </div>

      {allRecipients.length > 0 && (
        <div className="mb-1 flex items-center gap-3 text-xs">
          <span className="text-gray-500">{selectedRecipients.length} of {allRecipients.length} selected</span>
          <button onClick={selectAll} className="text-emerald-600 hover:underline">Select All</button>
          <button onClick={deselectAll} className="text-emerald-600 hover:underline">Deselect All</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showAllRecipients ? (
          <>
            {allRecipients.map((email, idx) => renderChip(email, idx))}
            <span
              onClick={() => setShowAllRecipients(false)}
              className="flex items-center bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded-full cursor-pointer hover:bg-gray-200"
            >
              Show less
            </span>
          </>
        ) : (
          <>
            {allRecipients.slice(0, 4).map((email, idx) => renderChip(email, idx))}
            {allRecipients.length > 4 && (
              <span
                onClick={() => setShowAllRecipients(true)}
                className="flex items-center bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded-full cursor-pointer hover:bg-gray-200"
              >
                +{allRecipients.length - 4} more
              </span>
            )}
          </>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={handleUploadButtonClick}
          className="flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-800"
        >
          <Mail className="h-3 w-3" />
          Upload List
        </button>
        <input
          type="file"
          accept=".csv,.txt"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        {uploadMessage && (
          <span className="ml-2 text-sm text-gray-600">{uploadMessage}</span>
        )}
      </div>
    </>
  );
}