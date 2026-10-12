'use client';

import React, { useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { blockRemoteImages, hasRemoteImages, plainTextToHtml } from '@/lib/compose/html';
import { isHtmlBody } from '@/lib/compose/snippet';

/**
 * A stored email body shown the way a mail client would: sanitized HTML (plain-text bodies become
 * paragraphs), web images blocked until asked for, and collapsed to a few lines with "Show more".
 */
export function EmailBodyView({ body, collapsedClassName = 'max-h-20', className = '' }: { body: string; collapsedClassName?: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showImages, setShowImages] = useState(false);
  if (!body || !body.trim()) return null;
  const html = isHtmlBody(body) ? body : plainTextToHtml(body);
  const safe = DOMPurify.sanitize(showImages ? html : blockRemoteImages(html));
  return (
    <div className={className}>
      {!showImages && hasRemoteImages(html) && (
        <button type="button" onClick={() => setShowImages(true)} className="mb-1 text-[11px] font-semibold text-brand-orange-text hover:underline">
          Load images
        </button>
      )}
      <div
        className={`compose-prose select-text overflow-hidden break-words text-xs ${expanded ? 'max-h-96 overflow-y-auto' : collapsedClassName}`}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[11px] font-semibold text-brand-orange-text hover:underline">
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}
