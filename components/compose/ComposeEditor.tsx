'use client';

/**
 * The one email body editor (composer, inbox reply, template editor).
 *
 * TipTap on ProseMirror (MIT). The value in and out is the stored form: HTML whose merge fields
 * are plain `{{field|fallback}}` text, which is what the send routes and the worker already
 * understand. In the editor those fields are chips. "Plain text" turns the editor into a textarea
 * and the value into text with no markup; "HTML" (templates only) shows the source.
 *
 * Triggers: typing `{{` opens the variable list, typing `/` at the start of a word opens the
 * snippet list; both keep focus in the editor and are driven from the keyboard.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link2, Image as ImageIcon, RemoveFormatting,
  Braces, Scissors, Code2, Type,
} from 'lucide-react';
import { composeExtensions } from '@/lib/compose/editorExtensions';
import {
  blockRemoteImages, chipifyMergeTags, editorHtmlToStored, hasRemoteImages, htmlToPlainText, isHtmlBlank, plainTextToHtml,
  unchipifyMergeTags,
} from '@/lib/compose/html';
import { isHtml } from '@/lib/email/sanitize';
import { INLINE_IMAGE_TYPES, MAX_INLINE_IMAGE_BYTES, normalizeImageUrl, normalizeLinkUrl } from '@/lib/compose/urls';
import { mergePickerItems } from '@/lib/compose/merge';
import { PickerList, useDismiss, type PickerItem } from './PickerMenu';
import type { ComposeEditorHandle, SnippetItem } from './types';

export type EditorMode = 'rich' | 'plain' | 'source';

export interface ComposeEditorProps {
  /** Stored form: HTML (rich, source) or plain text (plain). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Tailwind height classes of the writing area. */
  heightClass?: string;
  disabled?: boolean;
  snippets?: readonly SnippetItem[];
  /** Offered in the snippet menu: keep the current draft as a snippet. */
  onCreateSnippet?: (bodyHtml: string) => void;
  /** Merge fields the lead has no value for; their chips turn red. */
  missingFields?: readonly string[];
  /** Show the "HTML" source switch (the template editor). */
  allowSource?: boolean;
  /** Which view the editor opens in. A template with layout the rich view cannot show opens as source. */
  initialMode?: EditorMode;
  /** Extra controls at the right end of the toolbar. */
  toolbarEnd?: React.ReactNode;
  /** Smaller toolbar and padding for the inbox reply box. */
  compact?: boolean;
}

interface Trigger {
  kind: 'variable' | 'snippet';
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

const FORMATTED = /<(?:strong|b|em|i|u|a|ul|ol|li|img|h[1-6]|blockquote)\b/i;

function readTrigger(editor: Editor, snippetsEnabled: boolean): Trigger | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '￼');
  const found = /\{\{([a-zA-Z.]{0,24})$/.exec(before);
  const slash = snippetsEnabled ? /(?:^|\s)\/([\w-]{0,30})$/.exec(before) : null;
  const kind = found ? 'variable' : slash ? 'snippet' : null;
  if (!kind) return null;
  const length = found ? found[0].length : slash![1].length + 1;
  const coords = editor.view.coordsAtPos($from.pos);
  return {
    kind,
    query: found ? found[1] : slash![1],
    from: $from.pos - length,
    to: $from.pos,
    left: coords.left,
    top: coords.bottom + 4,
  };
}

/** The stored body as the editor loads it. Web images stay unloaded until the rep asks for them. */
function toEditorContent(value: string, loadImages: boolean): string {
  const html = chipifyMergeTags(isHtml(value) ? value : plainTextToHtml(value));
  return loadImages ? html : blockRemoteImages(html);
}

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // The editor keeps its selection: the button must not take focus on press.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 text-text-secondary transition-colors hover:bg-card-border/50 hover:text-text-primary focus-ring disabled:opacity-40 ${
        active ? 'bg-card-border/60 text-text-primary' : ''
      }`}
    >
      {children}
    </button>
  );
}

const ComposeEditor = forwardRef<ComposeEditorHandle, ComposeEditorProps>(function ComposeEditor(props, ref) {
  const {
    value, onChange, placeholder, ariaLabel, heightClass = 'min-h-[12rem] max-h-[22rem]', disabled, snippets, onCreateSnippet,
    missingFields, allowSource, initialMode = 'rich', toolbarEnd, compact,
  } = props;

  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menu, setMenu] = useState<'variables' | 'snippets' | null>(null);
  const [menuQuery, setMenuQuery] = useState('');
  const [panel, setPanel] = useState<'link' | 'image' | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [panelError, setPanelError] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastEmitted = useRef(value);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const imagesLoadedRef = useRef(false);

  // The editor is created once, so what its handlers call is read through refs.
  const live = useRef({ onChange, snippetsEnabled: Boolean(snippets) });
  const insertImageRef = useRef<(file: File) => Promise<void>>(async () => {});

  const variableItems: PickerItem[] = useMemo(
    () => mergePickerItems(),
    [],
  );
  const filterItems = useCallback(
    (items: readonly PickerItem[], query: string) => {
      const q = query.trim().toLowerCase();
      return q ? items.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(q)) : [...items];
    },
    [],
  );
  const snippetItems: PickerItem[] = useMemo(
    () => (snippets ?? []).map((s) => ({ id: s.id, label: s.name, hint: s.isShared ? 'Team' : undefined })),
    [snippets],
  );

  const triggerItems = trigger ? filterItems(trigger.kind === 'variable' ? variableItems : snippetItems, trigger.query).slice(0, 40) : [];
  const menuItems = menu ? filterItems(menu === 'variables' ? variableItems : snippetItems, menuQuery).slice(0, 40) : [];
  const keyState = useRef({ trigger, triggerItems, activeIndex });

  const pickRef = useRef<(item: PickerItem, via: 'trigger' | 'menu') => void>(() => {});

  const editor = useEditor({
    extensions: useMemo(() => composeExtensions({ placeholder }), [placeholder]),
    content: toEditorContent(value, false),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `compose-prose rounded-b-lg px-3 py-2.5 overflow-y-auto ${heightClass}`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
      },
      handleKeyDown: (_view, event) => {
        const state = keyState.current;
        if (state.trigger) {
          const count = state.triggerItems.length;
          if (event.key === 'ArrowDown' && count) { setActiveIndex((i) => (i + 1) % count); return true; }
          if (event.key === 'ArrowUp' && count) { setActiveIndex((i) => (i - 1 + count) % count); return true; }
          if ((event.key === 'Enter' || event.key === 'Tab') && count) {
            pickRef.current(state.triggerItems[Math.min(state.activeIndex, count - 1)], 'trigger');
            return true;
          }
          // Closes the list and nothing else: the event must not reach a dialog that closes on Escape.
          if (event.key === 'Escape') { event.stopPropagation(); setTrigger(null); return true; }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        event.preventDefault();
        void insertImageRef.current(file);
        return true;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      // Only a real edit is reported; a stored body is never rewritten by merely opening it.
      if (!transaction.docChanged) return;
      const html = ed.isEmpty ? '' : editorHtmlToStored(ed.getHTML());
      lastEmitted.current = html;
      live.current.onChange(html);
      setTrigger(readTrigger(ed, live.current.snippetsEnabled));
    },
    onSelectionUpdate: ({ editor: ed }) => setTrigger(readTrigger(ed, live.current.snippetsEnabled)),
    onBlur: () => setTrigger(null),
  });

  useEffect(() => setActiveIndex(0), [trigger?.kind, trigger?.query]);

  useEffect(() => {
    // No update event: a change of editability is not an edit, and an update would write the
    // editor's simplified HTML over a template the rep has not touched.
    if (editor && editor.isEditable === disabled) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  // The parent changed the value (a template was picked, a fallback was added): show it.
  useEffect(() => {
    if (!editor || mode !== 'rich' || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(toEditorContent(value, imagesLoadedRef.current), { emitUpdate: false });
  }, [editor, value, mode]);

  // Chips with no value for the lead are red.
  const missingKey = (missingFields ?? []).join('|');
  useEffect(() => {
    if (!editor) return;
    editor.commands.setMissingMergeFields(missingKey ? missingKey.split('|') : []);
  }, [editor, missingKey, value]);

  const formatting = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive('bold') ?? false,
      italic: ed?.isActive('italic') ?? false,
      underline: ed?.isActive('underline') ?? false,
      bullet: ed?.isActive('bulletList') ?? false,
      ordered: ed?.isActive('orderedList') ?? false,
      link: ed?.isActive('link') ?? false,
    }),
  });

  // ── Insertion ──────────────────────────────────────────────────────────────

  const insertVariable = useCallback(
    (field: string, range?: { from: number; to: number }, rawText?: string) => {
      if (mode === 'rich' && editor) {
        const chain = editor.chain().focus();
        if (range) chain.deleteRange(range);
        // A syntax snippet ({{#if}}, spintax) goes in as text; a variable as a chip.
        if (rawText) chain.insertContent({ type: 'text', text: rawText }).run();
        else chain.insertContent({ type: 'mergeTag', attrs: { field, fallback: '' } }).run();
        return;
      }
      const area = textareaRef.current;
      const tag = rawText ?? `{{${field}}}`;
      if (!area) return;
      const start = area.selectionStart ?? area.value.length;
      const end = area.selectionEnd ?? start;
      const next = area.value.slice(0, start) + tag + area.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(start + tag.length, start + tag.length);
      });
    },
    [editor, mode, onChange],
  );

  const insertHtml = useCallback(
    (html: string, range?: { from: number; to: number }) => {
      if (mode === 'rich' && editor) {
        const chain = editor.chain().focus();
        if (range) chain.deleteRange(range);
        chain.insertContent(chipifyMergeTags(html)).run();
        return;
      }
      const text = isHtml(html) ? htmlToPlainText(html) : html;
      onChange(value ? `${value}${value.endsWith('\n') ? '' : '\n'}${text}` : text);
    },
    [editor, mode, onChange, value],
  );

  useImperativeHandle(ref, () => ({ insertVariable: (f) => insertVariable(f), insertHtml: (h) => insertHtml(h), focus: () => editor?.commands.focus() }), [
    editor, insertHtml, insertVariable,
  ]);

  const pick = (item: PickerItem, via: 'trigger' | 'menu') => {
    const range = via === 'trigger' && trigger ? { from: trigger.from, to: trigger.to } : undefined;
    const kind = via === 'trigger' ? trigger?.kind : menu === 'variables' ? 'variable' : 'snippet';
    if (kind === 'variable') insertVariable(item.id, range, item.insert);
    else {
      const snippet = snippets?.find((s) => s.id === item.id);
      if (snippet) insertHtml(snippet.bodyHtml, range);
    }
    setTrigger(null);
    setMenu(null);
    setMenuQuery('');
  };

  // ── Links and images ───────────────────────────────────────────────────────

  const openPanel = (next: 'link' | 'image') => {
    if (panel === next) { setPanel(null); return; }
    setPanelError(null);
    if (next === 'link') setLinkUrl((editor?.getAttributes('link').href as string | undefined) ?? '');
    else setImageUrl('');
    setPanel(next);
  };

  const applyLink = () => {
    if (!editor) return;
    const href = normalizeLinkUrl(linkUrl);
    if (!href) { setPanelError('Use an http, https or mailto address, for example https://telestar.vn'); return; }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setPanel(null);
  };

  const removeLink = () => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setPanel(null);
  };

  const applyImageUrl = () => {
    if (!editor) return;
    const src = normalizeImageUrl(imageUrl);
    if (!src) { setPanelError('Images from a web address must use https://'); return; }
    // The rep typed this address, so they have chosen to load it; the rest of the draft stays as it was.
    setImagesLoaded(true);
    editor.chain().focus().setImage({ src }).run();
    setPanel(null);
  };

  const loadImages = () => {
    setImagesLoaded(true);
    editor?.commands.setContent(toEditorContent(value, true), { emitUpdate: false });
  };

  async function insertImageFile(file: File) {
    if (!(INLINE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setPanel('image');
      setPanelError('Use a PNG, JPG, GIF or WebP image.');
      return;
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      setPanel('image');
      setPanelError('Images in the body are limited to 1 MB. Attach a larger file instead.');
      return;
    }
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!src) { setPanelError('That image could not be read.'); return; }
    editor?.chain().focus().setImage({ src }).run();
    setPanel(null);
  }

  // What the editor's own handlers (created once) call is kept current after every render.
  useEffect(() => {
    imagesLoadedRef.current = imagesLoaded;
    live.current = { onChange, snippetsEnabled: Boolean(snippets) };
    keyState.current = { trigger, triggerItems, activeIndex };
    pickRef.current = pick;
    insertImageRef.current = insertImageFile;
  });

  // ── Modes ──────────────────────────────────────────────────────────────────

  const switchMode = (next: EditorMode) => {
    if (next === mode) return;
    setPanel(null);
    setMenu(null);
    if (next === 'plain') {
      if (mode === 'rich' && FORMATTED.test(value) && !window.confirm('Plain text removes bold, lists, links and images from this draft. Switch anyway?')) return;
      const text = isHtml(value) ? htmlToPlainText(unchipifyMergeTags(value)) : value;
      lastEmitted.current = text;
      onChange(text);
    } else if (mode === 'plain') {
      const html = value.trim() ? plainTextToHtml(value) : '';
      lastEmitted.current = '';
      onChange(html);
    }
    setMode(next);
  };

  // Editor content is re-read from `value` when returning to the rich view.
  useEffect(() => {
    if (mode === 'rich' && editor) {
      lastEmitted.current = value;
      editor.commands.setContent(toEditorContent(value, imagesLoadedRef.current), { emitUpdate: false });
    }
    // Only when the mode changes: typing must not reset the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editor]);

  const menuWrap = useRef<HTMLDivElement | null>(null);
  useDismiss(menu !== null, () => setMenu(null), menuWrap);

  const empty = isHtmlBlank(value);
  const rich = mode === 'rich';

  return (
    <div className="rounded-lg border border-card-border bg-bg-main focus-within:border-brand-red">
      <div ref={toolbarRef} role="toolbar" aria-label="Formatting" className={`relative flex flex-wrap items-center gap-0.5 border-b border-card-border ${compact ? 'p-0.5' : 'p-1'}`}>
        {rich && (
          <>
            <ToolbarButton label="Bold (Ctrl+B)" active={formatting?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Italic (Ctrl+I)" active={formatting?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Underline (Ctrl+U)" active={formatting?.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Bulleted list" active={formatting?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Numbered list" active={formatting?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Link" active={formatting?.link || panel === 'link'} onClick={() => openPanel('link')}><Link2 className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Image" active={panel === 'image'} onClick={() => openPanel('image')}><ImageIcon className="h-3.5 w-3.5" /></ToolbarButton>
            <ToolbarButton label="Clear formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting className="h-3.5 w-3.5" /></ToolbarButton>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-card-border" />
          </>
        )}
        {mode !== 'source' && (
          <div ref={menuWrap} className="relative flex items-center gap-0.5">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={menu === 'variables'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setMenu(menu === 'variables' ? null : 'variables'); setMenuQuery(''); setActiveIndex(0); }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-text-secondary hover:bg-card-border/50 hover:text-text-primary focus-ring"
            >
              <Braces className="h-3.5 w-3.5" aria-hidden="true" /> Variables
            </button>
            {snippets && (
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={menu === 'snippets'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setMenu(menu === 'snippets' ? null : 'snippets'); setMenuQuery(''); setActiveIndex(0); }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-text-secondary hover:bg-card-border/50 hover:text-text-primary focus-ring"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" /> Snippets
              </button>
            )}
            {menu && (
              <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-card-border bg-card-bg shadow-xl">
                <input
                  autoFocus
                  value={menuQuery}
                  onChange={(event) => { setMenuQuery(event.target.value); setActiveIndex(0); }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, Math.max(0, menuItems.length - 1))); }
                    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
                    if (event.key === 'Enter') { event.preventDefault(); const item = menuItems[activeIndex]; if (item) pickRef.current(item, 'menu'); }
                  }}
                  placeholder={menu === 'variables' ? 'Search variables' : 'Search snippets'}
                  aria-label={menu === 'variables' ? 'Search variables' : 'Search snippets'}
                  className="w-full rounded-t-lg border-b border-card-border bg-bg-main px-3 py-1.5 text-xs text-text-primary focus:outline-none"
                />
                <PickerList
                  items={menuItems}
                  activeIndex={activeIndex}
                  onPick={(item) => pickRef.current(item, 'menu')}
                  onHover={setActiveIndex}
                  label={menu === 'variables' ? 'Variables' : 'Snippets'}
                  listId={`compose-menu-${menu}`}
                  emptyText={menu === 'snippets' ? 'No snippets yet. Save a draft as a snippet to reuse it.' : 'No matching variable'}
                />
                {menu === 'snippets' && onCreateSnippet && !empty && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { onCreateSnippet(value); setMenu(null); }}
                    className="w-full border-t border-card-border px-3 py-1.5 text-left text-xs font-semibold text-brand-orange-text hover:bg-card-border/30"
                  >
                    Save this draft as a snippet
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {toolbarEnd}
          {allowSource && (
            <button
              type="button"
              aria-pressed={mode === 'source'}
              onClick={() => switchMode(mode === 'source' ? 'rich' : 'source')}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-xs font-semibold focus-ring ${mode === 'source' ? 'border-brand-red/30 bg-brand-red/10 text-brand-red' : 'border-card-border text-text-secondary hover:text-text-primary'}`}
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" /> HTML
            </button>
          )}
          <button
            type="button"
            aria-pressed={mode === 'plain'}
            onClick={() => switchMode(mode === 'plain' ? 'rich' : 'plain')}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-xs font-semibold focus-ring ${mode === 'plain' ? 'border-brand-red/30 bg-brand-red/10 text-brand-red' : 'border-card-border text-text-secondary hover:text-text-primary'}`}
          >
            <Type className="h-3.5 w-3.5" aria-hidden="true" /> Plain text
          </button>
        </div>
      </div>

      {rich && panel === 'link' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-card-border bg-card-bg px-2 py-1.5">
          <label htmlFor="compose-link-url" className="text-xs font-semibold text-text-muted">Link</label>
          <input
            id="compose-link-url"
            autoFocus
            value={linkUrl}
            onChange={(event) => { setLinkUrl(event.target.value); setPanelError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }}
            placeholder="https://"
            className="min-w-[14rem] flex-1 rounded border border-card-border bg-bg-main px-2 py-1 text-xs text-text-primary focus:border-brand-red focus:outline-none"
          />
          <button type="button" onClick={applyLink} className="rounded bg-brand-red px-2 py-1 text-xs font-semibold text-white hover:bg-brand-red-hover">Apply</button>
          {formatting?.link && <button type="button" onClick={removeLink} className="rounded border border-card-border px-2 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary">Remove link</button>}
          {panelError && <p role="alert" className="w-full text-xs font-semibold text-brand-red">{panelError}</p>}
        </div>
      )}
      {rich && panel === 'image' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-card-border bg-card-bg px-2 py-1.5">
          <label htmlFor="compose-image-url" className="text-xs font-semibold text-text-muted">Image</label>
          <input
            id="compose-image-url"
            autoFocus
            value={imageUrl}
            onChange={(event) => { setImageUrl(event.target.value); setPanelError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyImageUrl(); } }}
            placeholder="https:// address of an image"
            className="min-w-[14rem] flex-1 rounded border border-card-border bg-bg-main px-2 py-1 text-xs text-text-primary focus:border-brand-red focus:outline-none"
          />
          <button type="button" onClick={applyImageUrl} className="rounded bg-brand-red px-2 py-1 text-xs font-semibold text-white hover:bg-brand-red-hover">Insert</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded border border-card-border px-2 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary">Upload (max 1 MB)</button>
          <input
            ref={fileRef}
            type="file"
            accept={INLINE_IMAGE_TYPES.join(',')}
            className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void insertImageFile(file); }}
          />
          {panelError && <p role="alert" className="w-full text-xs font-semibold text-brand-red">{panelError}</p>}
        </div>
      )}

      {rich && !imagesLoaded && hasRemoteImages(value) && (
        <div className="flex items-center justify-between gap-2 border-b border-card-border bg-card-bg px-3 py-1.5 text-xs text-text-secondary">
          <span>Images from the web are not loaded, so opening this draft cannot be tracked.</span>
          <button type="button" onClick={loadImages} className="rounded border border-card-border px-2 py-0.5 font-semibold text-text-primary hover:border-brand-red">Load images</button>
        </div>
      )}
      {rich && <EditorContent editor={editor} />}
      {mode === 'plain' && (
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full resize-none rounded-b-lg bg-bg-main px-3 py-2.5 text-xs leading-relaxed text-text-primary placeholder-text-muted focus:outline-none ${heightClass}`}
        />
      )}
      {mode === 'source' && (
        <textarea
          value={value}
          aria-label={`${ariaLabel} (HTML source)`}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full resize-none rounded-b-lg bg-bg-main px-3 py-2.5 font-mono text-xs leading-relaxed text-text-primary focus:outline-none ${heightClass}`}
        />
      )}

      {trigger && rich && (
        <div
          style={{ position: 'fixed', left: trigger.left, top: trigger.top }}
          className="z-50 w-64 rounded-lg border border-card-border bg-card-bg shadow-xl"
        >
          <p className="border-b border-card-border px-3 py-1 text-xs font-semibold text-text-muted">
            {trigger.kind === 'variable' ? 'Variables' : 'Snippets'}
          </p>
          <PickerList
            items={triggerItems}
            activeIndex={Math.min(activeIndex, Math.max(0, triggerItems.length - 1))}
            onPick={(item) => pickRef.current(item, 'trigger')}
            onHover={setActiveIndex}
            label={trigger.kind === 'variable' ? 'Variables' : 'Snippets'}
            listId="compose-trigger"
            emptyText={trigger.kind === 'variable' ? 'No matching variable' : 'No matching snippet'}
          />
        </div>
      )}
    </div>
  );
});

export default ComposeEditor;
