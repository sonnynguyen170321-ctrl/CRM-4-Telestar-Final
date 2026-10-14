import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  robots: { index: true, follow: true },
};

/** Public terms of service, linked from the Google OAuth consent screen beside /privacy. */
export default function TermsOfServicePage() {
  const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">{LEGAL_CONTACT_EMAIL}</a>;

  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern use of the Telestar CRM at crm.telestar.cloud (the &ldquo;Service&rdquo;), operated by{' '}
        {LEGAL_ENTITY} (&ldquo;Telestar&rdquo;, &ldquo;we&rdquo;). By signing in or connecting a mailbox you agree to
        them. Where a written agreement between Telestar and a client covers the same subject, that agreement
        prevails.
      </p>

      <LegalSection heading="Who may use the Service">
        <p>
          The Service is a business tool for Telestar staff and for people a Telestar client has authorized. Access
          is by invitation only. You are responsible for keeping your sign-in credentials confidential and for
          activity under your account.
        </p>
      </LegalSection>

      <LegalSection heading="Connected mailboxes">
        <p>
          You may connect a Google or Microsoft mailbox only if you are authorized to use it. By connecting one you
          allow the Service to send the emails you write or schedule from it and to read its inbox to detect
          replies and bounces, as described in our{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>. You can disconnect it at any time in
          Settings or from your Google or Microsoft account.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>You agree not to use the Service to:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>send spam, deceptive content, or email to people who have unsubscribed or asked not to be contacted;</li>
          <li>break anti-spam, privacy, telemarketing or other applicable laws;</li>
          <li>upload data you have no right to use, or malware;</li>
          <li>access data or parts of the Service you are not authorized for, or interfere with its operation or security.</li>
        </ul>
        <p>We may suspend access that breaks these rules or puts recipients, mailboxes or the Service at risk.</p>
      </LegalSection>

      <LegalSection heading="Data">
        <p>
          Client and prospect data in the Service is handled as described in the{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link> and the agreement with the client it
          belongs to. You keep responsibility for the content of the emails and notes you create.
        </p>
      </LegalSection>

      <LegalSection heading="AI features">
        <p>
          AI suggestions, drafts and classifications can be wrong. Review them before relying on them or sending
          them; you remain responsible for what you send.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and changes">
        <p>
          We work to keep the Service available and secure but provide it &ldquo;as is&rdquo;, without guarantees of
          uninterrupted operation. We may change or discontinue features. Third-party services such as Google,
          Microsoft and telephony providers are outside our control.
        </p>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          To the extent the law allows, Telestar is not liable for indirect or consequential losses arising from use
          of the Service, and its total liability is limited as set out in the applicable client agreement.
        </p>
      </LegalSection>

      <LegalSection heading="Ending access">
        <p>
          Access ends when your role or the client engagement ends, or if these terms are broken. Data is then
          kept or deleted as described in the <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>We will post changes on this page and update the effective date above. Continued use means you accept them.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          {LEGAL_ENTITY} — {mail}
        </p>
      </LegalSection>
    </LegalPage>
  );
}
