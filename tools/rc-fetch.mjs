#!/usr/bin/env node
/**
 * Pull call transcripts out of RingCentral, so nobody has to download them one at
 * a time.
 *
 *   node tools/rc-fetch.mjs --from 2026-08-01 --to 2026-08-07 --out ./transcripts
 *
 * WHY THIS IS A LOCAL SCRIPT AND NOT PART OF THE APP
 * -------------------------------------------------
 * The JWT auth flow trades a long-lived token plus a client secret for an access
 * token. Both are bearer credentials for every recording on the account. Vite
 * inlines `import.meta.env` values straight into the bundle, so putting either in
 * the web app publishes it to anyone who opens DevTools. They stay here, on one
 * machine, in a .env file that is never committed.
 *
 * A browser-based import is possible later via OAuth PKCE (no secret), but only
 * if RingCentral allows browser-origin requests to the endpoints below — verify
 * that with a single test request before building anything on it.
 *
 * SETUP
 *   1. RingCentral Developer Console -> create a "Server-side / JWT" app.
 *      Scopes needed: ReadCallLog, ReadCallRecording, and the AI/RingSense scope
 *      if transcripts are being pulled rather than recordings.
 *   2. Create tools/.env (already gitignored):
 *        RC_SERVER=https://platform.ringcentral.com
 *        RC_CLIENT_ID=...
 *        RC_CLIENT_SECRET=...
 *        RC_JWT=...
 *   3. node tools/rc-fetch.mjs --from 2026-08-01 --to 2026-08-07
 *
 * Zero dependencies: Node 18+ has fetch, and this is two endpoints.
 *
 * Output is written in the same speaker-labelled shape the app already parses, so
 * these files and a manual admin-portal export are interchangeable.
 */
import fs from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1]]);
    return acc;
  }, []));

const OUT = args.out || "./transcripts";
const FROM = args.from;
const TO = args.to || new Date().toISOString().slice(0, 10);
const DRY = !!args["dry-run"];

if (!FROM || args.help) {
  console.log("usage: node tools/rc-fetch.mjs --from YYYY-MM-DD [--to YYYY-MM-DD] [--out DIR] [--dry-run]");
  process.exit(args.help ? 0 : 1);
}

// Minimal .env reader — not worth a dependency.
async function loadEnv() {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), ".env");
  try {
    for (const line of (await fs.readFile(file, "utf8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fall back to the real environment */ }
}

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}. See the setup notes at the top of this file.`); process.exit(1); }
  return v;
};

async function token(server) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: need("RC_JWT"),
  });
  const basic = Buffer.from(`${need("RC_CLIENT_ID")}:${need("RC_CLIENT_SECRET")}`).toString("base64");
  const r = await fetch(`${server}/restapi/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`auth failed (${r.status}): ${await r.text()}`);
  return (await r.json()).access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Recording and AI endpoints are rate-limited hard. Honour Retry-After rather
// than hammering and getting the app throttled account-wide.
async function api(url, accessToken, { asJson = true } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 429 || r.status === 503) {
      const wait = Number(r.headers.get("retry-after") || 10) * 1000;
      console.error(`  rate limited, waiting ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${url}: ${(await r.text()).slice(0, 300)}`);
    return asJson ? r.json() : r;
  }
  throw new Error("gave up after repeated rate limiting");
}

async function callLog(server, accessToken) {
  const out = [];
  let url = `${server}/restapi/v1.0/account/~/call-log?withRecording=true&type=Voice&view=Detailed` +
    `&dateFrom=${FROM}T00:00:00.000Z&dateTo=${TO}T23:59:59.999Z&perPage=250`;
  while (url) {
    const page = await api(url, accessToken);
    out.push(...(page.records || []));
    const next = page.navigation?.nextPage?.uri;
    url = next ? (next.startsWith("http") ? next : server + next) : null;
  }
  return out;
}

// RingSense holds the transcript. If the account does not have it, this returns
// null for every call and the fallback is the admin portal's transcript export —
// which produces the same file shape the app already reads.
async function transcriptFor(server, accessToken, rec) {
  const id = rec.recording?.id;
  if (!id) return null;
  const url = `${server}/ai/ringsense/v1/public/accounts/~/domains/pbx/records/${id}`;
  const data = await api(url, accessToken).catch(() => null);
  if (!data) return null;
  const turns = data.insights?.transcript || data.transcript || [];
  if (!Array.isArray(turns) || !turns.length) return null;

  const when = new Date(rec.startTime);
  return turns.map((t) => {
    const who = t.speakerName || t.speakerId || (t.participantType === "Agent" ? "Agent" : "Speaker");
    const at = t.startTime != null ? new Date(when.getTime() + Number(t.startTime)) : when;
    const stamp = at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `${who} | ${stamp}\n ${String(t.text || "").trim()}`;
  }).join("\n\n");
}

const safe = (s) => String(s || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);

async function main() {
  await loadEnv();
  const server = process.env.RC_SERVER || "https://platform.ringcentral.com";
  console.log(`Signing in to ${server}…`);
  const accessToken = await token(server);

  console.log(`Listing recorded calls ${FROM} → ${TO}…`);
  const calls = await callLog(server, accessToken);
  console.log(`  ${calls.length} call(s) with a recording.`);
  if (DRY) {
    for (const c of calls) console.log(`  ${c.startTime}  ${c.from?.phoneNumber || "?"} -> ${c.to?.phoneNumber || "?"}  ${c.duration}s`);
    return;
  }

  await fs.mkdir(OUT, { recursive: true });
  const manifest = [];
  let written = 0, missing = 0;

  for (const c of calls) {
    const stamp = String(c.startTime).replace(/[:T]/g, "-").slice(0, 16);
    const base = `${stamp}_${safe(c.from?.phoneNumber)}_${safe(c.to?.phoneNumber)}_${safe(c.id)}`;
    const text = await transcriptFor(server, accessToken, c);
    if (!text) { missing++; console.error(`  no transcript for ${c.id}`); }
    else {
      await fs.writeFile(path.join(OUT, `${base}.txt`), text, "utf8");
      written++;
    }
    manifest.push({
      id: c.id, startTime: c.startTime, duration: c.duration,
      from: c.from?.phoneNumber, fromName: c.from?.name,
      to: c.to?.phoneNumber, toName: c.to?.name,
      direction: c.direction, recordingId: c.recording?.id,
      transcript: text ? `${base}.txt` : null,
    });
    await sleep(1200);   // stay well inside the heavy-endpoint budget
  }

  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nWrote ${written} transcript(s) to ${OUT}${missing ? `, ${missing} call(s) had none` : ""}.`);
  if (missing === calls.length && calls.length) {
    console.log("\nNo transcripts came back at all. Most likely RingSense is not enabled on this");
    console.log("account. Export transcripts from the RingCentral admin portal instead — the app");
    console.log("reads that format too, and accepts several files at once.");
  }
  console.log("\nPHI: these files contain patient information. Keep them on this machine and");
  console.log("delete them once the verifications are saved.");
}

main().catch((e) => { console.error("\n" + e.message); process.exit(1); });
