# Hosted attendee kiosk frontend

This is an EDS-compatible frontend shell, not a deployed or production-ready
experience. It uses vanilla JavaScript and scoped CSS. `/download`, existing QR
URLs, the processing app and remote services are unchanged.

## Local demo and DA.live content

The DA.live block content is a single two-column row: `Mode | demo`. The local
fixture is `drafts/attendee-kiosk.plain.html`. Start the local EDS server with:

```sh
npx -y @adobe/aem-cli up --no-open --html-folder drafts
```

Then open `/attendee-kiosk`. In a worktree whose branch creates an overlong
preview DNS label, the CLI may exit before serving. For the authored static
fixture only, run `python3 -m http.server 3017` from the repository root and
open `http://localhost:3017/drafts/attendee-kiosk.html`; this exercises local
EDS scripts and block assets but does not emulate AEM content delivery.

Demo uses only source `demo-people` and
`demo-outputs` Person2/Person3/Person5, resized and JPEG-compressed into
`blocks/attendee-kiosk/assets/`. The visible demo badge and legal copy
distinguish examples from production. No attendee photos or source application
code are copied. Demo never calls the portrait API or starts generation.
Coworker is disabled in demo by default. Explicitly connecting the hosted app
contacts that external service and sends the sample portrait URL and entered name.
The three final “banner” cards are explicitly labeled CSS crops of the selected
sample ad, not generated banner variations.

The portrait picker follows the kiosk typography scale, reserves a fixed
three-column by two-row (six portrait) gallery viewport, and scrolls only inside
the gallery for additional photos. The protected API must provide an ISO
`createdAt` timestamp per portrait;
the picker sorts newest first. Demo timestamps are synthetic and only establish
a deterministic ordering.
Portrait cards use `object-fit: cover` with `object-position: center top` so
cards fill their frames while keeping the top of each portrait visible. A
green availability dot is not shown; selection is indicated by the blue
outline and CSS-drawn check. Name entry uses the same left-copy/right-portrait
layout, with a framed name field and full-size Next button.

Ad selection uses a vertically centered copy pane and a two-by-two grid of
square, uncropped ads without visible caption strips. Brand labels remain
available to screen readers. Select one ad to enable Next; selection stays on
this screen and survives refresh. Only Next submits the selection and continues
to Coworker's simulated audience. This is not the reference's QR-sharing flow.

The welcome screen uses the supplied 10.7-second transparent WebM collage
animation (video only, no audio), a small alpha-preserving WebP fallback poster,
Adobe Clean fonts, the source partner lockup and language toggle, and the
square-edged 1920×1080 kiosk canvas with a rounded notched gradient frame.
Consent uses native list markers, with the Adobe Privacy Policy linked to
Adobe's policy page. Each Photo Release link opens a keyboard-dismissible
modal. The modal displays the supplied English or French release according to
the selected language, without demo labeling or a second-language duplicate.
Language flags appear only on the welcome screen. The selected language persists
through the shell journey and refreshes; attendee restart defaults back to English.
The welcome screen has one Start your creative workflow action. Checking consent
enables and focuses it; native Enter advances. Selected portrait Enter advances
to name entry, whose input autofocuses on entry and refresh. IME composition
Enter does not submit the name form.
The lower-right controls show the configured event name (or Demo Content),
a Settings link to booth configuration, and Reset with attendee-clear confirmation.
The text remains subject to owner/legal approval.
The other shell stages and hosted-app integrations are not a pixel-identical
port.

## Booth Azure settings

Open `/drafts/kiosk-settings.html` for staff setup (EDS block name:
`kiosk-settings`). Glam Creator's Kiosk/EDS Access button must generate an HTTPS
container SAS with exactly read + list permissions and an explicit expiry.
The approved storage account is `ffservices24`; other account hosts are rejected.
Paste it into the masked field, test the connection, choose an event, and save.
The page uses native Blob REST with paginated XML listing; it does not need the
Azure SDK, an account key, or a build step. Expired/denied/CORS/timeout failures
are explicit. There is no fallback to demo.

User-approved container-wide access exposes all events and infrastructure
folders to anyone possessing the SAS. Event dropdown filtering is not an
authorization boundary. The dropdown excludes the same eight infrastructure
prefixes as Glam Creator. CORS must permit GET and `x-ms-version` from the exact
page origin; do not enable write permissions.

Settings are saved under `glam-kiosk-booth-v1` in localStorage on this origin,
including the read/list SAS, optional dedicated create-only request SAS, event ID,
MAX experience, and lead-capture preference. Print scope is `selected` (MAX default)
or `all`; `showFinalQR` controls QR versus pickup presentation independently.
All four templates are always rendered for download. Legacy ending preferences
migrate to QR visibility; `introMode` remains derived from intake selection.
Settings survive browser restarts but are not shared between localhost, preview, live,
or different browsers. Never put a SAS in Git, DA.live, a page URL, analytics,
or logs. A shared-origin script can access this browser credential; this is a
dedicated-booth-machine deployment, not an attendee security boundary.
Clear SAS and settings requires staff confirmation and removes only the
namespaced booth configuration; it does not delete Azure assets or revoke the
token. Attendee restart does not erase booth setup.
Settings use a compact two-column layout on wider screens, with access notes
expandable below the fields. Open kiosk window opens the fixture on the same
origin in a new tab/window using saved settings, not unsaved form edits.
The pre-ad timed interstitial is removed: Coworker and Graph return open ad
selection directly. Sessions previously saved on the pacing stage resume at
ad selection without a delay. Asset readiness checks remain unchanged.

When saved booth settings exist, reload the attendee page to use the Azure
read/list adapter. It retrieves inputs from `{event}/portraits/pending/`,
excluding hidden files, subfolders, non-image files, and `demo_` inputs. Event
portraits sort by Blob Last-Modified descending, followed by the three labeled
static demo portraits. A listing error is displayed, while demo choices remain
usable. Selecting a real portrait never substitutes a demo portrait or ad.

Portrait IDs are deterministic SHA-256 identifiers of the full input blob name.
The matching output stem uses the source's Unicode word/dot/hyphen sanitization.
Duplicate sanitized stems are rejected to avoid ambiguous attendee association.
Ad reads are restricted to `{event}/4-Output/{stem}/`, with the four canonical
brand suffixes in 1–4 order. Duplicate brand candidates are rejected. Four
recognized ads mean ready; `.hub-processed` with missing brands means partial;
`.hub-all-fallback` means failed, taking precedence over ready; otherwise assets
are pending. Hidden processing markers never cause writes. Session identity and
selection are browser-local, not production job requests. Signed URLs are not
stored in attendee session state; images use no-referrer.

The Azure badge distinguishes event assets from explicitly selected demo content.
Demo samples can run without Azure connectivity, but a selected real portrait
requires its own assets. Azure banners remain unavailable. Print and QR require
the new request container and running Glam Creator worker described below. Saved
Marketo preference explicitly blocks intake until the approved integration is
available; it does not fake success. Changing or clearing booth settings in
another tab interrupts the shell and asks for a reload.
Kiosk shell images cannot be dragged; this prevents accidental dragging, not
screenshots or retrieving images already delivered to a browser.

The welcome button is disabled until the attendee checks consent, then turns blue.
Clicking it advances to portrait selection; it does not create a print job or
file. An enabled intake integration continues to block progression until its
approved adapter is available.
Total block assets are about 8 MB.

The kiosk author must publish corresponding DA.live content at the agreed page
path after owner approval. No DA.live page has been created or published.

## Runtime config and production gates

`window.GLAM_KIOSK_CONFIG` can be set before EDS block decoration. The default
mode is `live`; use authored/configured `demo` only for demonstrations. Live
mode requires owner-approved `legal.en` and `legal.fr` copy and never falls back
to demo. Supported fields:

- `mode`: `demo` or `live`.
- `apiBase`: same-origin path under `/api/`, without a trailing slash.
- `mediaOrigins`: exact HTTPS origins allowed for authorized assets.
- `legal`: approved bilingual legal copy; required in live mode.
- `pacingMs`: 0–10000 ms interstitial presentation duration, not job readiness.
- `coworker`: explicit `enabled` flag and HTTPS `url` on the configured
  Coworker origin `https://meow-max2026-lor-coworker-demo-a2137.entapp.adproto.com`.
  In demo, `allowInDemo: true` is also required to opt into the external app.
  Alternatively, `packaged: true` uses the fixed same-origin static entry
  `/coworker/index.html#/loreal/home` instead of Awesome hosting.
  Local HTTP is permitted only for `localhost` and `127.0.0.1`.
- `graph`: explicit `enabled` flag and supplied HTTPS `url`.
- `intake.enabled`: optional; when true, welcome progression is blocked because
  no verified Marketo adapter exists yet.

Provision runtime config through an owner-approved mechanism; do not store JWTs
or other credentials in Git, DA.live content, local fixtures or sessionStorage.
A JWT placed in runtime browser config is still visible to users of that browser;
the hosting owner must approve token scope, lifetime and delivery before enabling.
The local demo's “Connect hosted Coworker” control accepts a supplied token URL
in a masked field. It is held only in the current block's memory and iframe;
it is not stored in source, the fixture, sessionStorage or localStorage. A full
page refresh requires reconnecting. The control dispatches the block event
`glam-kiosk-configure-coworker` with `{enabled:true,allowInDemo:true,url}`.
This does not change the demo portrait API into a live API.
The Coworker screen uses a left-hand copy pane and a large right-hand iframe.
Next continues the shell journey; it does not claim that ads are being generated.
Exit uses the existing attendee restart confirmation.
Creating an iframe or receiving its load event does not prove authentication,
embedding permission, or hosted message compatibility. Those need visual and
end-to-end confirmation. The remote app must allow the kiosk origin in its
embedding policy. Sample `localhost` image URLs may not be retrievable by its
server; hosted authorized image URLs remain a production requirement.

The hosted authentication page exchanges `_jwt` at its own
`/_auth/api/webapp/authorize` endpoint, removes the query parameter, and reloads.
If its session cookie is unavailable in a cross-site iframe, that reload serves
the auth page again, now reporting a missing JWT. The shell cannot set or inspect
that cross-origin cookie or detect the iframe's authentication state.
“Authenticate Coworker in a new tab” and “Retry embedded Coworker” provide a
manual diagnostic path, not a guaranteed fix: top-level and embedded cookies
may be blocked or partitioned differently. The hosted owner must verify the
session cookie's cross-site attributes and an approved embedded-auth flow for
the target browsers. Do not repeatedly append tokens to redirected URLs, proxy
credentials through the kiosk, or weaken browser privacy controls.
FFCPE/Graph hosted URL is not supplied. Neither external app is implemented here.
The source Marketo base/program IDs are 2277/4040 and its native `onSuccess`
handler advances the original UI, but CRM submission, attribution and privacy
behavior require live owner validation before any adapter is enabled.

## Protected API contract proposal

These paths describe a new browser-facing adapter, not the legacy Flask API.
Do not point the browser at legacy submit/completion routes: they can trigger
processing, mutate/delete blobs, or resolve the latest output. Every call below
must require server-side workstation/event authorization, enforce portrait
ownership on reads and writes, and protect cookie-authenticated mutations from
CSRF. The client uses same-origin credentials, `no-store`, refuses redirects,
and aborts requests after 15 seconds. API must return only authorized
portrait-keyed assets; any signed URLs must be short-lived and use configured
media origins.

| Request | Response |
| --- | --- |
| `GET {apiBase}/portraits` | `{portraits:[{id,label,thumbnailUrl,createdAt}]}` |
| `GET {apiBase}/portraits/{portraitId}/manifest` | `{portraitId,status,ads:[{id,label,url}],banners:[{id,label,url}]}` |
| `PUT {apiBase}/sessions/{sessionId}` | `{sessionId,portraitId}` |
| `PUT {apiBase}/sessions/{sessionId}/selection` | `{sessionId,portraitId,adId}` |

Client session body is `{portraitId,name,consent}`; selection body is
`{portraitId,adId}`. Session ID is a browser-generated UUID, persisted before
the idempotent resume/create request. These PUTs must only associate identity
and selection; they must not enqueue work, rename blobs or generate images.
Session expiry, authentication, authorization, event scoping and concurrency
remain backend responsibilities.

IDs must match `[a-zA-Z0-9_-]{1,128}` and be unique. Portrait lists cap at 100.
Each portrait `createdAt` must be a valid ISO date-time; results display in
descending timestamp order, newest first.
Manifest status is `pending`, `partial`, `ready` or `failed`; ready requires
exactly four unique ads (in Coworker's canonical order), and banners cap at 20.
Partial assets cannot be selected. On refresh the client revalidates portrait
ownership and selection membership; it never asks for a latest job. State stores
portrait ID, name, language, current stage, session ID and selected ad ID, but
never URLs or credentials. Restart clears only the namespaced state in this
browser; it makes no production API mutation.

## Hosted shell messages and terminal boundaries

Packaged Coworker must emit `KIOSK_READY` after registering its bridge listeners.
On initial story entry, the shell sends `KIOSK_FOCUS_HOME_SEND` once per ready
frame after identity. The child focuses its enabled home Send after rendering
and acknowledges with `KIOSK_HOME_SEND_FOCUSED`. Attendee interaction cancels
pending child focus; continued simulation does not receive this request. Native
Simulation return instead sends `KIOSK_SIMULATE` followed by
`KIOSK_FOCUS_SIMULATION_COMPOSER` once per selected-ad/frame pairing.
The child waits for the guided prompt and enabled editor, focuses it, and emits
`KIOSK_SIMULATION_COMPOSER_FOCUSED`. Native Enter advances its existing beat;
shell rerenders do not restart simulation or steal focus.
Enter sends the first Coworker prompt. The initial story has no shell Next;
Jump to Ads opens the selected portrait's ad selection directly without resetting
attendee identity or bypassing asset readiness. Continued story has no shell Next;
Exit the experience resets Coworker and returns directly to the activation welcome.
Reset ignores child navigation and cancels pending shell loads during the handshake.
Asset retrieval retains the current screen, marking its controls inert and the
panel busy until the next screen is ready, rather than showing a transient loading
page. Pending, partial and failed manifests still display their explicit states.
The shell requires the configured iframe window and exact origin before marking
it ready and sending identity or selected-ad messages. Awesome mode retains its
load-event timing because that app's ready handshake is unverified.
The package is built outside this EDS repository; EDS Code Sync does not build
Vite source. Static entry delivery, routing, CSP, asset paths, and the complete
packaged journey must be verified separately before publication.
The local HTML fixture enables the packaged integration explicitly. The current
L'Oréal-only deployment bundle in `coworker/` is about 6.9 MB (main JavaScript
about 5.35 MB raw); it is a working proof package, not performance-optimized.
Generated assets are excluded from source ESLint; upstream source owns their
build and checks. Rebuild with `pnpm package:eds` in the Coworker source project,
then replace the deployment package as one matching entry/assets set.

Messages to the configured Coworker iframe use exact `targetOrigin`.
`KIOSK_SET_NAME {name,portrait}` and `KIOSK_SIMULATE {adIndex,adUrl}` use
absolute image URLs; `adIndex` is 1-based. Incoming `KIOSK_NAV` messages require
the configured iframe's `contentWindow`, exact origin and expected stage:
`view-select` means request ad selection; `view-processing-max` and
`view-variations-max` mean continue to the final thumbnail presentation and are
accepted only in the continued stage. Neither message starts a job. Actual hosted
compatibility is not verified. Restart sends the proposed `KIOSK_RESET` message
to the configured Coworker origin, then removes the iframe; the hosted app's
support for that message is not verified. The shell never writes cross-origin
storage.
For packaged Coworker, restart instead waits up to five seconds for an
origin/source-validated `KIOSK_RESET_DONE` acknowledgment before removing the
iframe and clearing the shell session. Timeout surfaces an incomplete restart
error rather than claiming the attendee was cleared.
The legacy workflow message `GLAM_JOB_START {portrait,stem}` is not sent.

Graph opens in a separate tab with `noopener,noreferrer`; return is a deliberate
shell button so a Tampermonkey booth helper may bring the existing tab forward.
This shell does not read a cross-origin page or close arbitrary windows. Graph
postMessage return is not enabled.

The former print/QR/QR-print split is superseded by always rendering four
personalized templates, with selected/all fulfillment and independent final QR
visibility. Demo selections never create production print requests.

## Azure print requests and attendee shares

This is a local implementation contract, not a provisioned/live-tested service.
Generate separate create-only access for `glam-kiosk-requests` in Glam Creator.
Settings reject photography write access and any request token granting read,
write, list or delete. Ordinary container SAS has no event-prefix restriction;
the dedicated container is the isolation boundary. Saving validates token format
only and does not perform a test write. Blank request access explicitly disables
live submission. Existing portrait read/list access remains separate.

Confirming a real selected ad creates an immutable schema-version-1 JSON request
at `{event}/requests/{requestId}.json` in the dedicated container with:
`requestId` (UUID v4), `eventPrefix`, `portraitId`, `attendeeName`, `selectedBrand`
(`larocheposay`, `lorealprofessionnel`, `yslbeauty`, `lorealparis`),
`printScope`, `showFinalQR`, `lang`, and `createdAt`.
The shell saves the entire unsigned request in sessionStorage before its first
PUT, using `If-None-Match: *` and `x-ms-blob-type: BlockBlob`. Failed/ambiguous
submissions retry the same ID/body; selection is locked after an attempt.
Duplicate responses await worker status, not a fabricated processed result.
Reset clears local attendee state but does not cancel already submitted work.

Glam Creator resolves portrait IDs from its own canonical inputs and manages
rendering, leases, restart checkpoints, and fulfillment. It publishes internal
status to `{event}/requests-status/{requestId}.json` in the asset container.
Required status: `schemaVersion`, matching `requestId`, `portraitId`,
`eventPrefix`, `selectedBrand`, full matching `request`, `render.status`
(`pending`, `running`, `rendering`, `ready`, `partial`, `failed`, `error`), `render.brands`,
`fulfillment.scope`, `fulfillment.status` (`pending`, `partial`, `submitted`, `failed`),
and `fulfillment.brands`. Ready templates have per-brand `status: ready` and
`blob: {event}/7-Share-Output/{requestId}/{brand}.jpg`. Submitted fulfillment
has per-brand `status: submitted` and
`blob: {event}/6-Print-Output/{requestId}__{brand}_print.jpg`.
Only requested print brands enter that existing folder; photographer scripts
and S3 mirroring remain unchanged. Submitted means fulfillment handoff, not
confirmed physical printing.

Internal `share` provides `downloadPageUrl`, `expiresAt`, and
`qrBlob: {event}/7-Share-Output/{requestId}/qr.png`. The worker reserves the
attendee manifest before rendering and generates this PNG from its stable URL.
The kiosk uses its read SAS only to display the PNG; the encoded QR contains
an attendee-specific blob-read SAS, never the kiosk container credential.
The continued story's personalized-ads control and child completion navigation
open the ending screen. It polls every five seconds, shows explicit processing/
failure states, and gates pickup on submitted fulfillment. The QR appears as
soon as a valid attendee share link is published, even while templates are
pending. Its download page shows processing progress and adds images as they
become ready. Refresh resumes status lookup without a new submission.
The ending screen says Thank you (Merci), with side-by-side Refresh and Exit
controls. On desktop its right side displays the selected personalized template
and, when enabled/ready, an image-only clickable QR opening the attendee download
page in a new tab. On smaller screens the preview and QR stack below the copy.

The attendee URL uses existing `/download?session=<encoded manifest URL>`.
Its manifest at `{event}/7-Share-Output/{requestId}/session.json` has
`schemaVersion: 1`, `requestId`, `portraitId`, `name`, `status`
(`pending`, `partial`, `ready`, `failed`), `createdAt`, `expiresAt`, and four
`images: [{brand, filename, status, url}]`. Image status is `pending`, `ready`,
or `failed`; unfinished entries have null URLs. Each finished image and the
manifest have individual blob-read SAS with the same 30-day expiry. No renewal
service is required: EDS remains available but access expires.
Download polling stops after five minutes; reload checks again. Expired/invalid
shares display an explicit error. Legacy `img` links and old session manifests
remain supported. No browser key, public gallery, or QR encoding service is used.

Azure CORS must separately permit the intended EDS origins to PUT the request
container using `Content-Type`, `x-ms-blob-type`, `x-ms-version`, and
`If-None-Match`, and allow GET of attendee manifests/images. This implementation
does not provision containers, modify CORS, or make real InDesign calls.
Run `node --experimental-default-type=module tests/kiosk-fulfillment.mjs` for
request/settings/state/status mock checks and `npm run lint` for repository lint.
Run `npm exec --yes --package=playwright -c 'node tests/kiosk-fulfillment-browser.cjs "$(command -v playwright)"'`
with the local fixture server on port 3017 and installed Chrome for mocked browser
coverage of retries, refresh, status/QR, expiry, legacy downloads and staff settings.

## Workstation setup and verification

Attendee Macs need only the approved browser and Tampermonkey helper; no local
Node, Python, Flask, Homebrew, Xcode, certificates or background processing.
Developers use the EDS CLI above. `npm run lint` is the repository lint command.
`npm run lint` passes. The authored fixture passed a Chromium/Playwright demo
journey covering consent, portrait/name association, story, Graph return, all
four ads, selection, refresh, bilingual state, banner placeholders and restart.
A mocked live journey confirmed `KIOSK_NAV` `view-select` enters the pacing and
ad-selection flow, `view-processing-max` reaches banners, and an HTTP 503 shows
an explicit error without demo fallback. Node module assertions cover the API
schema, portrait binding, origin allowlist, abort/timeout behavior, session
invariants and iframe source/origin checks. Desktop kiosk and mobile viewport
renders were checked locally. These are frontend checks, not a live
integration, accessibility audit or DA.live/feature-preview validation.
Live authorization, API, legal text, Marketo, Coworker JWT/runtime delivery,
Graph URL, print/QR services, DA.live content and feature-preview QA are
deployment gates, not claims of this frontend slice.
