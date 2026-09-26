# Boo Ballot

A local-first, AI-takes-over-Halloween costume contest app with persistent entries, photos, code-free voting, and permanent tie-break records. **No website has been published.**

## Try it on this Mac

The running preview is at **http://localhost:5173/**. Click **Organizer login**, then **Organizer**. The development preview uses a simulated organizer account, `seedy@sites.test`; it does not need a password. This convenience is local-only and must never be exposed as a public development server.

Six fictional sample contestants are included. Their AI-generated portraits are illustrations, including the Viking example; they are not real employee photos.

1. In Organizer, choose **Add contestant**, then use the visible file picker to choose a photo. You can also drag a photo from Photos/Finder onto the drop zone, or copy it in Photos, click the drop zone, and press Command-V. Your JPG, PNG, or WebP (up to 8 MB) appears in the preview immediately. Choose one category per entry and complete the fields.
2. Suggest and edit a tagline. For green-screen photos, optionally choose **Generate category background** if an API key is configured. Review faces, costumes, the background, and the tagline preview, then **Approve & publish**. Publish here means visible in this local contest, not deploying a website.
3. Remove the sample contestants before entering the real event. Keep at least one published entry in every category.
4. **Open voting** starts the live ballot. Attendees can tap a contestant photo or choose its vote button, then confirm one final vote in each category.
5. Add, edit, publish, or remove contestants before or during voting. **Pause voting** stops ballots temporarily, and **Resume voting** relaunches it.
6. **Finalize results** permanently ends voting and locks the roster. In Leaderboard, use **Draw the winner** for any tied category. Each tied entrant has an equal chance; the selected winner, tied entrants, and timestamp are public and saved permanently.

Voting can be paused and resumed as often as needed. **Reset voting round** clears votes and tie-break records while keeping contestants, then returns the event to draft. Finalizing cannot be undone through the app. Use a separate copy/database for rehearsal if you need to preserve the current event. A zero-vote category is shown as having no result; it does not award a random winner.

## Run locally from a fresh checkout

Requires Node.js 22.13+ with npm. From this directory:

```sh
npm ci
cp .env.example .env
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_familiar_nicolaos.sql
npm run dev
```

Run the migration only once for a fresh local database. Subsequent launches use only `npm run dev`. Open the URL printed by the server (normally http://localhost:5173). Keep that terminal open; Ctrl+C stops it. The provided **Start Boo Ballot.command** also starts the already-installed app on this Mac.

Data and uploaded images persist in `.wrangler/state/`, outside source control. Back up that folder with the server stopped to preserve a local event. A random browser-only identifier is stored locally to remember each device's three votes. Never share `.env` or this data directory.

## Optional AI backgrounds

The app works without an AI key: upload a finished image and edit the tagline. Tagline suggestions are built in and require no API key.

To enable image editing locally, add your own OpenAI API key to the ignored `.env` file:

```dotenv
ADMIN_EMAILS=seedy@sites.test
OPENAI_API_KEY=your_key_here
```

Restart the preview. **Generate spooky background** sends the uploaded photo to OpenAI's Images Edit API using `gpt-image-2`, asks to preserve people and costumes, and saves the result in object storage for review. An API account with image-model access and billing is required. The key is server-side only. Generated images may alter faces or costume details; the organizer must review them before publication. Upload a finished image for exact manual control. The editable tagline is composited over the bottom of the image in the app; it is not burned into the uploaded file.

Implementation follows [official OpenAI image-generation documentation](https://developers.openai.com/api/docs/guides/image-generation). Live paid AI generation has not been tested because no API key was supplied.

## Hosting later

Hosting is deliberately deferred. The app currently targets a Cloudflare-compatible Worker, a D1 database (`DB`), and R2 image storage (`BUCKET`). `.openai/hosting.json` records the reserved, unpublished Sites project and logical storage bindings. It does not publish anything by itself.

When ready, one supported path is Sites: build the project, provision the declared bindings, apply the checked-in Drizzle migrations, set `ADMIN_EMAILS` to the real organizer's exact sign-in email, and publish through the Sites workflow. Sites supplies trusted sign-in headers and `/signin-with-chatgpt` and `/signout-with-chatgpt` routes. Keep `OPENAI_API_KEY` as a hosted secret if AI images are wanted. Local data is separate and is not automatically uploaded.

If choosing another host, the server must have a **trusted authentication gateway** that strips visitor-supplied `oai-authenticated-user-*` headers, verifies the organizer login, and injects verified identity headers. The current app trusts those headers because Sites owns them. Do not expose the raw Worker directly without replacing this authentication integration. Set a real organizer email allowlist; missing `ADMIN_EMAILS` denies all admin access. Replace the login links when implementing another identity provider. A plain static host cannot support these persistence and vote-validation requirements.

Public hosting would make published contestant photos, names, and results available to anyone with the link. The current code-free setup prevents repeat votes from the same browser, but clearing browser data or using another browser creates a new voting identity. When you choose a host, we should connect the host's trusted sign-in or workplace access system to enforce one vote per attendee securely. Private or workplace-only viewing can be selected then.

## Validation

```sh
npm run build
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-local.mjs
```

The integration test starts a separate local Worker on port 5174 with a fresh database under `.wrangler/test-<timestamp>`. It does not change the interactive event on port 5173. It checks authorization, code-free browser voting, category eligibility, votes before/after the voting window, concurrent duplicate submissions, three-category ballots, locked entries, totals, and simultaneous permanent tie-break draws. Test databases remain available for inspection.

The server records each vote using a single conditional SQL statement that checks the current voting state and entry eligibility. A random browser identity is hashed server-side; a unique `(browser, category)` database index rejects repeat votes even when simultaneous. Tie draws use cryptographic rejection sampling for equal selection probabilities and a unique category record; concurrent draw requests return the same saved winner and timestamp. Entries can be edited until results are finalized. Client-side disabled buttons are convenience, not the enforcement mechanism.
