import type { Metadata } from 'next';
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  robots: { index: true, follow: true },
};

/**
 * Public privacy policy. Google requires a reachable one before an OAuth app that requests Gmail
 * scopes can be published; the Limited Use paragraph is the wording its User Data Policy asks
 * for. Every statement here describes what the code does today — change the code, change this.
 */
export default function PrivacyPolicyPage() {
  const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">{LEGAL_CONTACT_EMAIL}</a>;

  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains how {LEGAL_ENTITY} (&ldquo;Telestar&rdquo;, &ldquo;we&rdquo;) collects, uses and protects
        information in the Telestar CRM at crm.telestar.cloud (the &ldquo;Service&rdquo;). The Service is a
        business tool used by Telestar staff to run sales development campaigns for our clients. It is not
        offered to consumers.
      </p>

      <LegalSection heading="Information we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Account information</strong> for people who sign in: name, work email address, role and
            team, and records of activity in the Service.
          </li>
          <li>
            <strong>Business contact information</strong> about prospects of our clients: name, job title,
            company, business email address, phone number, and notes and activity recorded by our staff.
          </li>
          <li>
            <strong>Connected mailbox data.</strong> When a user connects a Google or Microsoft mailbox, we
            store the OAuth access and refresh tokens (encrypted at rest), the emails the Service sends from
            that mailbox, and messages received in that mailbox&rsquo;s inbox, which the Service reads to
            detect replies and bounces from prospects.
          </li>
          <li>
            <strong>Email engagement data</strong> for emails sent through the Service, such as opens and link
            clicks, and unsubscribe requests.
          </li>
          <li>
            <strong>Technical data</strong> such as IP address, browser type and logs needed to operate and
            secure the Service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Google user data">
        <p>When a user connects a Gmail or Google Workspace mailbox, the Service requests these permissions:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Send email on your behalf</strong> (<code>gmail.send</code>) — to send the outreach and reply
            emails the user writes or schedules in the Service.
          </li>
          <li>
            <strong>Read your email</strong> (<code>gmail.readonly</code>) — to find replies, out-of-office
            messages and bounce notices for emails sent through the Service, so that a sequence stops when a
            prospect replies or an address bounces, and replies appear in the Service&rsquo;s inbox.
          </li>
          <li>
            <strong>Your email address</strong> (<code>userinfo.email</code>) — to identify which mailbox was
            connected.
          </li>
        </ul>
        <p>
          Telestar&rsquo;s use and transfer of information received from Google APIs to any other app will adhere
          to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. In particular, we:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>use Google user data only to provide and improve the user-facing features described above;</li>
          <li>do not sell Google user data, and do not use or transfer it for advertising, credit-worthiness or lending purposes;</li>
          <li>
            do not transfer it to others except as needed to provide those features, to comply with law, or as
            part of a merger or acquisition with notice to users;
          </li>
          <li>
            do not allow humans to read it, except with the user&rsquo;s affirmative consent for specific
            messages, where necessary for security purposes such as investigating abuse, to comply with law, or
            where the data is aggregated and anonymized for internal operations;
          </li>
          <li>do not use it to develop, improve or train generalized artificial intelligence or machine-learning models.</li>
        </ul>
        <p>
          Microsoft mailboxes connected through Microsoft Graph (<code>Mail.Send</code>, <code>Mail.Read</code>)
          are used in the same way and under the same limits.
        </p>
      </LegalSection>

      <LegalSection heading="How we use information">
        <ul className="list-disc pl-5 space-y-2">
          <li>to operate the Service: send emails, run sequences, record activity, and show replies to the right staff;</li>
          <li>to protect deliverability and recipients: stop sending after a reply, bounce or unsubscribe;</li>
          <li>to report campaign results to the client a campaign is run for;</li>
          <li>to secure the Service, prevent abuse, and meet legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="AI features">
        <p>
          Some features use AI models to help staff: classifying an incoming reply (for example, interested or
          out of office), and drafting or summarizing text when a user asks. For these features the relevant
          text is sent to an AI provider (OpenAI, Google or Groq) through its business API, only to produce
          that result. We do not use this data, or any Google user data, to train AI models.
        </p>
      </LegalSection>

      <LegalSection heading="Sharing">
        <p>We share information only with:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>the client whose campaign the information belongs to;</li>
          <li>service providers that host and run the Service for us (cloud hosting, email providers, AI providers as above), bound to use it only for that purpose;</li>
          <li>authorities, when required by law.</li>
        </ul>
        <p>We do not sell personal information.</p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Access to the Service requires an account and is limited by role. Mailbox credentials and OAuth tokens
          are encrypted at rest, traffic is encrypted in transit (HTTPS), and data is separated per client
          workspace.
        </p>
      </LegalSection>

      <LegalSection heading="Retention and deletion">
        <p>
          We keep information for as long as it is needed for the campaign it was collected for and our
          contractual and legal obligations. A user can disconnect a mailbox in Settings at any time, after which
          the Service stops sending from and reading it; access can also be removed from the Google side at{' '}
          <a href="https://myaccount.google.com/permissions" className="underline" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          . To have stored tokens, mailbox data or other personal information deleted, email {mail}; we act on
          deletion requests within 30 days.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can ask to access, correct or delete personal information we hold about you, or object to its use,
          including if you are a prospect who received an email from us. Outreach emails carry a one-click
          unsubscribe option, and replying to ask us to stop also works. Contact {mail}.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>We will post any change to this policy on this page and update the effective date above.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          {LEGAL_ENTITY} — {mail}
        </p>
      </LegalSection>
    </LegalPage>
  );
}
