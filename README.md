# Boo Ballot — Netlify edition

Private coworker costume voting, prepared for **Netlify + Supabase**. No hosted deployment or live email sender has been configured yet.

## What is ready

- Standard Next.js app and Netlify build configuration.
- PostgreSQL schema, unique account/category votes, saved tie draws, and private Supabase photo storage.
- Email-code sign-in with server-verified Supabase users. Only exact `cgi.com` and `cgifederal.com` domains may enter.
- Four administrators: `teri.musick@cgi.com`, `zachary.sarver@cgi.com`, `heath.rasnake@cgi.com`, `morghan.scales@cgi.com`. Everyone else has viewing/voting access only.
- Stable Supabase user IDs identify ballots across devices and email changes. This is one ballot per account, not proof that a person has only one company account.
- Previous local test contestants and their linked uploaded photos were removed. New databases start empty. Nothing is copied from old Cloudflare storage.

## Local preview

Requires Node.js 24 and npm. Run `npm ci`, then `npm run dev`, or use `Start Boo Ballot.command` on this Mac. Open http://localhost:5173.

With no Supabase environment variables, expand **Local testing** on the sign-in page and choose Organizer or Voter preview. The controls exist only in local development, bind to loopback, and do not send email. Production ignores all preview cookies and requires a verified Supabase session.

To add the six fictional sample contestants for local testing, run `node scripts/seed-local-preview.mjs` while the preview is running. Samples are never automatically added to a hosted database.

Local data persists in ignored `.local-contest/` (PostgreSQL via PGlite and local photo files). Do not share that folder. Local and hosted data are separate.

## Connect Netlify and Supabase

1. Create a Netlify account and a Supabase project. No paid purchase is automated.
2. Run these SQL files in the Supabase SQL Editor, in order:
   - `supabase/migrations/202610070001_contest.sql`
   - `supabase/migrations/202610070002_private_storage.sql`
   These create empty contest tables with row-level security, revoke browser database access, and create a **private** `costume-photos` bucket. The server accesses the database; there are intentionally no browser read/write policies.
3. Add the environment variables from `.env.example` to Netlify, scoped to Functions and Builds:
   - `DATABASE_URL`: Supabase transaction-pooler PostgreSQL URL with `sslmode=require`. Keep the database password secret.
   - `SUPABASE_URL`: your project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: the project's publishable (or legacy anon) key.
   - `SUPABASE_SERVICE_ROLE_KEY`: server-only storage access. Never prefix this with `NEXT_PUBLIC_`.
   - `OPENAI_API_KEY`: optional, paid image generation; leave unset if unwanted.
4. In Supabase Authentication, enable Email and require email confirmation. Configure the email template to display `{{ .Token }}` for both initial signup confirmation and subsequent magic-link/OTP messages. The app accepts six- to eight-digit codes. Set the Site URL to the final Netlify URL. Disable unused login providers.
5. **Set up custom SMTP before inviting coworkers.** Supabase's default sender is restricted to project-team addresses and very low sending limits. Configure a production sender (for example Resend, Postmark, or another SMTP provider), verify a sender domain you control, and raise auth email limits for 100+ people arriving together. Do not attempt to verify company DNS without authorization. Test delivery to both company email domains and allow time for spam filtering. This account/sender setup is still pending.
6. Connect GitHub to Netlify. If the repository contains this app in `boo-ballot/`, use the repository-root `netlify.toml`. If this folder is the repository root, use its own `netlify.toml`. Build: `npm run build`; publish: `.next`; Node: 24. Netlify automatically supplies its Next.js adapter.
7. Use separate Supabase projects for test deployments and the live contest so preview changes cannot affect real ballots. Do not place production secrets into untrusted PR previews.
8. Before sharing, verify sign-in mail, exact-domain restrictions, all four admin accounts, ordinary-voter denial of edits, private image URLs, duplicate votes across browsers, and an upload from a phone.

No Active Directory, company SSO, or internal company systems are required. The domain rule admits any verified mailbox in the two allowed domains, not only a local-office roster.

## Operating the contest

The original contest headings and categories are preserved. The announcement's categories differ; changing them is deferred pending explicit confirmation. The announcement's timing is informational, not an automatic schedule: administrators open, pause, resume, and finalize voting manually.

Publish at least one contestant in each category before opening votes. Each entry belongs to one category. Finalizing locks roster changes and voting; a reset clears votes/draws but preserves contestants. Uploaded JPG/PNG/WebP files must be at most **4 MB**, keeping requests within Netlify's binary payload allowance. Photos are retrieved through authenticated app routes, including checks that ordinary voters can view only published entries.

Optional AI image generation is still synchronous; provider latency may exceed the hosting timeout. It is not required for uploading photos or voting and needs live hosting validation before enabling it for the event.

## Verification

```sh
npm run build
node scripts/test-local.mjs
node scripts/test-http.mjs
```

The first test suite validates email/role rules and real PostgreSQL constraints using isolated PGlite. The HTTP suite launches a separate Next.js server on port 5174 and uses temporary data, leaving the interactive preview alone. Local tests do **not** verify Supabase email delivery, hosted connection credentials, or a live Netlify deployment.

Historical Cloudflare files in `drizzle/`, `.openai/`, and old framework helpers are retained as references; they are not the deployment path. Do not publish old ZIP archives: they predate these changes. Never upload `.env`, `.local-contest`, `.wrangler`, `.next`, `.next-test`, `node_modules`, or build outputs to GitHub.
