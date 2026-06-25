import type { Metadata } from 'next';
import LegalPage from '@/components/marketing/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy — SMITH',
  description: 'How SMITH collects, uses, stores and protects your data, including data accessed via Google APIs.',
};

// NOTE: This is a working policy written to satisfy Google OAuth verification
// (it includes the required Google API Services / Limited Use disclosures). It
// is not a substitute for legal advice — have it reviewed by a solicitor and
// fill in the entity/contact placeholders before relying on it commercially.

const CONTACT = 'hello@smithforaccountants.co.uk';

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 2026">
      <p>
        This Privacy Policy explains how <strong>SMITH</strong> (&ldquo;SMITH&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;) collects, uses, stores and protects information when accountancy firms and
        their team members use our web application at{' '}
        <a href="https://smithforaccountants.co.uk">smithforaccountants.co.uk</a>. SMITH is a
        software platform for accountancy practices that uses artificial intelligence to assist with
        bookkeeping, accounts review, tax workflows, email triage and related tasks.
      </p>
      <p>
        We act as a <strong>data processor</strong> for the client information your firm uploads, and as a
        <strong> data controller</strong> for your firm&rsquo;s own account and usage data. If you are a
        client of a firm that uses SMITH, please contact that firm in the first instance.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li><strong>Account data</strong> — your name, email address, role, and firm, used to sign you in and manage access.</li>
        <li><strong>Client and document data</strong> — the client records, invoices, bank statements, accounts and other documents your firm uploads or creates in SMITH.</li>
        <li><strong>Google account data</strong> — where you choose to connect Google services (see section 3).</li>
        <li><strong>Usage data</strong> — basic logs needed to operate and secure the service (e.g. feature used, timestamps, AI token counts).</li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide the SMITH service and its AI-assisted features.</li>
        <li>To process documents and produce outputs (e.g. bookkeeping entries, reviews, summaries) at your request.</li>
        <li>To send service emails on your behalf (e.g. task reminders and client approvals) from a mailbox you connect.</li>
        <li>To secure, maintain and improve the service.</li>
      </ul>

      <h2>3. Google user data</h2>
      <p>
        Some SMITH features are optional integrations that you must explicitly connect via Google&rsquo;s
        OAuth consent screen. We request access only when you enable the relevant feature, and only the
        scopes that feature needs. The table below sets out exactly what we access, why, and the Google
        OAuth scope involved.
      </p>

      <h3>Data we access</h3>
      <ul>
        <li>
          <strong>Gmail</strong> (scopes <code>gmail.modify</code>, <code>gmail.send</code>,{' '}
          <code>gmail.settings.basic</code>) — when you connect a mailbox for the Email triage and/or
          task &amp; proposal sending features, we access your email messages (headers and body),
          labels and basic send settings. We use this to display and triage your inbox inside SMITH
          (categorise, label, summarise and draft replies), and to send emails you initiate — such as
          client approvals and task reminders — from your own mailbox. We do not delete your emails.
        </li>
        <li>
          <strong>Google Calendar</strong> (scope <code>calendar</code>) — when you connect Calendar,
          we read and write your calendar events so SMITH can display them and create/update events
          (e.g. pushing approved holidays or deadlines) at your request.
        </li>
        <li>
          <strong>Google Drive</strong> (scope <code>drive</code>) — when you connect Drive, we create,
          list and retrieve the client documents you choose to file in or load from Drive through
          SMITH&rsquo;s Document Vault. We access files for the purpose of the actions you take in SMITH.
        </li>
        <li>
          <strong>Basic profile</strong> (scope <code>userinfo.email</code>) — your Google account email
          address, used only to identify which mailbox/account you have connected.
        </li>
      </ul>

      <h3>How we use it</h3>
      <p>
        We use Google user data <strong>solely to provide the user-facing features you enabled</strong>{' '}
        (inbox triage, sending email on your behalf, calendar display/scheduling and document filing).
        We do not use it for advertising, we do not sell it, and we do <strong>not</strong> use it to
        train generalised AI/ML models.
      </p>

      <h3>How we share it</h3>
      <p>
        We do not transfer Google user data to third parties except as necessary to provide the
        features you use, for security, or to comply with law. Specifically, where you invoke an
        AI-assisted feature on Gmail content (for example, summarising a thread or drafting a reply),
        the relevant content is transmitted to our AI sub-processor <strong>Anthropic (Claude)</strong>{' '}
        to perform that task and return a result; Anthropic does not use API-submitted data to train its
        models. We do not otherwise share Google user data with third parties.
      </p>

      <p>
        <strong>
          SMITH&rsquo;s use and transfer to any other app of information received from Google APIs
          will adhere to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </strong>
      </p>
      <p>
        You can disconnect any Google integration at any time in <strong>Settings</strong>, which revokes
        and deletes the access and refresh tokens SMITH holds for your account, and you can additionally
        revoke access from your{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
          Google Account permissions page
        </a>.
      </p>

      <h2>4. Artificial intelligence processing</h2>
      <p>
        SMITH uses the <strong>Anthropic (Claude)</strong> API to process documents and generate
        outputs. Content you submit for an AI task is sent to Anthropic solely to perform that task and
        return a result. Anthropic does not use data submitted via its API to train its models. We do
        not use your content, or Google user data, to train any models.
      </p>

      <h2>5. Storage, security and sub-processors</h2>
      <p>
        All data, including any Google user data we process, is stored in secured, access-controlled
        databases and file storage. We protect it with the following measures:
      </p>
      <ul>
        <li><strong>Encryption in transit</strong> — all connections use TLS/HTTPS.</li>
        <li><strong>Encryption at rest</strong> — our database and file storage are encrypted at rest by our infrastructure providers.</li>
        <li><strong>Tenant isolation</strong> — row-level security ensures each firm can only access its own data.</li>
        <li><strong>OAuth token protection</strong> — Google access and refresh tokens are held server-side with restricted, service-role-only access and are never exposed to the browser.</li>
        <li><strong>Access controls</strong> — administrative access is limited to authorised personnel on a need-to-know basis.</li>
      </ul>
      <p>We use the following sub-processors to operate SMITH:</p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication and file storage.</li>
        <li><strong>Anthropic</strong> — AI processing (including AI features run on connected-mailbox content).</li>
        <li><strong>Google</strong> — where you connect Gmail / Calendar / Drive.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Resend</strong> — sending certain system emails.</li>
      </ul>

      <h2>6. Data retention and deletion</h2>
      <p>
        We retain your data for as long as your firm uses SMITH and as needed for the audit and record
        history features of the service, subject to any legal retention obligations. Google user data is
        only retained while the relevant integration is connected.
      </p>
      <p>
        <strong>Deleting your data.</strong> You can:
      </p>
      <ul>
        <li>
          <strong>Disconnect a Google integration</strong> at any time in <strong>Settings</strong> —
          this immediately revokes and deletes the Google access and refresh tokens we hold, so SMITH can
          no longer access your Gmail, Calendar or Drive.
        </li>
        <li>
          <strong>Request deletion of your account and associated data</strong> by emailing{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We will delete or anonymise your personal data,
          and any cached Google user data, within 30 days of a verified request, except where we are
          required to retain it by law.
        </li>
      </ul>

      <h2>7. Your rights</h2>
      <p>
        Depending on your location (including under UK GDPR), you may have the right to access, correct,
        export or delete your personal data, and to object to or restrict certain processing. To exercise
        these rights, contact us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use only the cookies necessary to keep you signed in and to operate the service. We do not use
        advertising or third-party tracking cookies.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be reflected by an updated
        &ldquo;last updated&rdquo; date above and, where appropriate, notified in-app.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about this policy or your data? Email us at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
