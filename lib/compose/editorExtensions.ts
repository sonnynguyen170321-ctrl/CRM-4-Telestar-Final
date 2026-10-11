/**
 * The TipTap schema of the shared composer: what an email body can contain while it is being
 * edited. Kept free of React so the HTML round trip (stored HTML -> editor -> stored HTML) can be
 * tested on the server with `@tiptap/html`, and so the component and the tests cannot drift.
 *
 * Anything outside this schema is dropped when a document is loaded into the editor; that is why
 * `hasUnsupportedHtml` exists - the template editor warns before it simplifies a template.
 */
import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { normalizeLinkUrl } from './urls';

function mergeTagText(field: string, fallback: string): string {
  return fallback ? `{{${field}|${fallback}}}` : `{{${field}}}`;
}

/** `{{field}}` / `{{field|fallback}}` as one atomic inline chip. */
export const MergeTag = Node.create({
  name: 'mergeTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      field: { default: '' },
      fallback: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-merge-tag]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const field = el.getAttribute('data-merge-tag') ?? '';
          if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field)) return false;
          return { field, fallback: el.getAttribute('data-fallback') ?? '' };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const field = String(node.attrs.field);
    const fallback = String(node.attrs.fallback ?? '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-merge-tag': field, 'data-fallback': fallback, class: 'merge-chip' }),
      mergeTagText(field, fallback),
    ];
  },

  renderText({ node }) {
    return mergeTagText(String(node.attrs.field), String(node.attrs.fallback ?? ''));
  },
});

const MISSING_KEY = new PluginKey('composeMissingMergeValues');
/** Transaction meta that makes the highlight re-read its field set. */
const MISSING_REDRAW_META = 'composeMissingMergeValues';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    missingMerge: {
      /** Mark the chips for these fields red (a field with no value for the lead being written to). */
      setMissingMergeFields: (fields: readonly string[]) => ReturnType;
    };
  }
}

/**
 * Marks the chips whose field has no value for the lead being written to (a red chip, via the
 * `merge-chip-missing` class) - see the `setMissingMergeFields` command.
 */
export const MissingMergeHighlight = Extension.create({
  name: 'missingMerge',

  addStorage() {
    return { fields: new Set<string>() };
  },

  addCommands() {
    return {
      setMissingMergeFields:
        (fields) =>
        ({ tr, dispatch }) => {
          (this.storage as { fields: Set<string> }).fields = new Set(fields);
          // A transaction with no change still makes the decorations be read again.
          if (dispatch) dispatch(tr.setMeta(MISSING_REDRAW_META, true));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { fields: Set<string> };
    return [
      new Plugin({
        key: MISSING_KEY,
        props: {
          decorations(state) {
            if (storage.fields.size === 0) return DecorationSet.empty;
            const marks: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'mergeTag' && storage.fields.has(String(node.attrs.field)) && !node.attrs.fallback) {
                marks.push(Decoration.node(pos, pos + node.nodeSize, { class: 'merge-chip-missing' }));
              }
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});

export interface ComposeExtensionOptions {
  placeholder?: string;
}

export function composeExtensions(options: ComposeExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      // Not offered by the toolbar and not wanted in a business email.
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        isAllowedUri: (url) => normalizeLinkUrl(url) !== null,
        // No target: a mail client decides how a link opens, and the sanitiser strips it anyway.
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      },
    }),
    // `remoteSrc` carries the address of a web image that has not been loaded yet (blockRemoteImages).
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          remoteSrc: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-remote-src'),
            renderHTML: (attributes) => (attributes.remoteSrc ? { 'data-remote-src': attributes.remoteSrc } : {}),
          },
        };
      },
    }).configure({ inline: true, allowBase64: true }),
    MergeTag,
    MissingMergeHighlight,
    ...(options.placeholder ? [Placeholder.configure({ placeholder: options.placeholder })] : []),
  ];
}
