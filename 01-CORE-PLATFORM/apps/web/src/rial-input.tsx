import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { rialDigits } from './invoice-quote';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string;
  onValueChange: (digits: string) => void;
};

export function formatRialInput(value: string): string {
  const digits = rialDigits(value);
  return digits ? BigInt(digits).toLocaleString('en-US') : '';
}

export function RialInput({ value, onValueChange, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = formatRialInput(value);

  useLayoutEffect(() => {
    const node = input.current;
    if (!node || caret.current === null || document.activeElement !== node) return;
    const digitCount = caret.current;
    caret.current = null;
    let position = 0;
    let seen = 0;
    while (position < node.value.length && seen < digitCount) {
      if (/\d/.test(node.value[position])) seen++;
      position++;
    }
    node.setSelectionRange(position, position);
  }, [display]);

  return <input {...props} ref={input} type="text" inputMode="numeric" dir="ltr" value={display} onChange={event => {
    const raw = event.target.value;
    caret.current = rialDigits(raw.slice(0, event.target.selectionStart ?? raw.length)).length;
    const digits = rialDigits(raw);
    onValueChange(digits);
    if (digits === value) {
      // Deleting only a separator does not change state, so React has no
      // render in which the layout effect could restore the logical caret.
      queueMicrotask(() => {
        const node = input.current;
        if (!node || document.activeElement !== node || caret.current === null) return;
        const wanted = caret.current; caret.current = null;
        let pos = 0; let seen = 0;
        while (pos < node.value.length && seen < wanted) { if (/\d/.test(node.value[pos])) seen++; pos++; }
        node.setSelectionRange(pos, pos);
      });
    }
  }} />;
}
