import { canShare } from '@/lib/visibility';
import type { SessionUser } from '@/lib/auth';

/**
 * Who sees and changes a snippet.
 *
 *  - a personal snippet: its owner, and nobody else - not even a director (it is a rep's own
 *    scratch text, and unlike a template it is never sent to a prospect on its own);
 *  - a shared snippet: everyone in the tenant sees it, and any manager (`canShare`) can edit or
 *    delete it, so a shared block cannot be rewritten by a creator who is no longer a manager and
 *    cannot be left stranded when its creator leaves.
 */
export interface SnippetRow {
  ownerUserId: string;
  isShared: boolean;
}

export function canViewSnippet(user: SessionUser, snippet: SnippetRow): boolean {
  return snippet.isShared || snippet.ownerUserId === user.id;
}

export function canManageSnippet(user: SessionUser, snippet: SnippetRow): boolean {
  if (!canViewSnippet(user, snippet)) return false;
  return snippet.isShared ? canShare(user) : snippet.ownerUserId === user.id;
}

/** Prisma `where` for the snippets a user can see (add `tenantId` alongside). */
export function visibleSnippetsWhere(user: SessionUser) {
  return { OR: [{ isShared: true }, { ownerUserId: user.id }] };
}
