/** A reusable block of an email (GET /api/snippets). */
export interface SnippetItem {
  id: string;
  name: string;
  bodyHtml: string;
  isShared: boolean;
  canManage?: boolean;
}

/** What the editor lets a parent do to the draft without going through `value`. */
export interface ComposeEditorHandle {
  insertVariable: (field: string) => void;
  insertHtml: (html: string) => void;
  focus: () => void;
}

/** A mailbox as GET /api/email/accounts returns it. */
export interface ComposeMailbox {
  id: string;
  email: string;
  provider: string;
  fromName?: string | null;
  sendPausedAt?: string | null;
  sendPauseReason?: string | null;
  healthLevel?: string | null;
  signature?: string | null;
  /** The signature as the composer can display it (images inline). */
  signaturePreview?: string | null;
  quota?: {
    dailyCap: number;
    dailyRemaining: number;
    hourlyCap: number;
    hourlyRemaining: number | null;
  };
}

/** An uploaded, not yet sent, attachment (POST /api/email/attachments). */
export interface ComposeAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** A merge field the lead has no value for (GET/POST /api/email/preview and the client check). */
export interface MissingValue {
  field: string;
  where?: 'subject' | 'body';
}
