import { LegalLink, LegalList, LegalSection, LegalShell } from '../components/LegalShell';

/**
 * The Terms of Service (#/terms). Kept honest and specific to what Chesser
 * actually is: a chess training app with optional accounts, opt-in sharing,
 * server-validated fair play, and moderated display names. Anything the app
 * doesn't do isn't promised or forbidden here.
 */

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="July 11, 2026">
      <LegalSection title="What Chesser is">
        <p>
          Chesser is a chess game and trainer: play against engine opponents, solve puzzles, drill openings and
          endgames, and track your progress. Using it means you accept these terms. If you don&apos;t accept them,
          don&apos;t use the app — no account is required to play, so nothing is lost by walking away.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <LegalList
          items={[
            <>You are responsible for keeping your password to yourself; anyone holding it holds the account.</>,
            <>
              Usernames are public display names. Names that impersonate staff, moderators or Chesser itself, and
              names containing profanity or slurs, are rejected — automatically at registration and by review if one
              slips through.
            </>,
            <>
              You can export your data or delete your account at any time from the account panel — see the{' '}
              <LegalLink href="#/privacy">Privacy Policy</LegalLink>. Deletion is immediate and permanent.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Fair play">
        <p>
          Leaderboards and shared profiles only mean something if the numbers are real. Score submissions and synced
          progress are validated server-side, and implausible claims are rejected. Don&apos;t tamper with sync
          payloads, submit fabricated scores, or use engine assistance in contexts presented as your own play. We may
          remove entries, names or accounts that break this.
        </p>
      </LegalSection>

      <LegalSection title="Behave toward others">
        <p>
          Friends, challenges and public profiles exist for playing chess with people, not harassing them. Don&apos;t
          use display names, friend requests or challenges to abuse anyone. Every public profile has a{' '}
          <strong>Report</strong> button — reports are recorded and reviewed, and accounts that abuse others (or abuse
          the report system itself) may be restricted or removed.
        </p>
      </LegalSection>

      <LegalSection title="Bring-your-own-key AI">
        <p>
          The AI coach runs on your own provider API key, under your provider&apos;s terms and pricing. You are
          responsible for that account and its costs. Chesser never stores your key server-side (see the{' '}
          <LegalLink href="#/privacy">Privacy Policy</LegalLink>) and is not responsible for provider output, outages
          or charges.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          Games you save, positions you import and progress you sync remain yours. You grant Chesser only what is
          technically needed to store them and show them back to you — and to others solely where you opted into
          sharing.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          Chesser is provided as-is, without warranties of any kind. Engine evaluations, coaching explanations and
          training statistics are educational aids, not guarantees. To the maximum extent permitted by law, Chesser is
          not liable for damages arising from use of the app.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          These terms may change as the app evolves; the date above reflects the current version. Continuing to use
          Chesser after a change means you accept the updated terms.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
