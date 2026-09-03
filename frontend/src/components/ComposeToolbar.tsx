'use client';

import { useState } from 'react';
import {
  Undo,
  Redo,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  Indent,
  Outdent,
  Quote,
  Strikethrough,
} from 'lucide-react';

export default function ComposeToolbar() {
  const [active, setActive] = useState<string | null>(null);

  const toggle = (name: string) => {
    setActive((prev) => (prev === name ? null : name));
  };

  const buttons = [
    { icon: Undo, name: 'undo' },
    { icon: Redo, name: 'redo' },
    { icon: Type, name: 'font' },
    { icon: Bold, name: 'bold' },
    { icon: Italic, name: 'italic' },
    { icon: Underline, name: 'underline' },
    { icon: Strikethrough, name: 'strike' },
    { icon: AlignLeft, name: 'left' },
    { icon: AlignCenter, name: 'center' },
    { icon: AlignRight, name: 'right' },
    { icon: List, name: 'ul' },
    { icon: List, name: 'ol' },
    { icon: Indent, name: 'indent' },
    { icon: Outdent, name: 'outdent' },
    { icon: Quote, name: 'quote' },
  ];

  return (
    <div className="flex flex-wrap gap-1 mb-4 p-3 bg-gray-50 rounded-lg">
      {buttons.map(({ icon: Icon, name }) => (
        <button
          key={name}
          type="button"
          onClick={() => toggle(name)}
          className={`flex items-center justify-center p-1 rounded ${active === name ? 'bg-emerald-200' : 'hover:bg-gray-200'}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}