# Deploying Boo Ballot with the CLIs

One command sets up a Supabase project, applies the migrations, configures email sign-in, creates a Netlify site, sets its environment, deploys, and checks the live site. It is safe to re-run; it only re-applies configuration. Secrets are never printed.

## Prerequisites (once)

```bash
npm install -g netlify-cli supabase
netlify login
supabase login
```

Node 24 and npm, a Netlify account, and a Supabase account with one organization. Then, in the repository:

```bash
npm ci
```

## First deployment

```bash
node scripts/deploy-setup.mjs --name boo-ballot
```

What it does, in order:

1. Creates a free Supabase project `boo-ballot` in `us-east-1` (near Netlify's default Ohio region) with a generated database password. The password is written only into the Netlify `DATABASE_URL` secret; the dashboard can reset it if ever needed.
2. Reads the project's publishable and secret API keys.
3. Takes the Supabase root CA from the pooler's own TLS chain and proves a verified connection to the transaction pooler. The pooler chain is signed by Supabase's private root, so `SUPABASE_CA_CERT` is always required; `sslmode=require` in the URL is not used.
4. Applies `supabase/migrations/0001`, `0002`, `0003` and checks that every table has RLS, the `costume-photos` bucket is private, and the browser roles have no grants.
5. Creates a Netlify site `boo-ballot-<random>`.
6. Configures Supabase Auth through the Management API: Site URL, the redirect allowlist (`/auth/callback`), OTP and verify rate limits (600 each by default, sized for an office arriving through Netlify's shared egress IPs), and both email templates showing `{{ .Token }}` next to the link. Custom SMTP is set in the same step when the `SMTP_*` variables below are present.
7. Sets the Netlify variables in the production context, scoped to builds and functions: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `DATABASE_URL` (secret, pooler port 6543, no `sslmode`), `SUPABASE_CA_CERT`, `SITE_URL`, and `OPENAI_API_KEY` if you export it.
8. Builds and deploys to the site's production URL.
9. Checks the live site: security headers on `/sign-in`, 401 without a session, a plus-tagged address rejected, a cross-origin sign-in rejected.

At the end it prints the app URL, the dashboard links, and the teardown commands.

## Email: the one thing that stays manual

Supabase's default sender delivers only to members of your Supabase organization, at most 2 emails per hour, and on the free tier Supabase refuses to change the email templates while that default sender is in use. So until custom SMTP is configured the sign-in email shows only a link (no code); the link must be opened in the same browser that requested it. The sign-in page's wording assumes the code is present, which is true once SMTP is set. That is enough to test with your own mailbox (invite it to the organization first) and not enough for an office. Before inviting coworkers, get SMTP credentials from a provider (Resend, Postmark, or your company's relay) with a verified sender domain, then re-run with them exported:

```bash
SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... \
SMTP_SENDER_EMAIL=boo-ballot@example.com SMTP_SENDER_NAME="Boo Ballot" \
node scripts/deploy-setup.mjs --supabase-ref <ref> --netlify-site <site id> --skip-deploy
```

Send one test code to a `cgi.com` and a `cgifederal.com` address afterwards. If company mail runs a link scanner (Safe Links, Mimecast, Proofpoint), the link in the email may be consumed by the scanner; the 8-digit code in the same email still works, which is why both templates show it.

## Re-running and updating

- New code: `netlify deploy --build --prod --site <site id>` from the repository, or re-run the script with `--supabase-ref <ref> --netlify-site <site id>` and `SUPABASE_DB_PASSWORD` exported (the script needs the password to re-verify the database; it never changes it).
- Changing any variable: `netlify env:set --site <site id> --context production --scope builds functions NAME -- "value"`. The `--` matters for values that start with a dash, such as a PEM certificate, and secrets need a non-development context.
- The script refuses to create a second project with the same name; pass `--supabase-ref` to reuse the first.

## Custom domain (optional)

Add the domain in Netlify, then re-run with `--site-url https://your-domain` (or set `SITE_URL` and the Supabase Site URL and allowlist by hand) and redeploy. `SITE_URL` must be the exact origin users open; it drives the email redirect and HSTS.

## Tear down a test deployment

```bash
netlify sites:delete <site id> --force
supabase projects delete <ref>
```

## Lessons from the first hosted run (October 2026)

- The transaction pooler presents Supabase's private root in its chain; a verified connection needs the CA even on the pooler, which is why the script extracts it instead of trying `sslmode=require` first.
- New projects live on the `aws-0-<region>` or `aws-1-<region>` pooler host; the script tries both rather than guessing.
- `netlify env:set` treats a value starting with `-----BEGIN CERTIFICATE-----` as options unless a `--` separator precedes it, and refuses `--secret` without `--context production`.
- The Netlify function reached the database on the first request after the CA was set; the rate-limit table received its first row from a hosted sign-in attempt, which is a cheap way to confirm database connectivity without signing in.
- The auth callback redirects relative to the request host; on Netlify's unique deploy URLs that is the deploy host, on the production URL it is the production host. Users only ever hit the production URL.
