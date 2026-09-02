"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Heading2, Quote, Code2,
  Braces, Paperclip, PenLine, X, Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CAMPAIGN_MERGE_VARIABLES } from "@/lib/v2/outreach/campaigns/mergeVariables";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// One shared compose editor for every outreach typebox (manual compose, templates, campaign
// variants). Fixes the old RichTextEditor bug: content is now KEPT IN SYNC with the external
// `value` (template switch / merge insert reflect immediately) and it emits real HTML to a hidden
// field, so the existing save/send buttons submit a non-empty body. Merge-variable picker, a working
// toolbar, a signature toggle, and file-attachment chips are built in. Attachment bytes are uploaded
// via `uploadUrl` (C2) when provided; otherwise the chips are metadata-only.

export type ComposeAttachment = { id: string; name: string; size: number; storageRef?: string; status: "pending" | "ready" | "error" };

type Props = {
  /** hidden input name that carries the HTML body to the form action */
  name: string;
  value: string;
  onChange?: (html: string) => void;
  signatureHtml?: string | null;
  /** POST endpoint that accepts a file and returns { storageRef }. When absent, the Attach button is hidden. */
  uploadUrl?: string;
  /** hidden input name that carries a JSON array of uploaded attachment storageRefs to the form action */
  attachmentsFieldName?: string;
  onAttachmentsChange?: (attachments: ComposeAttachment[]) => void;
  minHeightPx?: number;
  placeholder?: string;
};

const btn = "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted";
const btnActive = "bg-muted text-foreground";

export function RichComposeEditor({
  name, value, onChange, signatureHtml, uploadUrl, attachmentsFieldName, onAttachmentsChange, minHeightPx = 280, placeholder,
}: Props) {
  const [html, setHtml] = useState(value ?? "");
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [signatureOn, setSignatureOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: value ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none leading-relaxed focus:outline-none px-4 py-3",
        style: `min-height:${minHeightPx}px`,
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getHTML();
      setHtml(next);
      onChange?.(next);
    },
  });

  // Controlled sync — reflect EXTERNAL value changes (template switch, apply, reset) into the editor,
  // but never fight the user's own typing. We only reset when `value` itself changes vs the last one
  // we applied; internal edits update `value` to the current HTML, so they no-op here.
  const lastValueRef = useRef(value ?? "");
  useEffect(() => {
    if (!editor) return;
    const incoming = value ?? "";
    if (incoming === lastValueRef.current) return;
    lastValueRef.current = incoming;
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
    setHtml(incoming);
  }, [value, editor]);

  useEffect(() => { onAttachmentsChange?.(attachments); }, [attachments, onAttachmentsChange]);

  function insertVariable(key: string) {
    editor?.chain().focus().insertContent(`{{ ${key} }}`).run();
  }

  function toggleSignature() {
    if (!editor || !signatureHtml) return;
    if (signatureOn) {
      // Remove the appended signature block by id.
      const stripped = editor.getHTML().replace(SIGNATURE_WRAP(signatureHtml), "");
      editor.commands.setContent(stripped, { emitUpdate: true });
      setSignatureOn(false);
    } else {
      editor.chain().focus("end").insertContent(SIGNATURE_WRAP(signatureHtml)).run();
      setSignatureOn(true);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const staged: ComposeAttachment[] = Array.from(files).map((f) => ({
      id: `att_${Math.random().toString(36).slice(2, 10)}`,
      name: f.name,
      size: f.size,
      status: uploadUrl ? "pending" : "ready",
    }));
    setAttachments((prev) => [...prev, ...staged]);
    if (fileRef.current) fileRef.current.value = "";

    if (!uploadUrl) return;
    await Promise.all(
      Array.from(files).map(async (file, i) => {
        const id = staged[i].id;
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(uploadUrl, { method: "POST", body: fd });
          if (!res.ok) throw new Error("upload failed");
          const body = (await res.json()) as { storageRef: string };
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, storageRef: body.storageRef, status: "ready" } : a)));
        } catch {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "error" } : a)));
        }
      })
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow focus-within:ring-2 focus-within:ring-primary/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5">
        <ToolbarButton active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} label="Bold"><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} label="Italic"><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} label="Strikethrough"><Strikethrough className="h-4 w-4" /></ToolbarButton>
        <Divider />
        <ToolbarButton active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} label="Heading"><Heading2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} label="Bullet list"><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} label="Numbered list"><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} label="Quote"><Quote className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton active={editor?.isActive("codeBlock")} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} label="Code"><Code2 className="h-4 w-4" /></ToolbarButton>
        <Divider />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-primary transition-colors hover:bg-accent" title="Insert a merge variable">
              <Braces className="h-3.5 w-3.5" /> Variable
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
            <DropdownMenuLabel>Insert merge variable</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CAMPAIGN_MERGE_VARIABLES.map((v) => (
              <DropdownMenuItem key={v.key} onSelect={() => insertVariable(v.key)} className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{v.label}</span>
                <code className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{`{{ ${v.key} }}`}</code>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {signatureHtml ? (
          <ToolbarButton active={signatureOn} onClick={toggleSignature} label="Toggle signature" wide>
            <PenLine className="h-4 w-4" /> <span className="ml-1 text-xs font-semibold">Signature</span>
          </ToolbarButton>
        ) : null}

        {uploadUrl ? (
          <>
            <ToolbarButton onClick={() => fileRef.current?.click()} label="Attach a file" wide>
              <Paperclip className="h-4 w-4" /> <span className="ml-1 text-xs font-semibold">Attach</span>
            </ToolbarButton>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          </>
        ) : null}
      </div>

      <EditorContent editor={editor} className="max-h-[52vh] overflow-y-auto" aria-label={placeholder} />

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border bg-muted/30 px-3 py-2">
          {attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
              {a.status === "pending" ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : <Paperclip className="h-3 w-3 text-muted-foreground" />}
              <span className="max-w-[160px] truncate">{a.name}</span>
              <span className="text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>
              {a.status === "error" ? <span className="text-[10px] font-semibold text-red-600">failed</span> : null}
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${a.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input type="hidden" name={name} value={html} />
      {attachmentsFieldName ? (
        <input
          type="hidden"
          name={attachmentsFieldName}
          value={JSON.stringify(attachments.filter((a) => a.status === "ready" && a.storageRef).map((a) => a.storageRef))}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({ active, onClick, label, children, wide }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(wide ? "inline-flex h-7 items-center rounded px-2 text-muted-foreground transition-colors hover:bg-muted" : btn, active && btnActive)}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;
}

const SIGNATURE_MARK = "data-v2-signature";
function SIGNATURE_WRAP(signatureHtml: string): string {
  return `<div ${SIGNATURE_MARK}="1"><br/>${signatureHtml}</div>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
