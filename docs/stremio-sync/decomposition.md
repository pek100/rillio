# Stremio sync rework + multi profiles - decomposition

<!--
id: stremio-sync-decomposition
tags: sync, profiles, stremio-api, core, priority-high
related_files: crates/core/src/models/ctx/update_profile.rs, crates/core/src/models/ctx/update_library.rs, crates/core/src/models/ctx/ctx.rs, apps/web/src/App/SyncModal/SyncModal.tsx, apps/web/src/common/stremioUpload.ts, apps/web/src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.tsx, crates/core-web/src/worker.js
status: in-progress
last_sync: 2026-07-17
-->

Directive (Michael, 2026-07-17): stay CONNECTED to Stremio (no fake disconnect
after import), autosync both ways while connected, disconnect keeps local data,
single "Sync" replaces Import/Upload, sync UI moves under the profile dropdown,
multi offline (local) profiles, everything syncs except analytics, and the sync
must be PROVABLE (logs + before/after diff - Michael doubts upload ever worked).

## Current state (mapped 2026-07-17)

- Import = `Ctx.Authenticate` (core pulls user+addons+library) then a client-side
  fake disconnect in SyncModal (`finishStremioImport`: anonymize buckets, null
  `profile.auth` in localStorage, reload). No server logout.
- Upload = `common/stremioUpload.ts` direct API with a temp session (login ->
  datastoreMeta -> datastorePut -> addonCollectionGet/Set -> logout), because
  `Ctx.Authenticate` REPLACES the local anonymous library/profile.
- Core auto-pushes on every library edit + addon change WHEN AUTHED; `Ctx.
  SyncLibraryWithAPI` is a real two-way mtime merge; nothing schedules it.
- LANDMINES: core `Logout` resets every bucket to default (wipes local);
  session expiry (API code 1 in GetUser result) auto-dispatches `Logout` ->
  would wipe local data once we stay connected. `CtxAuthResult` also resets
  `Settings::default()` (login wipes settings today).
- Analytics: the only usage-data upload endpoint in core is `seekLog`
  (+ `getModal`/`getNotification` promo fetches). Nothing else to exclude.
- Storage seam for profiles: wasm worker RPCs storage via
  `bridge.call(['localStorage','getItem'])` (crates/core-web/src/worker.js) ->
  main-thread window.localStorage. Perfect interception point.

```
[Stremio sync rework + multi profiles]
├── [A. Core: safe connect/disconnect]  (crates/core; wasm rebuild after)
│   ├── [A1] CtxAuthResult merge-on-connect: if previous profile was anonymous,
│   │        keep local settings + union addons (by transport_url); library
│   │        bucket merges local items (mtime LWW) instead of replace ✓ atomic
│   ├── [A2] New ActionCtx::Disconnect -> Internal::Disconnect: delete_session
│   │        (best effort), profile.auth=None KEEPING addons+settings, retag
│   │        uid->None on library/streams/search_history/notifications/calendar
│   │        buckets, persist all, Event::SessionDisconnected ✓ atomic
│   ├── [A3] Session expiry (code==1) -> Internal::Disconnect, NOT Logout(false)
│   │        (expired session must never wipe local data) ✓ atomic
│   └── [A4] Audit: no other auto-Logout sites; seekLog never dispatched by our
│   │        player (verify + note) ✓ atomic
├── [B. Web: connect/sync/disconnect UX]
│   ├── [B1] stremioUpload.ts -> stremioApi.ts: keep apiFetch + add read-only
│   │        snapshot calls (datastoreMeta/addonCollectionGet/getUser) ✓ atomic
│   ├── [B2] syncStatus: diff local vs server (authKey from profile.auth.key):
│   │        toPush/toPull/addonsMissingEachSide counts + detail ✓ atomic
│   ├── [B3] syncActivity: persistent capped log (op, counts, error, ts) of
│   │        every sync request/result; surfaced in the UI ✓ atomic
│   ├── [B4] SyncModal Stremio tab rework: disconnected = sign-in (Connect);
│   │        connected = account row, autosync copy, Sync now, Disconnect,
│   │        diff panel + activity log. Delete finishStremioImport + Direction
│   │        pills + upload flows. Connect seq: Authenticate -> persist events
│   │        -> SyncLibraryWithAPI + PushAddonsToAPI (pushes merged-in local) ✓
│   ├── [B5] Autosync scheduler: while authed, SyncLibraryWithAPI +
│   │        PullAddonsFromAPI on launch, on focus (throttled), every 10 min;
│   │        each run logged ✓ atomic
│   └── [B6] Logout semantics: NavMenu + Settings "Log out" -> Disconnect
│   │        (keep data); destructive reset no longer reachable from UI ✓ atomic
├── [C. UI move under the profile dropdown]
│   ├── [C1] NavMenuContent: add "Sync & backup" + "Stremio sync" rows opening
│   │        the modal tabs; connected state shows sync status ✓ atomic
│   └── [C2] Settings > General > User: drop the moved links ✓ atomic
├── [D. Multi offline profiles]
│   ├── [D1] profileStorage.ts: active-profile pointer + registry (unprefixed
│   │        meta keys); key prefix `p:<id>:` for non-default profiles; legacy
│   │        profile = "default" = UNPREFIXED keys (zero migration) ✓ atomic
│   ├── [D2] worker.js src: storage RPC -> ['rillioStorage', ...]; main thread
│   │        defines window.rillioStorage with the prefix logic (wasm-package
│   │        rebuild picks it up) ✓ atomic
│   ├── [D3] Route ALL direct localStorage uses in apps/web through the helper
│   │        (localData, stremioApi reads, useDisplayName, Error.tsx clear) ✓
│   └── [D4] Profile picker UI in the dropdown: list/create/switch(reload)/
│            delete(confirm); per-profile display name ✓ atomic
└── [E. Verify]
    ├── [E1] Browser dev-server pass: connect with a real account, diff view
    │        answers "did upload ever work", sync round-trip proven ✓ atomic
    └── [E2] Shell pass (web build + cargo build, EBWebView cache cleared) ✓
```

Ordering: A (core, wasm rebuild) -> B -> C -> D -> E. B1-B3 are independent of A.

Known risks:
1. Anything touching Logout/buckets can wipe user data (0.1.17 incident) - keep
   the destructive path unreachable, test on a scratch profile first.
2. CtxAuthResult merge must NOT merge when switching between two REAL accounts
   (only from anonymous) - else account A's data leaks into account B.
3. datastorePut succeeds on empty changes - the diff view exists precisely to
   catch "successful" no-op pushes.
4. Multi-profile prefixing must catch EVERY localStorage consumer or a profile
   bleeds into another (grep `localStorage` across apps/web at the end).
