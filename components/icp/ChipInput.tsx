'use client';

import { X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

import {
  addChips,
  chipKeyAction,
  filterSuggestions,
  moveHighlight,
  removeChip,
  removeLastChip,
} from '@/lib/icp/chips';

/**
 * A list field you can type into freely. Enter, a comma or Tab turns what you typed into a chip;
 * pasting "a, b; c" makes three; Backspace in the empty box removes the last chip; the x on a chip
 * removes that one. Spaces are part of a value ("Head of Sales"). Duplicates (any casing) are ignored.
 *
 * The value is a plain `string[]`, the same shape the rules already store. `suggestions` is an
 * optional vocabulary offered while typing (arrow keys to move, Enter or Tab to take); anything not in
 * it can still be typed. The commit and parsing rules live in `lib/icp/chips.ts`.
 */
export function ChipInput({
  label,
  value,
  onChange,
  placeholder,
  suggestions,
  disabled = false,
  hideLabel = false,
}: {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: readonly string[];
  disabled?: boolean;
  /** Keep the label for screen readers only (the surrounding layout already names the field). */
  hideLabel?: boolean;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const [open, setOpen] = useState(false);

  const options = useMemo(
    () => (suggestions ? filterSuggestions(suggestions, draft, value) : []),
    [suggestions, draft, value],
  );
  const showList = open && options.length > 0;

  const commit = (raw: string) => {
    if (raw.trim()) onChange(addChips(value, raw));
    setDraft('');
    setHighlighted(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const action = chipKeyAction({
      key: event.key,
      draft,
      highlighted: showList ? highlighted : -1,
      suggestionCount: showList ? options.length : 0,
      composing: event.nativeEvent.isComposing,
    });
    switch (action.type) {
      case 'commit-draft':
        event.preventDefault();
        commit(draft);
        return;
      case 'commit-suggestion':
        event.preventDefault();
        commit(options[highlighted]);
        return;
      case 'remove-last':
        if (value.length > 0) {
          event.preventDefault();
          onChange(removeLastChip(value));
        }
        return;
      case 'move':
        event.preventDefault();
        setOpen(true);
        setHighlighted((index) => moveHighlight(index, options.length, action.direction));
        return;
      case 'close':
        event.preventDefault();
        setOpen(false);
        setHighlighted(-1);
        return;
      default:
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    // One plain word pastes into the box like any text; several values become chips at once.
    if (!/[,;\n\r\t]/.test(text)) return;
    event.preventDefault();
    commit(`${draft}${text}`);
  };

  return (
    <div className="space-y-2 text-xs font-semibold text-text-secondary">
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <div
        className={`relative flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border border-card-border bg-bg-main px-2 py-1.5 transition-colors focus-within:border-brand-red focus-within:ring-2 focus-within:ring-brand-red/20 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text'}`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((chip) => (
          <span
            key={chip.toLowerCase()}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-card-border/50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-text-primary"
          >
            <span className="truncate">{chip}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${chip} from ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(removeChip(value, chip));
                  inputRef.current?.focus();
                }}
                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-card-border hover:text-brand-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : undefined}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete={suggestions ? 'list' : 'none'}
          aria-activedescendant={showList && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setOpen(true)}
          // Leaving the box keeps what was typed: it becomes a chip rather than vanishing.
          onBlur={() => {
            setOpen(false);
            commit(draft);
          }}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm font-normal text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-card-border bg-card-bg py-1 shadow-lg"
          >
            {options.map((option, index) => (
              <li
                key={option}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                // mousedown, not click: the input's blur would otherwise close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`cursor-pointer px-3 py-2 text-sm font-normal ${index === highlighted ? 'bg-brand-red/10 text-text-primary' : 'text-text-secondary'}`}
              >
                {option}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
