import type { ReactNode } from 'react';

export type FormattedToken = { kind: 'text' | 'bold' | 'italic'; text: string };

export function formattedTokens(text: string): FormattedToken[] {
  return text.split(/(\*\*[^*\n]+\*\*|_[^_\n]+_)/g).filter(Boolean).map(part => {
    if (part.startsWith('**') && part.endsWith('**')) return { kind: 'bold', text: part.slice(2, -2) };
    if (part.startsWith('_') && part.endsWith('_')) return { kind: 'italic', text: part.slice(1, -1) };
    return { kind: 'text', text: part };
  });
}

export default function FormattedText({ text }: { text: string }) {
  return formattedTokens(text).map((token, index): ReactNode => token.kind === 'bold'
    ? <strong key={index}>{token.text}</strong>
    : token.kind === 'italic'
      ? <em key={index}>{token.text}</em>
      : token.text);
}
