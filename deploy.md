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
6. Configures Supabase Auth through the Management API: Site URL, the redirect allowlist (`/auth/callback`), OTP and verify rate limits (600 each by default, sized for an office arriving through Netlify's shared egress IPs), and both email templates showing only the `{{ .Token }}` code (no link; see Email below). Custom SMTP is set in the same step when the `SMTP_*` variables below are present.
7. Sets the Netlify variables in the production context through the API: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `DATABASE_URL` (secret, pooler port 6543, no `sslmode`), `SUPABASE_CA_CERT`, `SITE_URL`, and `OPENAI_API_KEY` if you export it. They apply to all scopes: restricting a variable to builds and functions is a paid Netlify feature, and the CLI's `env:set` fails silently when `--scope` is given on the free plan.
8. Builds and deploys to the site's production URL.
9. Checks the live site: security headers on `/sign-in`, 401 without a session, a plus-tagged address rejected, a cross-origin sign-in rejected.

At the end it prints the app URL, the dashboard links, and the teardown commands.

## Email: custom SMTP is required

Supabase's default sender delivers only to members of your Supabase organization, at most 2 emails per hour, and the first hosted run found it would not accept template changes either, so the email carried only a link. The script therefore refuses a production deploy without `SMTP_*` variables unless you pass `--allow-default-sender` for a throwaway test.

The live contest uses **Cloudflare Email Service** over authenticated SMTP, sending from `no-reply@booballot.zacksarver.dev`. The sending subdomain is onboarded in the zacksarver.dev zone (Cloudflare adds the SPF, DKIM, DMARC and bounce records itself) and the account quota is 1,000 emails per day on Workers Paid. The SMTP password is a Cloudflare API token with the single permission **Email Sending: Edit**, kept in the macOS Keychain, never in a file or in chat:

```bash
security add-generic-password -a booballot -s booballot-smtp -w   # paste the token once
SMTP_HOST=smtp.mx.cloudflare.net SMTP_PORT=465 SMTP_USER=api_token \
SMTP_PASS="$(security find-generic-password -a booballot -s booballot-smtp -w)" \
SMTP_SENDER_EMAIL=no-reply@booballot.zacksarver.dev SMTP_SENDER_NAME="Boo Ballot" SMTP_EMAIL_LIMIT=600 \
node scripts/deploy-setup.mjs --name boo-ballot --site-url https://booballot.zacksarver.dev --test-email you@cgi.com
```

Any other SMTP provider works the same way; only the five `SMTP_*` values change. `--test-email` requests a real sign-in code for that address after the deploy, which proves Supabase can hand mail to the SMTP server; a 503 there means the server rejected it. Delivery into a Microsoft 365 inbox still has to be checked by a person: send one test code to a `cgi.com` and a `cgifederal.com` address afterwards. The templates contain **only the code, no link**: in the first production test CGI's mail scanner opened the link 9 seconds after delivery, which consumes the one-time token and invalidates the code in the same email. The `/auth/callback` route still exists but nothing links to it.

Budget for the night: about 200 attendees over roughly five minutes, around 600 emails with resends. Supabase's limits are set by the script to 600 code requests and 600 verifications per five minutes and 600 emails per hour (`SMTP_EMAIL_LIMIT`).

## Photo storage: Cloudflare R2

Supabase Storage works but its free plan allows 5 GB of egress a month, and every photo view streams through the Netlify function from storage. 150 voters each loading 60 photos is already at that cap, and once an organization exceeds a free quota Supabase's fair-use policy makes **every** request to the project return 402 until the billing period resets. R2 has no egress charge, so the live contest stores photos in the R2 bucket `boo-ballot-photos` (Cloudflare account `a552afac64b9829b0be26fa76cf8e556`, location hint ENAM). The app selects R2 when the four `R2_*` variables are present and otherwise falls back to Supabase Storage; the database stores only the photo's UUID key, so nothing in the schema changes.

Credentials come from an R2 API token, which only the dashboard can create (the `cf` CLI's OAuth session is not authorized to manage API tokens): **R2 → Manage R2 API Tokens → Create API token**, permission **Object Read & Write**, scoped to the single bucket, no TTL. Store the two values in the Keychain once, then re-run the script with the bucket flags:

```bash
security add-generic-password -a boo-ballot-photos -s r2-access-key-id -w       # paste the Access Key ID
security add-generic-password -a boo-ballot-photos -s r2-secret-access-key -w   # paste the Secret Access Key
SMTP_HOST=smtp.mx.cloudflare.net SMTP_PORT=465 SMTP_USER=api_token \
SMTP_PASS="$(security find-generic-password -a booballot -s booballot-smtp -w)" \
SMTP_SENDER_EMAIL=no-reply@booballot.zacksarver.dev SMTP_SENDER_NAME="Boo Ballot" SMTP_EMAIL_LIMIT=600 \
node scripts/deploy-setup.mjs --supabase-ref mrgcmqxkqjvbndqljxtu --netlify-site 60186a4a-7ef2-41ae-a8f6-b7ff43e8b8c3 \
  --site-url https://booballot.zacksarver.dev --r2-account a552afac64b9829b0be26fa76cf8e556 --r2-bucket boo-ballot-photos
```

The script signs a HEAD request for an impossible key before it changes anything: 404 proves the token and bucket, 403 means a wrong key or a token scoped to another bucket. Photos uploaded to Supabase Storage before the switch are not copied; re-upload them. Without `--r2-bucket` the script still deploys but warns about the Supabase egress cap.

## Custom domain

`--site-url https://booballot.zacksarver.dev` makes the script set that hostname as the Netlify site's custom domain. DNS is a single unproxied CNAME in Cloudflare from `booballot.zacksarver.dev` to the site's `*.netlify.app` host; Netlify issues the certificate a few minutes after it resolves. The sending subdomain's own records live under `cf-bounce.booballot` and `_dmarc.booballot`, so they do not collide. Until the certificate is live, the script's live checks fall back to the `netlify.app` URL; re-run with `--skip-deploy --supabase-ref <ref> --netlify-site <site id> --test-email …` once the custom domain answers.

## Re-running and updating

- New code: `netlify deploy --build --prod --site <site id>` from the repository, or re-run the script with `--supabase-ref <ref> --netlify-site <site id>`. The script needs the database password to re-verify the connection; it reads it from the macOS Keychain (service `supabase-db`, account `<ref>`, where it saved it at creation) or from `SUPABASE_DB_PASSWORD`. It never changes the password. If the password is lost, reset it in the Supabase dashboard (Project Settings → Database) and store it with `security add-generic-password -a <ref> -s supabase-db -w`.
- Changing any variable: `netlify env:set NAME "value" --site <site id> --context production` (name and value first, options after, no `--scope`), then redeploy. For a value that starts with a dash, such as the PEM certificate, re-run the script instead; it uses the API. Secrets need a non-development context.
- The script refuses to create a second project with the same name; pass `--supabase-ref` to reuse the first.

## Tear down a test deployment

```bash
netlify sites:delete <site id> --force
supabase projects delete <ref>
```

## Before contest night

- Confirm the production environment has the four `R2_*` variables (Netlify UI → Site configuration → Environment variables) so photos are not quietly on Supabase Storage.
- Free Supabase projects pause after 7 idle days. Open the dashboard the week of the event and confirm the project is active; resume it if not. Any sign-in attempt through the app keeps it active.
- Check the Cloudflare Email Service dashboard for the day's quota and that the wedding sender is not also busy on the 31st; both share the 1,000 per day account limit.
- Send a test code from the office network and confirm it arrives with the code visible and not in junk. Cloudflare's Email Sending activity log (or the `emailSendingAdaptive` GraphQL dataset) shows per-message delivered/failed status; "delivered" plus no email in the inbox means the corporate filter has it (junk or quarantine), so ask IT to allowlist `booballot.zacksarver.dev`.

## Lessons from the first hosted run (October 2026)

- The transaction pooler presents Supabase's private root in its chain; a verified connection needs the CA even on the pooler, which is why the script extracts it instead of trying `sslmode=require` first.
- New projects live on the `aws-0-<region>` or `aws-1-<region>` pooler host; the script tries both rather than guessing.
- `netlify env:set` (CLI 27.x) prints nothing and sets nothing when the request is refused; `--scope` is refused (Forbidden) on the free plan. The script sets variables through `netlify api createEnvVars`/`updateEnvVar` and verifies them afterwards. `sites:create` prints colored output that must be stripped before parsing.
- A database password reset in the Supabase dashboard takes about a minute to reach the pooler; a `28P01` right after a reset is propagation, not a wrong password.
- `netlify deploy --build` installs the Next.js plugin locally and that pulls in puppeteer, whose browser download can fail on a stale `~/.cache/puppeteer`; the script sets `PUPPETEER_SKIP_DOWNLOAD=1` for the build.
- After a custom domain is set, Netlify's `ssl_url` for the site already reports that domain, so the fallback for live checks must build the `*.netlify.app` host from the site name. The custom-domain certificate takes a few minutes after the CNAME resolves; until then the host serves Netlify's wildcard certificate.
- The Netlify function reached the database on the first request after the CA was set; the rate-limit table received its first row from a hosted sign-in attempt, which is a cheap way to confirm database connectivity without signing in.
- The auth callback redirects relative to the request host; on Netlify's unique deploy URLs that is the deploy host, on the production URL it is the production host. Users only ever hit the production URL.
- `supabase projects api-keys` (CLI 2.120) prints the `sb_secret_` key masked with bullet characters unless `--reveal` is passed, and `-o json` does not change that. The first hosted run stored the masked string as `SUPABASE_SERVICE_ROLE_KEY`, which produced a 500 on every photo upload (Netlify function log: `StorageApiError: Invalid Compact JWS`, 403 AccessDenied). The script now passes `--reveal` and refuses a key containing non-printable characters. Function logs are read with `netlify logs --source functions --since 2h --json` after `netlify link --id <site id>`.
- Photo views are not CDN-cached (the response is private because it is gated by the session), so storage egress scales with voters × photos. Supabase free caps egress at 5 GB a month and the fair-use response is a project-wide 402, which is why photos moved to R2.
- Netlify's Node sends a `Request` object's body as a stream, so passing aws4fetch's signed `Request` straight to `fetch` produces a chunked upload that R2 rejects with `411 MissingContentLength` (seen in the function log on the first R2 deploy). The storage module signs with `client.sign()` and then calls `fetch(url, {headers, body: bytes})` so Node sets `Content-Length` itself. A smoke test against the real bucket (`put`, `get`, `head`, duplicate `put` → 412, `delete`) is the quickest check after touching that module.
- Storage hygiene lives in the contest API, not in a scheduler: every save and delete removes the replaced photo (if unreferenced) and sweeps up to 25 unattached objects older than an hour, so the bucket only ever holds photos the roster points at plus whatever is being edited right now.
