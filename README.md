# Boo Ballot — Netlify edition

Private coworker costume voting, prepared for **Netlify + Supabase**. No hosted deployment or live email sender has been configured yet.

## What is ready

- Standard Next.js app and Netlify build configuration.
- PostgreSQL schema, unique account/category votes, saved tie draws, and private Supabase photo storage.
- Email-code sign-in with server-verified Supabase users. Only exact `cgi.com` and `cgifederal.com` domains may enter; plus-tagged email aliases are rejected.
- Four administrators: `teri.musick@cgi.com`, `zachary.sarver@cgi.com`, `heath.rasnake@cgi.com`, `morghan.scales@cgi.com`. Everyone else has viewing/voting access only.
- Stable Supabase user IDs identify ballots across devices and email changes. This is one ballot per account, not proof that a person has only one company account.
- Previous local test contestants and their linked uploaded photos were removed. New databases start empty. Nothing is copied from old Cloudflare storage.

## Local preview

Requires Node.js 24 and npm. Run `npm ci`, then `npm run dev`, or use `Start Boo Ballot.command` on this Mac. Open http://localhost:5173.

With no Supabase environment variables, expand **Local testing** on the sign-in page and choose Organizer or Voter preview. The controls exist only in local development, bind to loopback, and do not send email. Production ignores all preview cookies and requires a verified Supabase session.

To add the six fictional sample contestants for local testing, run `node scripts/seed-local-preview.mjs` while the preview is running. Samples are never automatically added to a hosted database.

Local data persists in ignored `.local-contest/` (PostgreSQL via PGlite and local photo files). Do not share that folder. Local and hosted data are separate.

## Connect Netlify and Supabase

1. Create a Netlify account and a Supabase project. Choose a **us-east** Supabase region near Netlify's default Ohio function region, and confirm the deployed function region in Netlify. See [Netlify function regions](https://docs.netlify.com/build/functions/configuration/). No paid purchase is automated.
2. Run these SQL files in the Supabase SQL Editor, in order:
   - `supabase/migrations/202610070001_contest.sql`
   - `supabase/migrations/202610070002_private_storage.sql`
   - `supabase/migrations/202610070003_auth_attempts.sql`

   These create empty contest tables and the `auth_attempts` sign-in limiter with row-level security, revoke browser database access, and create a **private** `costume-photos` bucket. The server accesses the database; there are intentionally no browser read/write policies.
3. Add the variables from `.env.example` in the **Netlify UI**, scoped to **Functions and Builds**. In particular, set `SITE_URL` and, when needed, `SUPABASE_CA_CERT` there, **not in `netlify.toml`**. Redeploy after changing the variables.
   - `DATABASE_URL`: Supabase transaction-pooler PostgreSQL URL. Start with `sslmode=require`, then follow the TLS procedure below. Keep the database password secret.
   - `SUPABASE_URL`: your project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: the project's publishable (or legacy anon) key.
   - `SITE_URL`: the final absolute HTTPS origin, for example `https://your-contest.netlify.app`, with no path, query, or fragment. Required for production email sign-in; the app uses it for `/auth/callback` and HTTPS security headers. Local preview may leave it unset.
   - `SUPABASE_CA_CERT`: the project's PEM CA certificate, only needed for the TLS fallback below. Preserve the full certificate and its line breaks.
   - `SUPABASE_SERVICE_ROLE_KEY`: server-only storage access. Never prefix this with `NEXT_PUBLIC_`.
   - `OPENAI_API_KEY`: optional, paid image generation; leave unset if unwanted or company policy prohibits sending photos to OpenAI.
4. In Supabase Authentication, enable Email and require email confirmation. In **both Confirm signup and Magic Link email templates**, display `{{ .Token }}` so initial signups and returning users can enter a code. The app accepts six- to eight-digit codes. Set Supabase's Site URL to the same origin as `SITE_URL`, and add the exact `https://your-contest.netlify.app/auth/callback` URL to the redirect allowlist, substituting your actual domain. Disable unused login providers. If an email also includes a PKCE magic link, open it in the **same browser on the same device** that requested it; otherwise return to the original sign-in page and enter the email code.
5. **Configure custom SMTP and raise Supabase auth rate limits before inviting coworkers.** Use a production sender, verify a sender domain you control, and test delivery to both company domains. Do not attempt to verify company DNS without authorization. In Authentication > Rate Limits, raise **`rate_limit_otp` and `rate_limit_verify`**, plus the email-send limit (`rate_limit_email_sent`) and your SMTP provider's quota, for the expected arrival burst. Budget at least three sends and three verification attempts per attendee in the arrival window: for 150 attendees arriving over five minutes, plan capacity for at least 450 of each in that window. Check each setting's displayed units and burst behavior, and test the configured capacity; a higher sustained limit alone does not guarantee a simultaneous burst succeeds. Supabase sees the Netlify server's shared egress IP, so its per-IP limits can affect everyone. See [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits). The app separately allows three code requests and ten verification attempts per email per ten minutes. Account/sender setup is still pending.
6. Connect GitHub to Netlify. If the repository contains this app in `boo-ballot/`, use the repository-root `netlify.toml`. If this folder is the repository root, use its own `netlify.toml`. Build: `npm run build`; publish: `.next`; Node: 24. Netlify automatically supplies its Next.js adapter.
7. Use separate Supabase projects for test deployments and the live contest so preview changes cannot affect real ballots. Do not place production secrets into untrusted PR previews.
8. Complete the pre-launch checklist below before sharing the live URL.

### Verify database TLS from Netlify

Try the real transaction-pooler `DATABASE_URL` with `sslmode=require` from a deployed Netlify function first. If the connection fails with a certificate error, download the CA certificate from the Supabase project's Database settings, **remove `sslmode` and any other `ssl*` parameters from `DATABASE_URL`**, and set `SUPABASE_CA_CERT` to the PEM certificate in the Netlify UI with **Functions and Builds** scopes. Redeploy and repeat the connection check. A URL SSL option can override the explicit CA configuration; the app rejects `sslmode` together with a configured CA. Never use `rejectUnauthorized:false` or `NODE_TLS_REJECT_UNAUTHORIZED=0` to bypass certificate verification.

No Active Directory, company SSO, or internal company systems are required. The domain rule admits any verified mailbox in the two allowed domains, not only a local-office roster.

## Operating the contest

The original contest headings and categories are preserved. The announcement's categories differ; changing them is deferred pending explicit confirmation. The announcement's timing is informational, not an automatic schedule: administrators open, pause, resume, and finalize voting manually.

Publish at least one contestant in each category before opening votes. Each entry belongs to one category. Once an entry has votes, its category and published status are locked and it cannot be deleted. Finalizing locks roster changes and voting. Reset is available only in draft or paused state, requires typing `RESET`, and clears votes/draws while preserving contestants; open voting and finalized results cannot be reset. The browser downsizes JPG/PNG/WebP photos before upload; the resulting file must be at most **4 MB**, keeping requests within Netlify's binary payload allowance. Photos are retrieved through authenticated app routes, including checks that ordinary voters can view only published entries.

Organizers can see which account cast each vote. Voters see results only after voting closes.

Optional AI image generation sends the selected photo to **OpenAI for editing**. Confirm the contestant agrees before using the Generate action. Leave `OPENAI_API_KEY` unset to disable it. Generation is still synchronous; provider latency may exceed the hosting timeout. It is not required for uploading photos or voting and needs live hosting validation before enabling it for the event.

## Pre-launch checklist

These checks require the actual hosted configuration; passing local tests is not deployment readiness. Exercise destructive checks with a test Supabase project before loading the live event.

- [ ] All three migrations are applied; `public.auth_attempts` exists with RLS enabled and no `anon` or `authenticated` access.
- [ ] Netlify UI variables include `SITE_URL` and the applicable TLS configuration, scoped to Functions and Builds; the real Netlify-to-database TLS connection succeeds with certificate verification enabled.
- [ ] Supabase and Netlify use nearby us-east regions; the redirect allowlist includes the exact `/auth/callback` URL and both email templates show `{{ .Token }}`.
- [ ] Custom SMTP sends to both `cgi.com` and `cgifederal.com`; OTP, verify, email-send, and provider limits support expected attendance and retries. Test an arrival burst through the hosted app.
- [ ] Each administrator signs in with the exact configured mailbox: `teri.musick@cgi.com`, `zachary.sarver@cgi.com`, `heath.rasnake@cgi.com`, and `morghan.scales@cgi.com`. Alternate mailboxes do not inherit admin access.
- [ ] A returning user and a new signup can enter the email code; a PKCE email link works in the requesting browser. Ineligible domains and plus aliases are rejected; an ordinary voter cannot edit entries or view draft photos.
- [ ] Upload a real phone photo and confirm its orientation, preview, and saved image. If using AI editing, confirm contestant consent and test it on the deployed host before the event.
- [ ] Publish a contestant in each category, open voting, and double-tap a vote confirmation: exactly one vote is recorded. The same account cannot vote again in that category from another browser.
- [ ] Reset while open is disabled in the UI and refused by the API (409). After pausing, typing `RESET` succeeds; after finalizing, reset is refused. Verify voted entries cannot be recategorized, unpublished, or deleted.

## Verification

```sh
npm run lint
npm run build
npm test
TEST_HTTP_PORT=5174 npm run test:http
```

The first test suite validates email/role rules and real PostgreSQL constraints using isolated PGlite. The HTTP suite launches a separate Next.js server on `TEST_HTTP_PORT` (default 5174) with its own build directory and uses temporary data, leaving the interactive preview alone. Local tests do **not** verify Supabase email delivery, hosted connection credentials, or a live Netlify deployment.

Never upload `.env`, `.local-contest`, `.wrangler`, `.next`, `.next-test`, `node_modules`, or build outputs to GitHub.
