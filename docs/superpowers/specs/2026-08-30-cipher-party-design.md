# Cipher Party Multiplayer Web Game Design

**Date:** 2026-08-30

**Status:** Approved

**Working title:** Cipher Party is an internal, franchise-neutral name and directory label. Product naming is a separate pre-launch decision.

## 1. Summary

Cipher Party is a private, account-free multiplayer browser game inspired by team word-association party games. Friends join an invite-only room from phones or laptops, split into two to four teams, and play text, picture, or mixed-card boards. The initial release supports Classic and Blitz play plus fixed best-of-3, best-of-5, and best-of-7 campaign nights.

Hosts build portable theme packs through a guided in-app wizard. AI can suggest text entries and categories, but it does not search for, scrape, or generate franchise artwork. Hosts supply images they are permitted to use. The application ships with original, franchise-neutral branding and content until licenses are secured.

The application uses React and TypeScript for a responsive DOM interface. Cloudflare Workers serves the application and API, one Durable Object owns each room's authoritative real-time state, R2 stores temporary pack images, and Workers AI provides rate-limited text suggestions. Room state and server-side pack copies expire after 24 hours of inactivity.

## 2. Goals

The MVP must:

- Let a host create a private room without an account.
- Let guests join through an invite URL or six-character room code and display name.
- Support 4–16 active players across 2–4 teams, plus up to 16 spectators.
- Require at least one clue-giver and one operative per active team.
- Support two-team Classic, Blitz, three- and four-team boards, and fixed campaign series.
- Support text, picture, and mixed-card boards.
- Give each player only the state authorized for their role.
- Survive refreshes, brief network loss, and Durable Object hibernation without losing seats or game progress.
- Guide hosts through AI-assisted pack creation, validation, local storage, import, and export.
- Delete temporary server state and assets after 24 hours of inactivity.
- Work well on current phone and laptop browsers.
- Remain ready for later custom domains and licensed branded destinations.

MVP success is a best-of-3 campaign completed by mixed phone and laptop clients with no desynchronization, hidden-information leak, duplicate action, or lost seat after a routine reconnect.

## 3. Non-goals

The MVP does not include:

- Public matchmaking, room discovery, or public pack sharing.
- Required player accounts, permanent cloud profiles, or cross-device statistics.
- Built-in voice or video. Players use Discord, FaceTime, Zoom, or another external service.
- Co-op, powers, double agents, mid-board team switching, or other experimental rule engines.
- Intra-board clue-giver rotation. Campaigns rotate clue-givers only between boards.
- A shared-TV controller mode. The public spectator projection is designed so TV mode can reuse it later.
- Full-room visual skins, theme fonts, theme sounds, or arbitrary theme code.
- Automated franchise image search, scraping, or image generation.
- Bundled Disney, Marvel, DC, Harry Potter, anime, or other third-party franchise assets.
- Offline matches. PWA installation prompts, push notifications, and advanced offline caching are later enhancements.

## 4. Content and licensing boundary

Private operation does not cause the application to own or license uploaded content. The shipped application contains only original or properly licensed neutral assets.

For the MVP:

- Workers AI may suggest text candidates such as character names, teams, locations, objects, and events.
- The application does not retrieve or generate franchise artwork.
- Hosts upload images and affirm that they have permission to use them.
- Packs carry optional source, creator, attribution, and license-note fields for every image.
- Packs are private to the host and current room unless the host explicitly exports and shares the bundle.
- Other room members cannot download the source pack through the application.
- A later licensed asset connector can populate the existing source and license metadata without changing the game engine.

This is a product boundary, not a legal determination. Licensing terms and final product branding require review before a public or commercial launch.

## 5. Players and authority

### 5.1 Roles

- **Host:** Creates the room, controls room configuration, assigns teams, locks entry, selects or uploads a pack, starts and pauses play, removes players, recovers seats, chooses replacements, ends a board, and designates a co-host. Being host does not reveal the key unless the host is also a clue-giver.
- **Co-host:** Receives moderation and recovery controls but cannot invalidate the original host's reconnect token. A designated co-host can operate the room while the host is disconnected.
- **Clue-giver:** Sees the current board's full ownership key for their team and submits clues during that team's clue phase. There is exactly one clue-giver per active team.
- **Operative:** Discusses cards through external voice, nominates cards, and can confirm a reveal during the team's guessing phase.
- **Spectator:** Sees the public board, public game history, teams, and score but never receives the ownership key.

### 5.2 Capacity and team constraints

- A room allows at most 16 active players and 16 spectators.
- Every active team must contain at least two connected seats at board start: one clue-giver and at least one operative.
- Team sizes must differ by no more than one when a board starts.
- The host may be an active player or spectator.
- Eliminated players become spectators for the remainder of a multi-team board and return to their assigned team for the next campaign board.

## 6. End-to-end player journey

### 6.1 Host journey

1. Open the neutral landing page.
2. Choose Create Room.
3. Enter a display name.
4. Select a local pack, import a pack, or open the guided pack builder.
5. Choose:
   - Classic or Blitz.
   - Two, three, or four teams.
   - One board or a best-of-3, best-of-5, or best-of-7 campaign.
   - Blitz clue and guessing timers when applicable.
6. Receive a shareable invite URL and six-character room code.
7. Assign or randomize teams in the lobby, select clue-givers, and optionally designate a co-host.
8. Lock the lobby and start the board.

### 6.2 Guest journey

1. Open an invite URL or enter a room code.
2. Enter a display name.
3. Receive a private browser-local seat token.
4. Join a team or spectator area as permitted by the host.
5. Play from the role-specific interface.
6. Refresh or reconnect into the same seat without rejoining.

### 6.3 Campaign journey

1. Complete a board and view its result and updated campaign table.
2. Rotate each team's clue-giver to the next eligible teammate. The previous clue-giver is skipped when another eligible teammate exists.
3. Rotate the starting team in round-robin order.
4. Let the host override the proposed assignments before the next board.
5. Finish the configured series and show the winner, board record, target totals, error totals, and downloadable campaign summary.

## 7. Game rules

### 7.1 Shared turn rules

The room is server-authoritative. A normal turn has a clue phase followed by a guessing phase.

- The active clue-giver submits one clue token and an integer count from 1 through the number of unrevealed targets belonging to that team.
- A clue token is 1–40 Unicode grapheme clusters after trimming, contains no whitespace, and may contain letters, numbers, apostrophes, or hyphens.
- The application validates syntax only. It cannot decide whether a semantic relationship is fair.
- An opposing clue-giver can challenge a clue. A challenge pauses the timer; the host or co-host either accepts the clue and resumes, or rejects it and ends the active team's turn.
- The active team may attempt up to the clue count plus one reveals.
- Any connected operative on the active team may nominate a card. A reveal requires a separate confirmation action.
- Revealing the active team's target consumes one guess and permits another guess while the limit remains.
- Revealing a neutral card or another team's target ends the turn.
- Revealing another team's target immediately counts as revealed progress for that target's owner. If that completes the other team's targets, that team wins the board.
- The active team may end its guessing phase early.
- Only one reveal command may resolve at a time. Stale or duplicate confirmations are rejected.

### 7.2 Two-team Classic

The default board is a 5×5 grid:

- Starting team: 9 targets.
- Other team: 8 targets.
- Neutral: 7 cards.
- Hazard: 1 card.

The first team to reveal every target it owns wins. Revealing the hazard loses the board immediately and awards the win to the opposing team.

### 7.3 Three-team variant

The board is a 5×6 grid:

- Starting team: 8 targets.
- Each other team: 7 targets.
- Neutral: 7 cards.
- Hazard: 1 card.

Revealing the hazard eliminates only the active team. Its unrevealed targets become neutral in authoritative state, all clue-giver projections update, and the remaining teams continue. If only one team remains, it wins immediately.

### 7.4 Four-team variant

The board is a 6×6 grid:

- Starting team: 8 targets.
- Each other team: 7 targets.
- Neutral: 6 cards.
- Hazard: 1 card.

Hazard elimination follows the three-team rule.

### 7.5 Blitz

Blitz uses the selected board and reveal rules with server deadlines:

- The host selects 30, 60, or 90 seconds independently for clue and guessing phases before the board starts.
- A clue deadline that expires before a valid clue is accepted ends the team's turn.
- A guessing deadline ends the team's turn without revealing a currently nominated card.
- Timer choices cannot change during a board.
- The server stores an absolute deadline; client countdowns are display-only.

### 7.6 Campaign scoring

- Campaign length is exactly 3, 5, or 7 configured boards.
- Each board victory counts as one campaign win.
- A two-team campaign ends early once one team has an unbeatable majority.
- Three- and four-team campaigns play all configured boards.
- The team with the most board wins takes the campaign.
- A tie is resolved by, in order:
  1. Most correct own-team target reveals across the campaign.
  2. Fewest opposing, neutral, and hazard reveals.
  3. If still equal, the tied teams share the campaign result.
- Starting team rotates between boards. The first board's starting team is selected by the board seed.
- Clue-givers rotate between boards, never during normal board play. A disconnected clue-giver may be replaced by the host as a recovery action.

### 7.7 Deterministic boards and repetition

- The server creates a cryptographically random campaign seed.
- A documented deterministic pseudo-random generator derives every board and ownership key from the campaign seed and board index.
- Cards never repeat within one board.
- Campaign sampling consumes a shuffled pack deck until the remaining cards cannot fill the next board.
- The next shuffle excludes every card on the immediately previous board when the pack is large enough. If the pack is too small, the builder warns the host before play and minimizes repeats deterministically.
- Reconnects and Durable Object restarts regenerate the same board from persisted state and seed.

## 8. Interface design

### 8.1 Visual direction

The neutral shell uses a modern secret-archive party-table direction: dark navy surroundings, warm card surfaces, crisp typography, restrained motion, and high-contrast team accents. Theme packs change board content and a small cover thumbnail only. They do not alter application backgrounds, fonts, controls, sounds, or team identity.

### 8.2 Screens

- Landing: Create Room, Join by Code, Build a Pack.
- Join: Room code, display name, clear room-state errors.
- Lobby: Invite controls, connected players, team assignment, role assignment, configuration, pack summary, lock/start controls.
- Pack library: Locally saved packs, import, export, duplicate, delete, and open builder.
- Pack builder: Five-step guided flow described in Section 9.
- Game board: Board, current team, clue, remaining guesses, timer, team progress, nominations, reveal confirmation, pause/challenge controls, and public history.
- Board result: Winner, reveal summary, campaign table, proposed next clue-givers, and continue control.
- Campaign result: Final standings and downloadable summary.

### 8.3 Responsive behavior

- All clients preserve the same row and column arrangement.
- A two-team 5×5 word board fits a normal phone portrait viewport with compact cards.
- Larger boards and image-heavy boards use a bounded pan-and-zoom board viewport and tap-to-focus card preview; they never reflow into a different order.
- Phone layouts keep turn, timer, and score above the board and place details in a bottom sheet.
- Laptop layouts center the board and use a side panel for teams, timer, and history.
- The clue-giver view has a one-action privacy veil that obscures and restores the ownership key.
- Spectators use an explicit public projection suitable for the later shared-TV client.

### 8.4 Accessibility

- Team identity always combines color, symbol, label, and reveal pattern.
- All interactive controls support keyboard operation and visible focus.
- Touch targets meet a minimum 44×44 CSS-pixel target where physically possible; compact board cards open a full-size confirm target.
- Picture cards require accessible labels. Screen-reader users receive the semantic identity that a sighted player obtains from the image.
- The application supports reduced motion, scalable text, high contrast, and optional timer sounds.
- No critical action depends solely on hover, animation, sound, or color.
- Connection state, pause state, and whose turn it is are announced through an accessible live region without repeatedly announcing timer ticks.

## 9. Theme-pack system

### 9.1 Guided builder

The builder contains five required stages:

1. **Describe:** title, description, audience rating, difficulty, theme prompt, and word/picture/mixed board support.
2. **Generate or import:** AI suggestions, pasted lists, CSV import, manual cards, or an existing pack bundle.
3. **Add images:** upload, crop, set focal point, label, source, attribution, and license note.
4. **Curate:** exact and near-duplicate detection, missing-asset checks, unclear-label warnings, spoiler/sensitivity review, and estimated campaign repetition.
5. **Preview and publish:** representative phone/laptop preview, playability validation, local save, portable export, or temporary room upload.

The host must explicitly approve AI suggestions and pass validation before a pack can enter a room.

### 9.2 Card and pack model

Each pack has:

- Stable UUID.
- Format and schema version.
- Title, description, audience rating, difficulty, and cover thumbnail.
- Supported board modes.
- Ordered card collection.
- Created and updated timestamps.
- Rights statement and optional pack-level attribution.

Each card has:

- Stable UUID.
- Kind: word or picture.
- Required accessible label.
- Visible word for word cards.
- Local asset path for picture cards.
- Optional category tags.
- Optional source URL, creator, attribution, and license note.

A mixed board samples approximately half word and half picture cards when inventory permits. The final split is deterministic and displayed in the room summary.

### 9.3 Pack sizing

- A pack must contain at least the current mode's board size: 25, 30, or 36 eligible unique cards.
- The builder recommends at least twice the board size.
- Before a campaign starts, the room reports how many repeats may occur under the deterministic campaign sampler.
- Missing or invalid picture assets make those cards ineligible for picture and mixed boards but do not invalidate otherwise usable word cards.

### 9.4 Portable bundle

The portable .cipherpack file is a ZIP-compatible archive with:

- manifest.json
- cards.json
- assets/ containing content-addressed raster images

The importer accepts at most:

- 400 cards.
- 500 archive entries.
- 100 MiB uncompressed payload.
- 10 MiB per source image.

Allowed image formats are JPEG, PNG, and WebP. The client converts uploads to bounded WebP derivatives where possible, and the server independently validates signature, MIME type, declared dimensions, archive paths, and byte limits. SVG, HTML, scripts, remote hotlinks, nested archives, and path traversal are rejected.

### 9.5 Browser and server storage

- IndexedDB stores the host's local pack library.
- A host can export any locally stored pack.
- Import never executes archive content.
- R2 stores only the optimized assets required by an active room.
- R2 keys are scoped by opaque room and pack identifiers.
- Only authorized room routes serve objects; buckets are not public.
- The Durable Object alarm removes its R2 prefix after 24 hours of room inactivity. An R2 lifecycle rule provides a coarse backup expiration.
- Clearing browser data deletes non-exported local packs.

### 9.6 AI assistance

- The MVP uses a Workers AI binding through a PackSuggestionService interface.
- The initial deployment defaults to a free-plan-eligible text model configured by the AI_SUGGESTION_MODEL deployment variable.
- The request contains theme prompt, audience, difficulty, desired categories, desired count, and existing card labels.
- Structured output is validated against a strict schema before it reaches the editor.
- The service returns draft text labels, categories, and optional short rationales. It never mutates a saved pack.
- The AI path is host-only and rate-limited by room, host token, and a Cloudflare-derived client-address key.
- The daily allocation has a configured application budget. When the provider is unavailable or the budget is exhausted, the builder explains the condition and keeps manual creation fully functional.
- Prompts and generated drafts are not written to long-term analytics in the MVP.

## 10. Technical architecture

### 10.1 Deployment shape

    Player browsers <-> Cloudflare Worker <-> Room Durable Object
                                 |              |
                                 |              +-- SQLite-backed room storage
                                 +-- R2 temporary pack assets
                                 +-- Workers AI text suggestions

Cloudflare custom domains route to the same Worker deployment. The neutral domain is canonical for invite links in the MVP. Future licensed domains can select a verified static domain configuration, but domain selection never changes authorization or room identity.

### 10.2 Repository boundaries

The repository uses pnpm workspaces (September 7 integration amendment):

- apps/web: React UI, local IndexedDB pack library, WebSocket client, and PWA-ready manifest assets.
- apps/worker: HTTP gateway, WebSocket ticket endpoint, Durable Object implementation, R2 access, cleanup, rate limits, and Workers AI adapter.
- packages/game-core: Pure deterministic rules, board generation, campaign scoring, state transitions, and visibility-independent types.
- packages/protocol: Command schemas, role-specific projection schemas, versioning, and serialization.
- packages/pack-format: Pack/card schemas, archive validation, import/export, and compatibility migrations.

Game rules never live in React components or WebSocket callbacks. Rendering consumes projections; the Durable Object invokes the pure game core.

### 10.3 Why DOM instead of Phaser

The playfield is a responsive collection of text and image controls with hidden information, not a continuously simulated animated world. React DOM provides better responsive layout, semantics, keyboard support, screen-reader behavior, and future TV reuse. Phaser would add a canvas accessibility layer without improving the core interaction.

### 10.4 Room identity

- Room codes use six characters from Crockford's human-readable base-32 alphabet. Generated codes omit I, L, O, and U; input accepts O as 0 and I/L as 1.
- The Worker derives a Durable Object ID from the room code.
- Initialization is atomic inside the object, so concurrent code claims cannot create two rooms.
- A room code locates a room but grants no privileged action.
- Invite URLs contain only the room code.

### 10.5 Tokens and WebSocket admission

- Joining creates a cryptographically random 256-bit seat token.
- Hosting creates a separate 256-bit host token.
- Tokens are stored in IndexedDB on the issuing browser and only token hashes are persisted server-side.
- The browser sends its token in an Authorization header to request a short-lived, one-use WebSocket ticket.
- The WebSocket URL carries only that expiring ticket, not the durable seat or host token.
- The Durable Object consumes the ticket and binds the connection to a player, role, and room.
- A host can issue a replacement seat token to recover a player on a new device. The previous token is revoked.

### 10.6 Authoritative state

Persisted RoomState includes:

- Schema and protocol versions.
- Room code, creation time, last activity, lock state, and phase.
- Room configuration and pack reference.
- Players, token hashes, connection-independent seats, teams, roles, and co-host assignment.
- Campaign seed, configured length, results, aggregate tie-break statistics, and next assignments.
- Current board seed/index, card identifiers, ownership, reveals, active teams, eliminated teams, current turn, clue, guess limit, and phase deadline.
- A bounded public action history for recovery and display.

The main room phases are Lobby, BoardSetup, Clue, Guess, BoardComplete, CampaignComplete, and Expired.

Clients send commands, not replacement state. Important commands include JoinRoom, ConfigureRoom, AssignSeat, SetClueGiver, LockRoom, StartBoard, SubmitClue, ChallengeClue, ResolveChallenge, NominateCard, ClearNomination, ConfirmReveal, EndTurn, Pause, Resume, ReplaceSeat, EndBoard, and StartNextBoard.

Every command contains a unique command ID and expected state revision. The Durable Object validates authorization, phase, active team, role, expected revision, and command payload. Accepted commands advance the revision and persist before broadcast. Duplicate command IDs return the original result; stale revisions trigger a fresh projection.

### 10.7 Role-specific projections

The server constructs projections from allowlisted fields rather than serializing full state and deleting hidden fields.

- PublicProjection: lobby/public board, revealed ownership, teams, presence, current clue, timer deadline, score, and public history.
- OperativeProjection: PublicProjection plus active-team controls and shared nominations.
- ClueGiverProjection: PublicProjection plus the current full ownership key and clue controls for that clue-giver's team.
- HostProjection: PublicProjection plus moderation/configuration controls, but no key unless the host is also the relevant clue-giver.

Protocol tests deserialize every non-clue-giver payload and assert that ownership values for unrevealed cards are structurally impossible.

## 11. Realtime behavior and recovery

### 11.1 Connection model

- The Durable Object uses Cloudflare's hibernating WebSocket API.
- A connection receives an initial projection and monotonic state revision.
- Accepted commands broadcast a new projection or projection-safe patch to each connected role.
- On reconnect, the client requests a complete fresh projection rather than assuming its last patch stream is complete.
- Reconnection uses bounded exponential backoff and visibly reports offline, reconnecting, and restored states.

### 11.2 Timers

- The server persists absolute phase deadlines.
- A single Durable Object alarm represents the next authoritative deadline.
- Client countdowns derive from the deadline and estimated server clock offset.
- When an alarm fires, the room applies the same deterministic timeout transition used by command processing.
- If the active clue-giver disconnects during the clue phase, or every operative on the active team disconnects during guessing, a 10-second grace period begins. If the required role does not reconnect, the room pauses.

### 11.3 Host and seat recovery

- The room continues if the host disconnects.
- A designated co-host retains operational controls.
- Without a connected host or co-host, current play continues but moderation/configuration actions wait for one to return.
- The host can replace an abandoned seat and issue a new token.
- Replacing a clue-giver during a board is a recovery action recorded in public history.

### 11.4 Persistence and cleanup

- The Durable Object saves a snapshot after every accepted state-changing command.
- Room creation, join, reconnect, upload, and accepted command activity advance lastActivity and reschedule expiry. A passively open WebSocket does not generate a periodic keepalive solely to prevent expiry or hibernation.
- At 24 hours without activity, the room closes sockets, deletes its R2 asset prefix, clears Durable Object storage, and returns Expired to later requests.
- Pack downloads and campaign summaries must be requested before expiry.
- An R2 lifecycle rule is a backup for orphaned temporary assets.

## 12. Error handling

- Invalid commands return a stable code, human-readable message, and current state revision without mutating room state.
- Duplicate commands are idempotent.
- A stale client receives a resync response.
- If a snapshot write fails, the action is not broadcast as accepted.
- If a broadcast to one client fails, the accepted room action remains valid and that client reconnects for a snapshot.
- AI timeout, capacity, rate-limit, or schema failure returns the host to an editable manual draft.
- Uploads are independently retryable and content-addressed, so successful assets are not retransmitted.
- A pack that fails import remains isolated from the local library and room.
- Unsupported schema versions produce an explicit migration or incompatibility message.
- Active-room schema migrations run before command handling and preserve the prior serialized snapshot until the migration commits.

## 13. Security, privacy, and abuse controls

- No third-party analytics or ad scripts run in the MVP.
- A strict Content Security Policy limits scripts, connections, images, frames, and form actions.
- Display names and all rendered pack text are treated as text, never HTML.
- Room creation, code lookup, join attempts, ticket issuance, AI requests, and uploads have per-origin and per-room limits.
- Repeated room-code misses receive progressive throttling.
- Host and seat tokens never appear in invite URLs, logs, or public projections.
- R2 responses set an allowlisted raster Content-Type, nosniff, a restrictive Content-Disposition policy, and private cache controls appropriate to temporary assets.
- Pack archives defend against path traversal, excessive entry count, oversized expansion, mismatched MIME signatures, and decompression abuse.
- Server logs exclude hidden board keys, durable tokens, uploaded asset bodies, AI prompt bodies, and complete pack contents.
- Operational logs may retain room ID hash, error code, state phase, latency, byte count, and aggregate usage long enough to debug the service.
- There is no claim of end-to-end encryption. Cloudflare infrastructure processes room state and temporary assets.

## 14. PWA and browser strategy

The MVP is a responsive website with PWA-ready structure:

- HTTPS, responsive layout, web app manifest, icons, theme color, and standalone-safe layout.
- Invite URLs always work without installation.
- No custom install prompt is required for MVP acceptance.
- No service-worker caching of room API or WebSocket state.
- If static asset caching is added, deployed asset filenames are content-hashed and the HTML shell uses a safe update policy.
- Supported release targets are the latest two stable major versions at release time of Chrome, Safari, Edge, and Firefox on desktop, plus Safari on iOS and Chrome on Android.

## 15. Testing and playtesting

### 15.1 Unit and property tests

- Pure reducer coverage for every legal and illegal phase transition.
- Reveal behavior for own, opposing, neutral, and hazard cards in every team count.
- Team elimination and ownership-to-neutral conversion.
- Blitz deadline behavior.
- Campaign early completion, fixed completion, rotation, scoring, and tie-breaks.
- Seed reproducibility, exact ownership distributions, unique cards, and constrained repeat behavior.
- Role-projection tests that make unrevealed ownership structurally absent.
- Pack schema, migration, archive, file-limit, and duplicate-detection tests.
- Property tests generate legal room configurations and command sequences to verify invariants such as one active turn, nonnegative remaining guesses, and immutable revealed ownership.

### 15.2 Worker integration tests

- Atomic room initialization and code collision behavior.
- Token hashing, ticket issue/consume/expiry, and token revocation.
- Durable Object restart/hibernation recovery.
- Snapshot-before-broadcast behavior.
- Duplicate and stale commands.
- Deadline alarms and disconnect grace pause.
- R2 upload authorization and cleanup.
- Workers AI schema failure and budget fallback.
- Room expiration.

### 15.3 Browser tests

Playwright uses isolated browser contexts for host, co-host, clue-giver, operative, opponent, and spectator. It covers:

- Create, join, assign, lock, and start.
- A complete two-team Classic board.
- A Blitz timeout.
- A multi-team hazard elimination.
- A complete best-of-3 campaign with clue-giver and starter rotation.
- Refresh and reconnect during clue and guessing phases.
- Host disconnect with co-host continuity.
- Operative network inspection proving no hidden key payload.
- Pack build, export, import, upload, and mixed-board preview.
- Phone, tablet, and desktop viewports in Chromium and WebKit, with Firefox smoke coverage.

### 15.4 Accessibility and visual checks

- Automated axe checks on every main screen.
- Keyboard-only full-turn play.
- Screen-reader smoke tests for lobby, clue submission, nomination, reveal, and results.
- Snapshot review at narrow phone, common phone, tablet, laptop, and wide desktop sizes.
- Reduced-motion and high-contrast review.

### 15.5 Human playtest loop

1. Internal deterministic matches and automated simulated players.
2. Four-to-six-player Classic word-board session.
3. Pack-building session followed by picture and mixed boards.
4. Eight-to-twelve-player Blitz and multi-team campaign.
5. Mixed iPhone, Android, laptop, background-tab, Wi-Fi-loss, and reconnect stress session.

Each session records rule confusion, accidental actions, card readability, timer pressure, connection recovery, and total time from invite to first clue. A milestone is not complete until its relevant playtest has no critical blocker.

## 16. Delivery sequence

### Milestone 1: Connected Classic

- Workspace and Cloudflare bindings.
- Pure game core and protocol.
- Account-free room creation/join/reconnect.
- Lobby, two teams, text pack fixture, 5×5 Classic board.
- Role-safe projections and complete board flow.

### Milestone 2: Pack studio

- IndexedDB local library.
- Five-step guided builder.
- Workers AI text suggestions with manual fallback.
- Picture processing, R2 temporary storage, mixed boards.
- .cipherpack import/export and validation.

### Milestone 3: Party modes

- Blitz deadlines.
- Three- and four-team boards and elimination.
- Best-of-3/5/7 campaigns.
- Between-board clue-giver and starter rotation.
- Campaign summary export.

### Milestone 4: Hardening

- Full recovery and host/co-host controls.
- Accessibility pass.
- Cross-browser and network stress coverage.
- PWA-ready manifest and domain configuration.
- Final multiplayer playtest and MVP release checklist.

## 17. Future extension points

The architecture deliberately leaves room for:

- Co-op rules as a separate game-core mode.
- Power cards and double-agent or team-switch events as explicit, testable command/state extensions.
- Shared-TV mode using PublicProjection.
- Full theme skins through a future signed, allowlisted theme manifest rather than arbitrary code.
- Authorized licensed asset-library connectors.
- Persistent accounts, public packs, moderation, and stats backed by a separate durable database.
- Branded custom domains selected through verified server configuration.
- Install promotion, push notifications, and richer PWA caching.

These extensions do not enter the MVP unless the design is revised.

## 18. Current platform assumptions

The architecture relies on current Cloudflare capabilities:

- Workers can deploy a React SPA, API routes, and static assets together.
- Durable Objects support hibernating WebSocket servers and SQLite-backed state on the Workers Free plan.
- R2's current free allocation is sufficient for small, temporary friend-group packs when upload limits and expiry are enforced.
- Workers AI currently includes a daily free allocation and structured JSON output support.

Platform limits and model availability are deployment configuration, not game rules. Preflight checks must verify the active Cloudflare account, bindings, quotas, and selected AI model before production deployment.

References:

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2025-02-25-json-mode/

## 19. September 7 creative integration amendment

The user approved combining Gemini/Antigravity's creative direction and pnpm workflow with the reviewed Connected Classic implementation. The integration plan is `docs/superpowers/plans/2026-09-07-creative-integration.md`.

- Preserve the Neo 8-Bit arcade direction: warm word cards, readable sans-serif card words, restrained pixel-style chrome, tactile controls, and team identity conveyed by color, glyph, pattern, and semantic label. Accessibility remains a verification requirement, not a guarantee from a design document.
- Preserve source prototypes, word lists, image samples, recipes, and design notes in tracked creative folders. Label historical assertions and experiments; archival text is not approval or completion evidence.
- Use pnpm workspaces and a committed portable lockfile, explicit build-script approvals, and the complete existing release checks. Original npm-based execution records remain historical.
- Retain the reviewed authoritative server, strict role projections, reconnect/idempotency handling, confirmation freshness, and privacy regression harness. Adopt separate card-selection/grid-order random streams while retaining validated IDs and ownership distribution.
- Creative tools may prepare art separately. In-app AI remains editable text suggestions only. Pack Studio, picture/mixed runtime boards, token/audio customization, and campaigns retain their existing milestone boundaries.
- Bring HTTPS enforcement, response headers, bounded admission limits, reproducible staging configuration, and pre-session live verification into this integration before the next staging playtest. The only authorized deployment target is the separate staging Worker/domain; the apex is outside this integration.
- The four-human playtest remains a real milestone exit gate. Automated integration completion cannot substitute for it.
