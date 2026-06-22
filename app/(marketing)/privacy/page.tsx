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
        Some SMITH features let you connect your Google account so the app can work with your Gmail,
        Google Calendar and/or Google Drive. We only request the access needed for the feature you use:
      </p>
      <ul>
        <li><strong>Gmail</strong> — to read and triage your inbox within SMITH, and to send emails (such as client approvals and task reminders) from your own mailbox at your request.</li>
        <li><strong>Google Calendar</strong> — to display and manage your calendar events inside SMITH.</li>
        <li><strong>Google Drive</strong> — to store and retrieve the client documents you choose to file there.</li>
      </ul>
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
        Specifically: we use Google user data only to provide and improve the features you have
        enabled; we do not use it for advertising; we do not sell it; and we do not transfer it to
        others except as necessary to provide the service, for security or legal reasons, or with your
        consent. We do <strong>not</strong> use Google user data to train generalised AI/ML models.
        You can disconnect Google access at any time in Settings, which revokes our stored tokens.
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
        Data is stored in secured, access-controlled databases and file storage with row-level security
        so each firm can only access its own data. We use the following sub-processors to operate SMITH:
      </p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication and file storage.</li>
        <li><strong>Anthropic</strong> — AI processing.</li>
        <li><strong>Google</strong> — where you connect Gmail / Calendar / Drive.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Resend</strong> — sending certain system emails.</li>
      </ul>

      <h2>6. Data retention</h2>
      <p>
        We retain your data for as long as your firm uses SMITH and as needed for the audit and record
        history features of the service, then delete or anonymise it within a reasonable period on
        request or on account closure, subject to any legal retention obligations.
      </p>

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
