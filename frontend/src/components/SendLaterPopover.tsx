'use client';
import { useState } from 'react';
import { Calendar, X } from 'lucide-react';
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduleChange: (date: string) => void;
}
export default function SendLaterPopover({ open, onOpenChange, onScheduleChange }: Props) {
  if (!open) return null;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16)); // YYYY-MM-DDTHH:MM
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDate(e.target.value);
  };
  const handleDone = () => {
    onScheduleChange(date);
    onOpenChange(false);
  };
  function addDays(date: Date, days: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 16);
  }
  function setTime(dateStr: string, hours: number, minutes: number): string {
    const d = new Date(dateStr);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString().slice(0, 16);
  }
  const quickOptions = [
    { label: 'Tomorrow', value: addDays(new Date(), 1) },
    { label: 'Tomorrow, 10:00 AM', value: setTime(addDays(new Date(), 1), 10, 0) },
    { label: 'Tomorrow, 11:00 AM', value: setTime(addDays(new Date(), 1), 11, 0) },
    { label: 'Tomorrow, 3:00 PM', value: setTime(addDays(new Date(), 1), 15, 0) },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg w-96 max-w-xl p-6 shadow-lg">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-medium">Pick date & time</h2>
          <button onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Date & Time</label>
          <input
            type="datetime-local"
            value={date}
            onChange={handleDateChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="space-y-2">
          {quickOptions.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => {
                setDate(opt.value);
                onScheduleChange(opt.value);
                onOpenChange(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 rounded hover:bg-gray-100"
            >
              <span>{opt.label}</span>
              <span className="text-sm text-gray-500">{formatTime(opt.value)}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-4">
          <button onClick={() => onOpenChange(false)} className="px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button onClick={handleDone} className="ml-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}