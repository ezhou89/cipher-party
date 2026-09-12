# Room recovery boundaries

This documents the current Connected Classic v1 source behavior. It is not evidence of a deployment or a completed human playtest. Recovery remains server-authoritative; room codes locate rooms but do not authorize a seat or host.

## Invalid or incompatible persisted state

Room storage reads validate the complete v1 snapshot before the controller can use it. An absent snapshot is different from an invalid snapshot. Unknown schema/protocol versions, corrupt structure, invalid hashes or references, and inconsistent game/board state fail closed. Internal errors distinguish invalid shape from unsupported version using fixed, value-free messages; public WebSocket admission remains the existing opaque `401 Unauthorized` response.

A failed load does not write, clear, normalize, migrate, or replace the stored payload. Initialization cannot overwrite it. No projection or credential is returned from that unavailable controller. There is no v2 migration or automatic salvage path. Operators must not log/export the payload into diagnostics: snapshots contain ownership and credential hashes. Any future migration or recovery tool needs a separately reviewed design that preserves the original payload until a validated replacement is committed. Do not reset storage as a troubleshooting shortcut.

The validator accepts genuine generated lobby, playing (including paused/challenged/nomination), and complete v1 snapshots, public history and processed command results. Card dictionaries regain their null prototype at the parse boundary. Pending tickets remain hash-only and one-use; valid older snapshots may exceed today's outstanding-ticket issuance caps and those tickets expire normally.

## Presence after a failed disconnect write

Observed local fault: rejecting the last-socket disconnect persistence write leaves the seat marked connected in both committed storage and the controller cache. The failed write is not published as accepted. This is a stale presence flag, not restored connectivity or a new authorization grant.

On load completion and subsequent join, upgrade, protocol-valid admitted-message, or close events, the Durable Object reconciles flags against its own OPEN WebSocket inventory and validated serialized attachments. Message processing validates encoding/size, JSON, schema, and the attached room actor before repair; malformed traffic cannot cause snapshot writes. It samples inventory inside the serialized controller operation, compares all seats, and writes one revision change only if flags differ. `lastActivity` is preserved byte-for-byte: repair does not renew the 24-hour room lifetime. Matching inventory causes no write. A failed repair leaves the mismatch intact for a later event; there is no polling timer, write loop, client-provided presence claim, or storage deletion.

Closing sockets still consume Task 3 capacity until runtime detachment but do not count as OPEN presence. Message rate budgets run before reconciliation, so over-budget frames cannot trigger a repair snapshot write. Persisted ticket consumption still precedes socket accept/attachment, then persisted `markConnected`, first projection, and the successful upgrade. A later accepted state revision always remains authoritative; duplicate command results retain their original idempotent completion semantics.

## Lost successful join response

Observed local fault: a successful HTTP join persists a new seat before returning the response. If the response body is lost before the browser retains its credential, that seat is already allocated. Retrying the same display name currently allocates a different seat with a different token hash and another revision. The first seat is not automatically reclaimed. Display names are not identities and duplicate names are allowed.

The client must not add automatic join retries without an explicit retry-safe admission/idempotency design. Do not retain raw credential receipts server-side, deduplicate by display name, silently replace a seat, or infer token ownership. Existing users who still possess their browser-local credential reconnect to that seat; explicit forget/rejoin is a user-controlled path that may allocate another seat. A lost credential is not recoverable through the room code. Room/full/locked/in-progress rules still apply to every retry.

Host replacement, credential reissue on another device, abandoned-seat replacement, and a retry-safe join identity remain deferred. They require separate authorization, revocation, audit-history and privacy decisions before implementation. An abandoned allocation may occupy capacity until the room expires; presence repair does not remove seats or assign a new host.

## Verification scope

Local Worker regressions cover production-generated snapshot round trips, corrupt storage preservation/opaque admission, failed-write atomicity, next-event and load-time presence repair, unchanged activity, no-op inventory, hibernating sockets, and the lost-join-response allocation behavior. Browser tests continue to enforce role-safe projection and reconnect semantics. No live staging smoke, deployment, paid service, or credential-bearing diagnostic artifact is part of this task.
