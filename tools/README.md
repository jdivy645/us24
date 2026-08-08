# tools

## rc-fetch.mjs — pull call transcripts from RingCentral

```
node tools/rc-fetch.mjs --from 2026-08-01 --to 2026-08-07 --out ./transcripts
node tools/rc-fetch.mjs --from 2026-08-01 --dry-run     # list the calls, download nothing
```

Writes one `.txt` per call plus a `manifest.json`, in the same speaker-labelled
format the app already reads — so its output and a manual admin-portal export are
interchangeable. Drop the whole folder onto the app's transcript panel; it accepts
several files at once and queues them.

### Why this is a script and not a button in the app

The JWT auth flow needs a client secret. Vite inlines `import.meta.env` values into
the bundle, so a secret in the web app is published to anyone who opens DevTools.
It stays here, on one machine, in `tools/.env` (gitignored).

A browser-based import is possible later using OAuth PKCE, which needs no secret —
but only if RingCentral allows browser-origin requests to the call-log and
recording endpoints. Verify that with one test request before building on it.

### Setup

1. RingCentral Developer Console → create a **Server-side / JWT** app.
   Scopes: `ReadCallLog`, `ReadCallRecording`, plus the AI/RingSense scope.
2. Create `tools/.env`:
   ```
   RC_SERVER=https://platform.ringcentral.com
   RC_CLIENT_ID=...
   RC_CLIENT_SECRET=...
   RC_JWT=...
   ```
3. Run it.

No dependencies — Node 18+ has `fetch`, and this is two endpoints.

### Before this can work

Three questions for the RingCentral account team, all of which gate the API route
and none of which are code:

1. **Is RingSense on our plan?** It is what holds the transcript. Without it this
   script finds recordings but no text.
2. **Is it covered by our BAA?** AI features are commonly carved out of the base
   agreement, and these calls carry PHI.
3. **What is the transcript retention policy?** It sets how far back `--from` can
   usefully reach.

If the answer to 1 or 2 is no, nothing is blocked: export transcripts from the
RingCentral admin portal and upload them to the app directly. That path needs no
API, no app registration, and no review.

Separately, `ReadCallRecording` is a sensitive scope — a RingCentral app must pass
security review to leave sandbox and reach production data. That review, not the
code, is the schedule risk. Start it early.

### PHI

Downloaded transcripts contain patient information. They are gitignored, they
belong on one machine, and they should be deleted once the verifications are
saved.
