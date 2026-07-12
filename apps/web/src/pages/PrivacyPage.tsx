import { useTranslation } from 'react-i18next';
import { LegalLink, LegalList, LegalSection, LegalShell } from '../components/LegalShell';

/**
 * The Privacy Policy (#/privacy). Every claim here mirrors what the code
 * actually does — when behavior changes, change this page in the same PR:
 *  - local-first storage: the chesser-* localStorage keys (src/store/*)
 *  - account/sync data: apps/server/src/accounts/{store,routes}.ts
 *  - social sharing (all opt-in): apps/server/src/social/*
 *  - BYOK key handling: src/store/byok.ts + apps/server/src/coach/routes.ts
 *  - export/delete: apps/server/src/trust/routes.ts
 *  - Lichess/Chess.com calls: apps/server/src/{explorer,tablebase,import}.ts
 */

export function PrivacyPage() {
  // Only the title is translated (it doubles as link text elsewhere); the
  // policy body below is legal CONTENT and deliberately stays English.
  const { t } = useTranslation('legal');
  return (
    <LegalShell title={t('privacyTitle')} updated="July 11, 2026">
      <LegalSection title="The short version">
        <p>
          Chesser is local-first. Your training data lives in your browser; creating an account is optional and only
          exists to sync that data across devices. There are no ads, no tracking, no analytics, and we never sell
          data — there is nothing to sell. We don&apos;t even ask for an email address.
        </p>
      </LegalSection>

      <LegalSection title="What stays on your device">
        <p>
          Everything you do in Chesser is stored in this browser&apos;s local storage (keys starting with{' '}
          <code className="rounded bg-neutral-800 px-1 py-0.5 text-xs">chesser-</code>): puzzle and opening progress,
          ratings, streaks, lessons, saved repertoires, custom puzzles, settings, and your acknowledgement of the
          storage notice. The app also caches its own files for offline use (a standard service worker). Clearing your
          browser&apos;s site data removes all of it.
        </p>
      </LegalSection>

      <LegalSection title="What we store if you create an account">
        <p>Accounts are optional. If you create one, the Chesser server stores:</p>
        <LegalList
          items={[
            <>
              Your <strong>username</strong>, a <strong>salted hash of your password</strong> (scrypt — we never store
              or see the password itself), and when the account was created. No email, no real name.
            </>,
            <>
              Your <strong>synced training progress</strong> — the same ratings, streaks, lesson and puzzle data your
              browser keeps, so your other devices can pick it up.
            </>,
            <>
              Games you explicitly save to your <strong>game library</strong> (PGN, player labels, result).
            </>,
            <>
              Your <strong>sharing preferences</strong> and, if you opt in, leaderboard entries and the profile stats
              you chose to show.
            </>,
            <>
              Your <strong>friends data</strong>: friendships, pending requests, challenges and your friend code.
            </>,
            <>
              <strong>Abuse reports you file</strong> (the reported profile, the reason, an optional note, and when).
            </>,
          ]}
        />
        <p>Session tokens are stored server-side so your sign-in works, and are deleted when you sign out.</p>
      </LegalSection>

      <LegalSection title="Your AI key never touches our servers">
        <p>
          The AI coach is bring-your-own-key. Your provider API key is stored only in this browser&apos;s local
          storage. It is deliberately excluded from account sync, so it is never uploaded to Chesser servers. Coach
          requests go directly from your browser to the provider you chose; only when a provider&apos;s CORS policy
          blocks that direct call does the request pass once through a stateless Chesser relay that strips the key
          from logs and stores nothing.
        </p>
      </LegalSection>

      <LegalSection title="Sharing is opt-in, always">
        <p>
          Public profiles and leaderboards are off by default, per stat. Until you flip them on, nobody — signed in or
          not — can see anything about your account; a private profile and a nonexistent one are deliberately
          indistinguishable. The only identity ever shown is your username.
        </p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <LegalList
          items={[
            <>
              <strong>Lichess</strong> — the opening explorer and endgame tablebase are answered by Lichess&apos;s
              public APIs. The Chesser server forwards only the chess position being asked about, never your identity.
            </>,
            <>
              <strong>Lichess / Chess.com game import</strong> — when you ask to import games, the server fetches the
              public games of the username you typed from those sites&apos; public APIs.
            </>,
            <>
              <strong>Your AI provider</strong> — if you configure the AI coach, engine analysis facts are sent to the
              provider you chose, under your own key and their privacy terms.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Export and deletion — your data, your call">
        <p>
          From the account panel (top right) you can <strong>export</strong> everything the server stores about you as
          a single JSON file, and <strong>delete your account</strong> — which permanently erases your credentials,
          sessions, synced progress, saved games, sharing settings, leaderboard entries, friends data and abuse
          reports involving you, and clears this browser&apos;s Chesser data too. Deletion is immediate and cannot be
          undone.
        </p>
      </LegalSection>

      <LegalSection title="Retention & changes">
        <p>
          Account data is kept until you delete it. If this policy changes, the date above changes with it and the
          updated policy applies from then on. See also the <LegalLink href="#/profile/about/terms">Terms of Service</LegalLink>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
