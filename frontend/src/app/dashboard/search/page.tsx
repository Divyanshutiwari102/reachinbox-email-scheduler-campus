'use client';

import { useState } from 'react';
import SearchableEmailList from '@/components/SearchableEmailList';

export default function SearchPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [type, setType] = useState<'scheduled' | 'sent' | 'archived'>('scheduled');

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-bold mb-4 sm:mb-0">Search Emails</h1>
        <div className="flex sm:gap-4">
          <label htmlFor="search-input" className="sr-only">Search emails</label>
          <input
            id="search-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by recipient, subject, or content"
            className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white sm:w-64"
          />
          <label htmlFor="type-select" className="sr-only">Search type</label>
          <select
            id="type-select"
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white"
          >
            <option value="scheduled">Scheduled</option>
            <option value="sent">Sent</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <SearchableEmailList type={type} searchTerm={searchTerm} />
    </div>
  );
}