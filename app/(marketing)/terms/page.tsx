import type { Metadata } from 'next';
import LegalPage from '@/components/marketing/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of the SMITH application.',
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

// NOTE: Working terms for launch / OAuth verification. Not legal advice — have a
// solicitor review and complete the entity/jurisdiction details before relying on it.

const CONTACT = 'hello@smithforaccountants.co.uk';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the{' '}
        <strong>SMITH</strong> application and related services (the &ldquo;Service&rdquo;) at{' '}
        <a href="https://smithforaccountants.co.uk">smithforaccountants.co.uk</a>. By using the
        Service, you agree to these Terms. If you are using SMITH on behalf of a firm, you confirm you
        are authorised to accept these Terms for that firm.
      </p>

      <h2>1. The Service</h2>
      <p>
        SMITH is a software platform for accountancy practices that uses artificial intelligence to
        assist with bookkeeping, accounts review, tax workflows, email triage, document management and
        related tasks. SMITH is a tool to assist qualified professionals; it does not provide
        accounting, tax, legal or other professional advice.
      </p>

      <h2>2. Accounts and access</h2>
      <ul>
        <li>You are responsible for keeping your login credentials secure and for all activity under your account.</li>
        <li>Firm administrators are responsible for managing their team members&rsquo; access.</li>
        <li>You must provide accurate account information and keep it up to date.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service unlawfully or to upload content you do not have the right to process;</li>
        <li>attempt to disrupt, reverse engineer, or gain unauthorised access to the Service or other firms&rsquo; data;</li>
        <li>misuse connected third-party services (such as Google) in breach of their terms.</li>
      </ul>

      <h2>4. Your data and outputs</h2>
      <p>
        You retain ownership of the data and documents you upload and of the outputs generated for you.
        You grant us the limited rights needed to host and process that data to provide the Service. Our
        handling of your data is described in our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>5. AI-assisted outputs</h2>
      <p>
        Outputs are generated with the assistance of AI and may contain errors or omissions. You are
        responsible for reviewing and verifying all outputs before relying on them or filing anything
        with HMRC, Companies House or any other body. SMITH is not liable for decisions made on the basis
        of unreviewed outputs.
      </p>

      <h2>6. Third-party services</h2>
      <p>
        The Service integrates with third parties (including Google and HMRC). Your use of those
        integrations is also subject to the relevant third party&rsquo;s terms. We are not responsible
        for third-party services we do not control.
      </p>

      <h2>7. Subscriptions and fees</h2>
      <p>
        Where the Service is provided on a paid basis, fees, billing terms and any usage-based charges
        (for example, AI usage billed by your own provider account) will be as agreed with your firm.
      </p>

      <h2>8. Availability</h2>
      <p>
        We aim to keep the Service available and reliable but provide it on an &ldquo;as is&rdquo; and
        &ldquo;as available&rdquo; basis without warranties of uninterrupted operation.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, SMITH is not liable for indirect, incidental or
        consequential losses, or for loss of profits, data or goodwill, arising from your use of the
        Service. Nothing in these Terms limits liability that cannot be limited by law.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access for breach of
        these Terms or where required for security or legal reasons. On termination, your data will be
        handled as set out in the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after changes take
        effect constitutes acceptance of the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of England and Wales, and the courts of England and Wales
        have exclusive jurisdiction, unless otherwise required by applicable law.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Email us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
