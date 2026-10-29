# Hosted attendee kiosk frontend

The demo draft explicitly configures the approved hosted public-cutout origin.
Localhost previews read the bundled public-cutout index on their own origin
(EDS does not grant cross-origin index reads), but Graph receives only validated
HTTPS URLs on that approved hosted origin. This applies only to synthetic demos;
live portrait access and genuine missing-mapping fallback are unchanged.

## Light and dark activation appearance

In `/drafts/kiosk-settings.html`, **Activation appearance** switches between
**Light** and **Dark**. Selecting an option saves it immediately in the separate
`glam-kiosk-appearance-v1` browser preference, including for no-SAS offline demos.
No Test connection or Save booth settings click is needed. Existing booth
`appearance: "light" | "dark"` values remain the fallback; older settings default
to light. The preference updates other open kiosk tabs on the same origin immediately,
without restarting the attendee or losing typed input. Other setup changes
retain the existing reload requirement.

Valid saved connection settings and their event can be reused when saving booth
options; changing appearance does not require another Azure connection test.
Changing the container SAS URL requires testing again before saving. Test
connection also refreshes the list of available events.

Both appearances use the same DOM, copy/localization, session state and API
paths. Dark styling lives in `dark.css`, scoped by
`.attendee-kiosk[data-appearance="dark"]`. The Figma source artwork supplies the
black patterned background, red Adobe/white L'Oréal lockup and MAX name-page
lens. The selected portrait remains dynamic inside that lens. Ad selection
uses a gradient border without changing ad order or selection behavior.
The original light styling and assets remain the default.

Dark typography follows the MAX 2026 hierarchy: Adobe Clean Display Black for
page headlines, Display ExtraBold for section/dialog headings, and Adobe Clean
Regular/Bold for body copy and controls. The required font files are self-hosted
in this block's `assets/` directory; `dark.css` declares the faces and keeps their
use scoped to the dark activation. Light typography and embedded application
fonts are unchanged.

The packaged Coworker receives `KIOSK_SET_THEME {theme: "light" | "dark"}` after
ready and on parent appearance changes. Coworker validates exact parent source,
origin and enum before applying its shared ThemeProvider. Repeated notifications
of the same activation default preserve the attendee's manual Coworker theme
toggle; a changed activation default applies immediately. A fresh iframe or
reset reapplies the activation default. No copy or story flow is duplicated.

## Firefly Graph destination

In booth settings, **Firefly Graph view** selects **Current editor** (the default)
or **New capsule**. This independent browser preference
(`glam-kiosk-graph-view-v1`) saves immediately without Azure access and updates
open kiosk tabs without resetting the attendee. Reopen Graph from Coworker to
use a changed destination; already-open Graph tabs are not redirected.
The shell sends `KIOSK_SET_GRAPH_VIEW {view: "editor" | "capsule"}` on Coworker
readiness and preference changes. Coworker retains its existing editor URL or uses
`https://firefly.adobe.com/graph/capsule/id/urn:aaid:sc:US:45c92fd6-df31-4aba-8d1b-3d8135c2d998`,
with the same portrait handoff and return behavior. Clearing booth settings resets
the selection to the current editor.

## Opening screen transitions

The production workflow panel retains the gallery's Finish action and adds
the same action at the panel's lower right when finishing is available.
Finish closes the panel before using the existing ending flow; it does not
create another request. Close, Escape and backdrop dismissal slide the panel
out to the right and restore focus to its opener. Reduced-motion preferences
use a short fade. Stage changes dispose the panel immediately.

`opening-transitions.js` animates only welcome → portraits → name → story
navigation, not initial loads, refreshes or Coworker story beats. The gallery
enters with a capped stagger, the selected portrait moves into its name-page
position, and the Coworker frame reveals from the right. The header remains
stationary. Both appearances share this motion; the dark MAX lens also
assembles around the portrait.

Animations do not delay rendering, input or integration loading. Temporary
outgoing panels are inert and hidden from assistive technology. Portrait
overlays are transient DOM images, never persisted. Navigation cancels and
cleans up active animation/overlays. Reduced-motion preferences use short
opacity fades instead of movement.

## Permanent demo people

With booth settings configured, the kiosk reads the global blob
`assets/permanent-demos/catalog.json` using the existing read-only container access.
Only a 404 uses the original bundled Person2/3/5 fixtures. A published empty
catalog, disabled people, or people without the selected Template Set profile
show no demo cards. Network, authorization and schema errors are explicit errors,
not a fallback to old demo content.

Catalog v1 contains `schemaVersion: 1`, a 32-character lowercase hexadecimal
`revision`, `experienceTemplateSets: {main, max}`, and `people`. Each person has
stable `demo_*` ID, `name`, `enabled`, non-negative integer `order`, and `profiles`
keyed by Template Set ID. The current MAX shell uses the explicit `max` mapping,
including custom set assignments; event names do not choose demo profiles.
Each published profile has `demo: true`, UUID-hex `version`, SHA-256
`templateFingerprint`, `portrait`, and four canonical-brand maps:
`ads`, `cutouts`, `variations`, `printPreviews`. Each asset is `{blob, mimeType}`;
variation entries also have `label`. Each variation list can be empty or contain
up to 100 images. No generic Paris samples replace an empty published list.
Every asset must belong to
`assets/permanent-demos/{personId}/{templateSetId}/{version}/`.
Role and brand paths are checked: `portrait.jpg`, `ads/{brand}.jpg`,
`cutouts/{brand}.png`, `variations/{brand}/page_N.jpg`,
`print-previews/{brand}.jpg`. Cutouts are PNG; other images can also use
matching PNG or WebP filenames/MIME types.

Creator publishes complete immutable profile versions, replacing the catalog
only after generation succeeds. The kiosk keeps one catalog snapshot across
an attendee journey; refreshing the portrait picker or reloading the page reads
the newly published catalog. Demo identities never become Azure attendee IDs.
No demo sends preparation, print, fulfillment or share requests.
Finish remains available on demo variations and in the workflow panel. It opens
the static print-template ending; Start over then clears the attendee session.
The ending displays a static demo print preview; it makes no physical pickup claim.
The three packaged AI demos use working public download QR codes as detailed below.
Story screens do not expose manual Graph upload controls. They never send
container SAS access to Graph or bypass the live signed-portrait validator.
The workflow example uses the selected demo brand's cutout and first rendition.
Without booth settings, demo-mode kiosks use the packaged Sarah, Tina and Greg
snapshot at `assets/offline-demos/catalog.json`, not the old Person2/3/5 fixtures.
All 189 media files are same-origin static assets (about 45.8 MiB total):
each person has a portrait, four ads, four cutouts, 50 variations and four static
print previews. The snapshot contains the approved AI people only and requires
no Azure credentials, calls, generation or fulfillment. Both offline activation
mappings intentionally use their available MAX square versions.
The picker, story thumbnails, ads, variations, workflow popout and static endings
read this package. Start over on the ending clears its isolated
`glam-attendee-v1:offline-demo` session. Missing/invalid packages show an error rather
than silently substituting the old people. Refresh keeps a journey on the loaded
catalog snapshot; restarting the page reads an updated package.

This is an Azure-independent demo package, not a browser offline cache/PWA.
It runs from a local static server with external network access blocked.
Firefly Graph remains an external Adobe service requiring connectivity; the
hosted kiosk can still hand off the existing public version-matched cutouts.
The local workflow illustration uses local cutouts and variation previews.
Real attendee mode and its protected Azure assets are unchanged.

The approved public synthetic people are Person 1 = Tina, Person 2 = Sarah,
Person 3 = Greg. Their final print previews in `assets/demo-print/` replace the
original template QR with a permanent public EDS download URL:
`https://kiosk-preview--glam-kiosk-site--lukevan.aem.page/max-download.html?demo=tina`
(or `sarah` / `greg`). Each page serves that person's four original ads from
the offline package; it does not reuse or extend attendee SAS links.
The preview and download page make no physical printing claim and submit no
print/prepare/share requests. Both Azure-connected and no-settings demo flows
use these static endings for the three exact approved demo identities.
The ending uses the same print-slot reveal animation, status bar, and action layout
as live attendees. Demo copy retains the journey message and scan instructions
instead of claiming a physical counter pickup. The download page uses production's
Looking good heading and personalized-ad copy, with no demo-only heading/disclaimer.
Generate the derivative previews with `python3 tools/build-demo-print.py`
(requires Python qrcode and Pillow). Original packaged source previews are retained.
Print geometry is checked before replacement; browser tests decode all 12 embedded
QR codes and verify their exact destinations. The public destinations become
available after the code and derivative assets are deployed to kiosk-preview.

## Adobe Graph cutout handoff

For Azure portraits, story screens read
`{eventId}/9-Graph-Input/{portraitId}/manifest.json` every five seconds.
The worker publishes the original shared cutout from
`node_1791927487544_z177v9idx_35_qblmfu`; this is distinct from the generated
L'Oréal banner cutout. Missing/failed/expired assets show unavailable status,
without substituting the original portrait or starting production.

Ready schema-version-1 manifests must match portrait ID, source node, and
`{eventId}/9-Graph-Input/{portraitId}/portrait.png`. The PNG asset contains
`url` and `expiresAt` minted by Creator at publication, not browser signing.
Only the configured account/container/exact blob with `sr=b`, `sp=r`,
`spr=https`, matching active UTC expiry and at most seven days remaining is
accepted. Container SAS is used only to read the manifest, never handed to Graph.
For staff troubleshooting, `.kiosk-graph-input-status` exposes
`data-graph-input-reason` and logs changes to fixed failure codes only: missing
manifest, publisher cutout error, HTTP failure, invalid manifest/asset/access,
expiry mismatch/invalidity, inactive access, or unreadable response. Signed URLs,
credentials and attendee identities are never included in these diagnostics.
Local HTTP previews give each new packaged Coworker iframe a random
`kiosk-preview` query value so its HTML entry is reloaded after package updates.
An already-open iframe retains its running JavaScript: reload the entire kiosk
tab after syncing a package. Production HTTPS URLs are unchanged.

The shell sends `KIOSK_SET_GRAPH_PORTRAIT` with selected `portraitId`, validated
`url` and `expiresAt` (null URL when unavailable) to the exact Coworker origin.
The credential stays in volatile memory, is cleared on stage abort/reset, and
must never be logged or placed in browser storage. Coworker rechecks access on
explicit Graph click before adding a URLSearchParams-encoded `portraitUrl` hash.
The userscript captures it at document-start and removes it from the address.
Backend publication remains opt-in; real node output/signing is not live-verified.

Published catalog demos use public cutouts when available and otherwise open Graph without an image. Each setup
sends `KIOSK_SET_GRAPH_MODE {mode, portraitId}` immediately before
`KIOSK_SET_NAME` with the same `portraitId`. Only a positively classified
catalog portrait uses `manual-demo`; all live and legacy identities use
`portrait`. Coworker consumes the staged mode only for a matching identity,
otherwise retaining strict portrait validation. The fallback opens the configured
Graph without `portraitUrl` or manual-upload instructions. The existing
Continue to ads action remains available without claiming that Graph completed. Catalog cutouts never
masquerade as live `azure_*` manifests or receive a container-SAS handoff.

`/tools/graph-auto-load.user.js` is the combined Tampermonkey v2.9
artifact for manual installation, not an EDS-injected script. Replace the old
activation userscript with it rather than running duplicate return controls.
It preserves the installed v1.8 return control and edit-access/save-copy notice
suppression, while accepting active blob-read links with up to seven days
remaining and UTC timestamps with optional fractions or `+00:00`. Rejections
log fixed reason codes under `[autoload]`, never signed URLs. The upload
sequence is exercised against a local shadow-DOM fixture; its selectors still
require verification against live Adobe Graph.
Two standalone variants are available: `tools/graph-auto-load-upload-new.user.js`
targets Upload new on a prepopulated Input image, intentionally replacing it;
`tools/graph-auto-load-browse-files.user.js` targets Browse files on an empty input.
Both continue through Your device. Enable only one variant; disable the original
script and any other activation userscripts to avoid competing file pickers.
The Browse files variant then waits for the supplied file to be read and a loaded
image or visible Upload new control in the nonbusy Input image node, and clicks one visible enabled Run all
control exactly once. Missing or ambiguous controls stop with a console diagnostic.
Upload confirmation and run-button availability each have a sixty-second timeout.
Run all matches the exact visible button text independently of its accessibility
label (the current Graph toolbar labels that button Run Graph).
This starts real Graph processing; it does not report processing completion.
In the old node view, the Upload new variant does not automatically run the graph.
In capsule view, all variants wait for upload readiness and click exactly one
enabled Run button inside `capsule-run-controls` (including its shadow root).
Unrelated Run buttons are ignored; disabled or ambiguous controls do not run.
Both Graph node view and the newer capsule Input Image view are supported.
Lookup traverses visible same-origin iframes as well as open shadow roots.
The hosted capsule is a cross-origin `https://graph.adobe.com` iframe, so the
userscript also matches that origin. The Firefly parent validates and clears the
portrait handoff, then relays it only to an attached iframe whose ready message
has the exact Graph origin and iframe window source. The child accepts the relay
only from its top window at the exact Firefly origin and revalidates the portrait
access before downloading. The handshake times out after sixty seconds with a
diagnostic. Tampermonkey must allow the script on both origins and in frames;
after updating it, reopen Graph from the kiosk to supply a new handoff.
Cross-origin DOM is never accessed. The one-use picker override and returned File
use the input frame's page realm; device-menu and run-button lookup stay within
that document. Only the outer Firefly page adds Next.
Capsule Spectrum action buttons support the accessible
name `Upload new image` as well as visible `Upload new` text.
Capsule lookup uses the nearest Input Image group containing upload controls,
including shadow-root controls; it never searches the whole page for a replacement
button. The existing Your device popup, one-use picker override, and Next
behavior are unchanged. Actual hosted capsule compatibility still needs a booth
check; the browser fixture covers the capsule structure without contacting Graph.
The original `graph-auto-load.user.js` now targets Upload new only.
Controls in other nodes, busy ancestors and ambiguous controls are rejected.
Browse files also rejects populated image widgets. Regenerate the standalone
variants after source changes with `node tools/build-graph-userscripts.mjs`.

### Evergreen permanent-demo cutouts

Creator's explicit public-cutout export writes only four approved PNGs per
completed demo version to
`assets/permanent-demo-cutouts/{personId}/{templateSetId}/{version}/{brand}.png`.
Its `index.json` is `{schemaVersion:1,cutouts:[{personId,templateSetId,version,
brand,path,sha256}]}`. No portraits, ads, attendee outputs or SAS are exported.
Versions are immutable; publishing these public files is a separate approved
deployment, not part of generation or local export.

The shell fetches the index from the actual public HTTPS origin and matches the
active catalog identity, Template Set, version and brand. Before ad selection
the Paris Graph story uses `4-lorealparis`; afterward the selected brand is used.
Only `kiosk-preview--glam-kiosk-site--lukevan.aem.page` and
`main--glam-kiosk-site--lukevan.aem.live` are permitted. Hosted kiosks use their
own approved origin by default. Local testing requires explicit runtime
`publicDemoOrigin` pointing to one of those HTTPS origins; it never constructs
a public URL from a locally exported index. Missing mappings open Graph without
an image; failed reads also emit a credential-free console diagnostic.

For a matched export, identity-bound `KIOSK_SET_GRAPH_MODE` uses `public-demo`
and a `demo` object containing `personId,templateSetId,version,brand,sha256,url`.
Coworker validates this separate public namespace without altering live SAS
validation. Graph receives `portraitUrl` plus `publicDemo` JSON provenance in the
fragment. Userscript v2.0 clears both immediately, validates the exact namespace
and approved origin, then verifies the PNG SHA-256 before import. Public demo
URLs never expire, but removed/unpublished files remain unavailable. Until the
code, index and PNGs are actually published, no evergreen availability is claimed.

The ending screen checks render and fulfillment status every five seconds until
rendering is ready, fulfillment is submitted and the selected preview image has
loaded, or either backend state reports failure. Status-read failures show an
explicit automatic-retry message and retry after five seconds without replacing
the attendee's request. A preview-load failure also retries through status polling,
even if rendering and fulfillment already report completion.
The bottom-left Refresh control repeats the same status read; Start over resets the
attendee session. Submitted fulfillment does not confirm physical printer readiness.
The gallery fades upward into the ending screen, with a frosted status bar above
the selected print. Once the actual image loads, it slides down from beneath the
bar over 1.5 seconds. Polling preserves that image and does not replay its reveal.
The bar reports preparation, file readiness, or failure, never physical printing
or fabricated progress. The closing copy remains stable while status changes.
While preparing or waiting for the preview image, the green line pulses as an
indeterminate activity cue. It becomes steady once the image loads and stops
on read/image errors or terminal failure. Reduced-motion users see a steady line.
Reduced motion uses short opacity fades; leaving the screen cancels animations.
Publishing this frontend does not enable Creator's `GLAM_GRAPH_INPUT_ENABLED`
flag or publish cutouts; those backend operations need separate approval.

## Personalized banner results

The Azure showcase uses the selected ad's canonical brand:
`1-larocheposay`, `2-lorealprofessionnel`, `3-YSLbeauty`, or `4-lorealparis`.
YSL's mixed case matches Creator's case-sensitive published paths and manifest brand.
Paris retains its existing
`{eventId}/8-Banner-Output/{portraitId}/manifest.json`; other brands use
`{eventId}/8-Banner-Output/{portraitId}/{canonicalBrand}/manifest.json`.
It reads that exact manifest every five seconds while
results are pending, running, partial, or not yet published (404). Retrieval
errors are displayed and retried; ready/failed manifests stop automatic polling.
An unpublished manifest displays an explicit selected-brand waiting message rather
than a blank gallery with no explanation.
Leaving the screen cancels retrieval and polling. This is read-only: the Creator
worker owns cutout persistence, workflow execution, retry, and PDF rasterization.

The manifest must identify schema version 1, the selected portrait, and the exact
selected brand. Asset IDs are unique and each asset declares its label, status,
MIME type, and container-relative blob path **including the event prefix**.
Ready assets must stay within that brand's manifest directory; Paris cannot
reference the other brands' subdirectories. There is no fallback to Paris when
another brand's manifest or selected Template Set INDD is unavailable.
Creator uses the same Create Variations workflow with each brand's selected
Template Set INDD. The illustrative offline workflow popout is unchanged.
Only PNG/JPEG/WebP previews enter the gallery. PDFs have a separate open link.
Rendition counts are dynamic: every ready preview is included, including all 23
Professionnel outputs. The manifest safety limit is 100 total assets, not nine
renditions; the transition's first-six image preload does not truncate the gallery.
An unavailable preview is explicit even when the PDF is ready. Real portraits
never substitute sample previews for missing production results; demo portraits
retain the labeled static showcase.

Backend execution and output cardinality remain unverified against the new
workflow. The current API exposes the cutout only at terminal four-ad batch
completion. Preview rasterization requires the Creator's optional PyMuPDF
dependency; installing it or running the live workflow is a separate approval.

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
`blocks/attendee-kiosk/assets/`. Demo badges appear without Azure booth settings;
the samples retain demo semantics when those badges are hidden. No attendee photos or source application
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
The lower-right controls show the configured event name (omitted when unconfigured),
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
or `all`; `showFinalQR` is retained in the immutable backend request contract.
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
Graph return enters the refresh-safe `pacing` stage, playing the packaged
nine-second square video before ad selection. Playback completion scrolls the
left copy upward and crossfades the four ads into the same square media area.
This is presentation only, not generation or proof of asset readiness; missing
or failed ads still show their real adapter status. Refresh during playback
restarts the clip; reset stops it. Autoplay rejection offers Play/Continue, and
media failure offers Retry/Continue with an explicit message. Reduced motion
disables the transition animations. The staff Jump to Ads shortcut stays direct.

When saved booth settings exist, reload the attendee page to use the Azure
read/list adapter. It retrieves inputs from `{event}/portraits/pending/`,
excluding hidden files, subfolders, non-image files, and `demo_` inputs. Event
portraits sort by Blob Last-Modified descending, followed by the three
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

The footer identifies the configured event; demo portrait badges are hidden in this mode.
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
pending child focus; continued simulation does not receive this request.
Simulation return sends `KIOSK_SIMULATE` with `autoAdvance: true` once per
selected-ad/frame pairing. Coworker streams setup and continues automatically
to audience results without an Enter/Send pause. Standalone simulation without
this explicit flag retains its manual setup step.
Ad selection attaches a thumbnail to a Spectrum AI prompt-field composer
(Spectrum AI Toolkit, light theme, 540 px) under the subhead on the left; the
enlarged 2×2 ad grid fills the right column. Clicking an ad immediately invokes
the guarded submission path and locks further selection while submitting;
no separate Send or Enter is required.
Real requests must be accepted before transitioning; failed submissions retain
their immutable request for retry and never animate a successful handoff.
On desktop the handoff uses the prototype's 806 ms floating-image shrink/fade,
494 ms tile exits staggered by 91 ms, 468 ms headline fade, 460 ms composer exit,
and 520 ms screen crossfade. The 200 px landing target is relative to the EDS
iframe's measured bounds rather than the Flask stage's absolute coordinates.
The same iframe stays mounted, receives the simulation message before animation,
and animation clones are inaccessible and removed after 850 ms or reset/error.
Mobile and reduced-motion visitors advance without the animation. Scroll
correction applies only to the full-page desktop kiosk, not mobile/download pages.
Native Enter sends the first Coworker prompt. The initial story has no shell Next;
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
`KIOSK_SET_NAME {name,portrait}` and `KIOSK_SIMULATE {adIndex,adUrl,brand}` use
absolute image URLs; `adIndex` is 1-based, with `brand` keys `roche`, `keratin`,
`ysl`, and `paris` in the same canonical ad order. Incoming `KIOSK_NAV` messages require
the configured iframe's `contentWindow`, exact origin and expected stage:
`view-select` requests ad selection directly from initial or continued story;
`view-graph-return` enters the video interstitial from either story stage.
Packaged Coworker watches only its tracked Graph popup's `closed` property and
shares an idempotent completion handler with validated `ADOBE_GRAPH_DONE`;
neither duplicate completion nor a blocked popup starts a second return.
`view-processing-max` and
`view-variations-max` mean continue to the final thumbnail presentation and are
accepted only in the continued stage. Neither message starts a job. Actual hosted
compatibility is not verified. Restart sends the proposed `KIOSK_RESET` message
to the configured Coworker origin, then removes the iframe; the hosted app's
support for that message is not verified. The shell never writes cross-origin
storage.
During initial story, source/origin-validated `KIOSK_STORY_BEAT {beat}` updates
the shell's localized title and sub-copy when the corresponding response is
visible: `overview`, `brief`, `performance`, or `creative`. `home` restores the
initial CX Enterprise Coworker copy. Continued story accepts only `simulate`
and `results`, for the simulation setup and visible audience results respectively.
Other stages and unknown beats are ignored. The variations screen introduces its
own title and sub-copy with the same upward motion.
Coworker replays the current visible beat on `KIOSK_SET_NAME`; repeated beats do
not replay the animation. Copy slides upward inside a clipped text area without
moving the iframe or changing focus; reduced-motion users receive an immediate
text replacement. These presentation messages never start processing.
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
personalized templates, with selected/all fulfillment. Demo selections never
create production print requests.

## Azure print requests and attendee shares

This is a local implementation contract, not a provisioned/live-tested service.
Generate separate create-only access for `glam-kiosk-requests` in Glam Creator.
Settings reject photography write access and any request token granting read,
write, list or delete. Ordinary container SAS has no event-prefix restriction;
the dedicated container is the isolation boundary. Saving validates token format
only and does not perform a test write. Blank request access explicitly disables
live submission. Existing portrait read/list access remains separate.

Confirming Next (or Enter) on name entry for a real portrait reserves a UUID and
enqueues an immutable schema-version-1 preparation document at
`{event}/requests/{requestId}/prepare.json` in the dedicated requests container.
Its exact fields are `schemaVersion: 1`, `type: "prepare"`, `requestId`,
`eventPrefix`, `portraitId`, `attendeeName`, `lang`, and `createdAt`. Typing,
portrait selection, demo portraits and ordinary resume never enqueue preparation.
The document is persisted before the first create-only PUT. Failed or ambiguous
submissions retry the exact body/UUID after Retry or reload, with the confirmed
identity frozen; acknowledged preparations are not resubmitted on resume.
Preparation requests all four personalized templates and their same-UUID share/QR,
but never physical print fulfillment. Creator defers rendering until all four
source ads exist; the browser does not wait for ads at name confirmation.
This requires the updated Creator prepare consumer; old workers do not support it.

Confirming a real selected ad creates an immutable schema-version-1 JSON request
at `{event}/requests/{requestId}.json` in the dedicated container with:
`requestId` (UUID v4), `eventPrefix`, `portraitId`, `attendeeName`, `selectedBrand`
(`larocheposay`, `lorealprofessionnel`, `yslbeauty`, `lorealparis`),
`printScope`, `showFinalQR`, `lang`, and `createdAt`.
For prepared sessions this reuses the reserved UUID and all shared identity
fields, including `createdAt`. Selection controls the final Thank-you preview and
the existing print-scope policy, not which of the four templates are rendered.
Creator reuses those exact prepared files and their embedded same-UUID QR, without
copying an unrelated portrait-only cache or rerendering them with a different QR.
Legacy saved sessions without a preparation retain their previous final-submit
behavior. Restart clears local preparation state, not queued work or assets.
The shell saves the entire unsigned request in sessionStorage before its first
PUT, using `If-None-Match: *` and `x-ms-blob-type: BlockBlob`. Failed/ambiguous
submissions retry the same ID/body; selection is locked after an attempt.
Duplicate responses await worker status, not a fabricated processed result.
While the worker still reports `preparation: true`, only an exact matching
preparation request echo is accepted as pending finalization. It cannot report
successful print fulfillment; normal final status must bind the full final request.
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
The ending presents one large selected personalized template, including the QR
embedded by the worker, rather than a second standalone QR panel. The encoded
QR contains an attendee-specific blob-read SAS, never the kiosk container
credential. The template remains dynamic and portrait/request-bound; no Figma
sample portrait or placeholder QR is used. Pending/failure/pickup status and
manual Refresh remain available. Start over uses the existing attendee reset
flow without changing production or booth settings; the ending has no Exit button.
The continued story's personalized-ads control and child completion navigation
open the ending screen. It polls every five seconds and shows explicit preparation/
failure states in the frosted status bar, separately from the closing copy.
The selected template includes the backend-rendered QR; no separate QR is shown.
Its download page shows processing progress and adds images as they become ready.
Refresh resumes status lookup without a new submission.
The ending screen says Thank you (Merci), with Refresh at the bottom left and
Start over beneath the copy. On desktop its right side displays the selected
personalized template beneath the status bar. On smaller screens the bar and
preview stack below the copy.
Selecting a favorite ad records the live event portrait ID in this browser's
localStorage immediately, before Send, fulfillment, or Exit. Reselecting an ad
does not duplicate or clear that record. The default picker
hides those IDs. Settings' Show completed portraits toggle reveals them without
deleting history or Azure assets. History is scoped by event and browser origin,
persists through restart/reload/settings clearing, and is not shared across Macs.
Cross-kiosk hiding uses orchestrator-published markers: when the request worker
sees a kiosk's ad-selection request (`{event}/requests/{requestId}.json`), it
writes an empty blob `{event}/portraits/used/{portraitId}` to the kiosk-readable
container. Every picker load lists that prefix with the read/list SAS and hides
matching IDs (invalid names are ignored). If the listing fails, the picker shows
the event-photos-unavailable warning rather than revealing used portraits.
Reset before favorite-ad selection does not mark completion; reset afterward
does not undo it. All three demo portraits remain available and are never recorded
as completed. Their Demo badges appear only without configured Azure booth
settings, including when a configured Azure listing is empty or temporarily fails.
This changes only badge presentation, not their demo data or processing semantics.
Refresh assets sits at the picker's bottom left and repeats the portrait listing.
This is visibility only: selecting a revealed portrait still creates a new request;
it is not a replay-without-processing mode.

### Variations showcase and production preview

Coworker's See variation results sends the existing trusted
`KIOSK_NAV` / `view-variations-max` target from continued story. This now opens
the refresh-safe `variations` stage, not print completion. View production workflow
is removed from that Coworker card and placed on this results screen.

The demo showcase contains 18 explicitly labeled sample InDesign outputs,
optimized from the supplied Sample-indd-Output folder to JPEG previews at up to
800 px, about 1 MB total. They are not attendee-personalized assets or downloads.
Each gallery column moves upward at 25 px/second and repeats its own sequence
seamlessly, avoiding a shared jagged bottom or a visible jump to the top.
Alternating columns reverse their assigned ads; each cycle includes a reordered
second pass for a varied arrangement before the seamless repeat.
Repeated tiles are hidden from assistive technology; the original assets remain
available once. Manual
wheel/touch/keyboard scrolling pauses it until one second after the last interaction
or manual scroll event; dragging holds the pause until release. Reduced-motion
preference, hidden tabs, and an open workflow dialog stop automatic movement.
There are no Pause or Back controls. Images retain their full
aspect ratio without a height cap or wide portrait side gutters, and are not
selectable. Repeated previews reuse the same asset URLs; images are loaded eagerly
so the loop's geometry is established before tiles scroll into view. Reduced
motion shows only the original sequence with native manual scrolling.

Opening results from continued Coworker retains the outgoing panel while up to
six current previews load (bounded to two seconds after results retrieval).
Coworker recedes/fades while gallery columns rise beneath it with 140 ms
staggering; the copy slides upward and controls fade in last. Continuous movement
starts during the reveal and smoothly ramps to full speed over 1.2 seconds,
without a stationary hold. Refresh/resume does not replay the handoff. Reduced motion
uses short fades, and reset/navigation cancels outstanding animations.

Azure portraits use the published banner-results manifest described above,
without falling back to demo samples. Other protected API integrations can
provide personalized images through the validated `banners` array.
The browser does not trigger FFCPE generation or infer another portrait's results.
Next leads to
the existing ending only if this attendee already has a print request.

Runtime `productionWorkflow: { enabled: true, packaged: true }` opens
`/production-workflow/index.html?workflow=banners&preview=eds` in a sandboxed, lazy-created iframe
inside a modal slide-over. Unconfigured workflow shows an explicit unavailable
state, not a fabricated graph or a live Adobe editor. Escape, Close, or clicking
the dimmed backdrop remove the
iframe and return focus; stage changes/reset remove the dialog and stop scrolling.
This preview has no authority to submit jobs; the static package is source-owned
by Glam's ffe-wfb-design-proto app. Its `workflow=banners` mode embeds the editable
FFCPE interface with nine initial nodes and ten edges, including CSV parsing,
InDesign merge/rendition, brand validation, preview and simulated delivery nodes.
Attendees can add, delete, move and connect nodes and edit settings; these edits
reset when the iframe closes. Run and import/export are disabled, Publish is
hidden, and there are no job hooks, polling or processing results. Deploy it by
syncing the built bundle into `/production-workflow/` with relative asset paths,
like `/coworker/`.

The gallery omits the personalized count and ready confirmation; pending,
partial, failed and unavailable states remain visible, as does the demo label.
The workflow child announces `KIOSK_WORKFLOW_READY`; the shell validates its
exact window and same origin, then replies to that origin with
`KIOSK_WORKFLOW_ASSETS {portraitId, brand, portraitUrl, previewUrl}`. `brand`
is the selected ad's banner brand key (`1-larocheposay`, `2-lorealprofessionnel`,
`3-YSLbeauty`, `4-lorealparis`) or `null`; the workflow uses it to preset the
Validate brand node's Campaign/Audience/Product/Channel pickers. The portrait is
read again from the selected attendee's validated Graph cutout manifest on
each modal open. The preview is the first current banner result, updated if
gallery results change. Missing/expired cutouts and missing previews remain
empty with explicit unavailable messaging, never another attendee's sample.
Demo mode sends the selected demo portrait but no unrelated sample banner.
URLs stay in memory and trusted messages, never query parameters or storage.
Closing or resetting aborts the read and removes the listener and child.

New MAX attendee URLs use `/max-download.html?session=<encoded manifest URL>`.
The static `max-download.html` shell loads the dedicated `max-download` block;
no DA.live content publication is required. It has isolated MAX classes/styles
and owns pending/partial/ready processing and strict manifest validation.
The original `/download` keeps its legacy image/session rendering and fetch
behavior. Already-issued MAX `/download` links are recognized by schema version 1
and the `/7-Share-Output/` manifest path and handed to the MAX block, without
redirecting or rewriting their QR URLs. The kiosk accepts both routes for resume
compatibility; the worker must use `/max-download.html` for fresh requests and preserve
persisted URLs for existing requests.
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
