# Stremio sync rework + multi profiles - checklist

Doc: docs/stremio-sync/decomposition.md

## A. Core (crates/core) - DONE, cargo check green
- [x] A1 CtxAuthResult merge-on-connect (profile: settings kept + addon union; library: merge_items) - anonymous-only, account switch keeps replace
- [x] A2 ActionCtx::Disconnect + Internal::Disconnect + Event::SessionDisconnected; keep-data arms in profile/library/streams/search_history/notifications/dismissed_events/trakt; delete_session best effort
- [x] A3 session expiry (code==1) -> Disconnect (was the wiping Logout)
- [x] A4 no other auto-Logout sites (grep); seekLog/SkipGaps never dispatched from apps/web (grep); `calendar` storage key is dead (constants-only)

## B. Web
- [x] B1 stremioApi.ts (apiFetch + local readers + read-only server snapshot)
- [x] B2 computeSyncDiff (toPush/toPull/addon deltas, core-identical second-granularity)
- [x] B3 syncActivity.ts (capped per-profile log + subscribe event)
- [x] B4 SyncModal rework (Connect / connected view: Sync now + Disconnect + Differences + Recent activity; import/upload flows deleted, stremioUpload.ts deleted)
- [x] B5 useStremioSync (event->log translation + launch/focus/10-min scheduler) mounted in App
- [x] B6 Logout unreachable from UI: NavMenu + Settings now dispatch Disconnect

## C. Profile dropdown
- [x] C1 NavMenuContent: Sync & backup + Stremio sync rows (+ Connected badge), Disconnect link
- [x] C2 Settings > General > User: moved links removed (Connect/Disconnect state only)

## D. Multi offline profiles
- [x] D1 profileStorage.ts (registry + active pointer + `p:<id>:` prefix; default = raw keys, zero migration)
- [x] D2 worker.js -> ['rillioStorage', ...]; window.rillioStorage defined in createTransport
- [x] D3 all direct localStorage consumers routed (localData, stremioApi, useDisplayName, nextEpisodePreloadPrefs, Error.tsx scoped clear); aniskip cache deliberately global (content cache, not user data)
- [x] D4 profile picker in the dropdown (switch=pointer+reload, create, 2-step delete; default+active protected)

## E. Verify
- [x] E1a browser pass (anonymous flows): boot green, dropdown local-first identity,
      create/switch/switch-back profiles with PROVEN namespace isolation (core wrote
      `p:<id>:schema_version`, default untouched), modal both tabs render, backup
      QR+code green, ZERO console errors, anonymous boot logs nothing.
      Two bugs found BY the new activity log and fixed: (1) useStremioSync gate was
      `!== null` but pre-state auth is undefined; (2) a legacy App.tsx block
      dispatched the 3 sync actions on every boot/focus unconditionally (even
      anonymous, silently erroring) - removed, useStremioSync owns account sync now.
- [x] E1b **PASSED in the SHELL (Michael, dev account, 2026-07-17 19:10):**
      connect -> merge -> "planned: 20 to send, 0 to fetch" -> pushed -> add-ons
      sent + checked -> user refreshed -> "Everything is in sync (42 here, 42 on
      the account)". Deduction: the account already held ~22 items with matching
      mtimes, so the OLD upload had in fact worked - it just couldn't prove it.
      Found+fixed: connect double-pushed the library (modal dispatch + the
      hook's connected-transition run) - modal now pushes add-ons only.
- [x] E1c **disconnect-keeps-data PASSED on Michael's REAL data** (CDP read of
      the shell post-disconnect): 42 library items intact, 17 addons kept,
      settings kept, auth null, buckets uid->null. One bug surfaced: the legacy
      Routes.tsx auth->null redirect dumped the user onto /intro (identity-model
      leftover) - REMOVED (disconnect now stays in place; only intro->home on
      sign-in remains). Fix browser-verified; shell picks it up next rebuild.
- [x] E2 shell pass: Michael ran the whole E1b flow in the dev shell (new
      bundle baked, caches cleared) - UI + sync verified there
- [x] E3 wasm build green; web production build green (rerun after the
      identity/local-first pass - exit 0)
