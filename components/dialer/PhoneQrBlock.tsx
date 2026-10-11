'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { telUri } from '@/lib/telephony/phoneOutcomes';

/**
 * The number, a Copy button and a `tel:` QR code a phone scans to dial: the "call from your own phone"
 * half of the call screen. Shared by the phone-call panel and the softphone.
 */
export default function PhoneQrBlock({ e164, rawNumber, isVietnam }: { e164: string | null; rawNumber: string; isVietnam: boolean }) {
  const { showToast } = useToast();
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!e164) return;
    let cancelled = false;
    let link: string;
    try {
      link = telUri(e164);
    } catch {
      setQrSvg(null);
      return;
    }
    // The SVG is generated from the number alone; nothing a user typed is placed in it as markup.
    QRCode.toString(link, { type: 'svg', margin: 1, width: 168, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [e164]);

  const shownNumber = e164 ?? rawNumber;

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(shownNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Could not copy — select the number instead', 'error');
    }
  };

  return (
    <div className="flex items-center gap-4 border border-card-border rounded-xl p-3 bg-bg-main/40">
      {e164 && qrSvg ? (
        <div
          className="shrink-0 bg-white rounded-lg p-1"
          aria-label={`QR code to dial ${shownNumber}`}
          role="img"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      ) : null}
      <div className="space-y-2 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-semibold text-text-primary break-all">{shownNumber}</span>
          <button
            type="button"
            onClick={copyNumber}
            className="inline-flex items-center gap-1 px-2 py-1 border border-card-border rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-border/30"
          >
            {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {e164 ? (
          <p className="text-text-secondary leading-relaxed">
            Scan the code with your phone camera to dial
            {isVietnam ? '.' : ', or paste the number into MicroSIP.'} Then log what happened.
          </p>
        ) : (
          <p className="text-brand-orange-text leading-relaxed">
            This number could not be read as a dialable phone number. Check it on the lead before calling.
          </p>
        )}
      </div>
    </div>
  );
}
