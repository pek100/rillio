# Rillio UI Rewrite - Unified Component Map (Phase 1 output)

This document is the single source of truth for Phase 2 (foundation kit) and Phase 3 (route-by-route clean-room rewrites). It resolves every conflicting recommendation across the nine research families into ONE canonical choice per job, distills the stack scout into actionable rules, and lists exactly what to install/build first.

Rewrite rule that governs everything below: we rebuild the VIEW layer only. Every hook, core.transport dispatch, quality parser, immersion state machine, and player-logic file named in the family mappings is reused verbatim. Premade parts are treated as visual references to re-skin to our tokens, never as drop-ins, and always driven by controlled/URL state (never internal trigger state) so they compose with the custom router view-stack.

---

## 1. Stack decisions

**Primitive library: Radix (locked kit-wide).** shadcn's `init` default became Base UI (July 2026), but the third-party registries we lean on (OriginUI, Kibo, Aceternity, Magic UI) still ship Radix-based parts. Mixing pulls in two primitive libs, double context, divergent APIs. We have zero primitives today, so we choose deliberately: `shadcn init -b radix`, unified `radix-ui` package (Feb 2026 collapse). Radix peer-supports React 18.3.1 cleanly; no part we adopt needs Next.js/RSC. Base UI is used in exactly ONE isolated spot by necessity (Origin UI number field is react-aria, not Base UI - see NumberStepper decision). Standardize every copied part onto Radix during the clean-room copy.

**Motion library: `motion` (not `framer-motion`), adopted lazily.** In 2026 Framer Motion consolidated into `motion`; import from `motion/react`. Use `motion@^12` (React 18/19 peer). Default to CSS transitions + `tw-animate-css` for the common cases (pill hovers, fades, dialog/menu enter-exit). Reserve `motion` for the few genuine needs: shared-layout sliding pills (`layoutId` active indicators on TopNav tabs, ToggleGroup, Settings menu), gesture/scroll-linked animation, and the Player HUD/menu choreography. Cap bundle with `LazyMotion` + `domAnimation` (~15kb); add `domMax` only where drag/shared-layout is used. Pulling any Aceternity/Magic UI part commits the whole app to `motion` - acceptable because Intro (Aurora) is the one place we want it.

**Theming: single-dark, `@theme static`, no `:root`/`.dark`/`@theme inline` indirection.** Define shadcn's semantic color names DIRECTLY in the existing `@theme static` block in `apps/web/src/styles/tailwind.css` (which emits each token both as a Tailwind color utility and as a `--color-*` custom property, which is all shadcn parts read). Add alongside current tokens:

```
@theme static {
  --color-background: var(--color-bg);           /* #020407 */
  --color-foreground: var(--color-fg);
  --color-card: var(--color-surface);            /* #0A1017 */
  --color-card-foreground: var(--color-fg);
  --color-popover: var(--color-surface);
  --color-popover-foreground: var(--color-fg);
  --color-primary: var(--color-accent);          /* #FFA033 brand */
  --color-primary-foreground: var(--color-bg);
  --color-secondary: var(--color-surface-hover); /* #111A24 */
  --color-secondary-foreground: var(--color-fg);
  --color-muted: var(--color-surface);
  --color-muted-foreground: var(--color-fg-muted);
  --color-accent: var(--color-surface-hover);    /* shadcn "accent" = neutral hover bg, NOT brand */
  --color-accent-foreground: var(--color-fg);
  --color-destructive: var(--color-danger);      /* #DF524C */
  --color-destructive-foreground: var(--color-fg);
  --color-border: var(--color-line);
  --color-input: var(--color-line);
  --color-ring: var(--color-accent);             /* focus ring = brand */
  --radius: var(--radius-card);                  /* 0.75rem */
}
```

Critical naming trap: shadcn's brand slot is `primary`; shadcn's `accent` slot is the neutral menu-item hover background, which maps to our `--color-surface-hover`, NOT to our brand `#FFA033`. Keep brand as `primary`/`ring`. `warning`/`success` have no shadcn slot - keep using `--color-warning`/`--color-success` directly. For parts that read raw `var(--primary)`/`var(--radius)` in arbitrary values, either add a tiny plain `:root { --primary: var(--color-accent); --radius: var(--radius-card); }` shim or normalize during the copy. Tune values against real content with tweakcn, then translate its exported vars into the aliases above.

**Tailwind v4 layering (load-bearing, do not regress).** Our `theme.css` + `utilities.css` are imported UNLAYERED and we skip preflight so utilities beat the legacy `*{}` reset by specificity; `@theme static` is required or v4 tree-shakes tokens the `.less` files reference by `var()` (dark-on-dark). The shadcn CLI wants the umbrella `tailwindcss` import, `@layer base`, and the `:root`/`.dark` + `@theme inline` pattern. Procedure: run the CLI for scaffolding, then DISCARD its CSS structure and hand-merge tokens. Add `@import "tw-animate-css";` UNLAYERED, AFTER utilities.css, so `data-[state=open]:animate-in`, fade/zoom utilities resolve (or rewrite those to our `--ease-smooth`/`--ease-spring`). Flatten every `@custom-variant dark` and `dark:` variant in copied parts to base styles - we have no light mode.

**CJS interop (no blocker).** webpack 5.106.2 resolves both `radix-ui` and any react-aria/Base-UI part's `exports` maps cleanly. Already installed: React 18.3.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0 (v3 is correct for Tailwind v4). ADD `class-variance-authority` (cva, ~1kb, dual ESM/CJS - the shadcn variant standard). New `.tsx` parts compile through the existing ts-loader/babel path; do NOT drop them into the legacy `.js` CommonJS path. Four gotchas to pre-empt in webpack config and helpers:
- Silence directive noise: `ignoreWarnings: [/Module level directives/]` (Radix/motion ship `"use client"`).
- Guarantee a single React: `resolve.alias` react + react-dom to one copy (or pnpm dedupe), else Radix context throws "must be used within a Provider". Keep `react-is` 18.3 aligned (Radix Slot depends on it).
- `tailwind-merge` does not know our custom utilities (`rounded-card`, `rounded-squircle`, `--radius-pill`, semantic `--color-*`) - `cn()` can silently drop/mis-dedupe them. Configure `extendTailwindMerge` with class groups for our radius/color tokens, or do not run twMerge over custom-token strings.
- Standardize new parts on `cn = twMerge(clsx(...))`. Legacy `classnames` stays only in files we have not rewritten yet.

**Registry shortlist (in priority order):**
1. shadcn/ui official (Radix variant) - the foundation primitives. Take from here first.
2. registry.directory - discovery/preview index; browse before committing a dep.
3. OriginUI - flat Tailwind-v4 form controls / segmented / pill variants; closest to our pill language. Note newer parts rebranded to "coss ui" on Base UI - verify React 18.3 + Radix before adopting any.
4. Kibo UI - higher-order data parts (color picker, data table) at shadcn.io.
5. tweakcn - theme editor for the token pass, not components.
6. Magic UI - cherry-pick sparingly (commits `motion`).
7. Aceternity UI - landing/Intro only.
8. Dice UI / shadcn-form - niche parts (Editable) if we accept the dep.
Treat every third-party pull as a re-skin target; most still ship Radix, which is why we locked Radix.

---

## 2. Unification decisions (conflicts resolved)

Each row is a job where two or more families picked different primitives, or a genuine dependency fork. The kit ships exactly ONE of each.

| Job | Families in conflict | DECISION | Why |
|---|---|---|---|
| Centered modal / modal-route shell | overlays (ModalDialog), routes-modal (ModalRoute shell), media-cards (Addon/Event/Share), metadetails (share) | ONE `ModalRoute` wrapper built on Radix Dialog. Controlled `open`, `onOpenChange -> useCloseModalRoute()`. `DialogTrigger` never used. Supports a suspense fallback (empty DialogContent) and per-route size via className. | Radix Dialog gives focus-trap, Escape, scroll-lock, outside-click, aria for free; fully controllable so the URL view-stack owns open state. Every hand-rolled backdrop/Escape/`childElementCount` hack retires. All domain modals (AddonDetails, Event, SharePrompt, nested Addons dialogs) compose on it and inherit the upgrade. |
| Anchored menu / popover | overlays (Popup), nav-shell (NavMenu), media-cards | ONE Radix Popover (generic anchored content) + ONE Radix DropdownMenu (action lists). Choose per call-site: render-prop menus that are action lists -> DropdownMenu; arbitrary anchored content -> Popover. | Radix `avoidCollisions`/`collisionPadding` deletes every hand-rolled getBoundingClientRect flip. DropdownMenu adds roving focus/typeahead/Item semantics the div menus lack. |
| Right-click menu | overlays (ContextMenu), media-cards (Video), metadetails (Stream), player (SubtitleVariant, OptionsMenu) | ONE Radix ContextMenu. For `lock`-to-element call sites (open flush to an edge, not the cursor) use DropdownMenu with `side=`. For the multi-trigger `on: ref[]` pattern, keep a thin hook that attaches `contextmenu` to the refs and opens a DropdownMenu at a virtual cursor anchor. | Purpose-built: preventDefault + cursor positioning + collision + keyboard + Item/Separator/Sub/Checkbox. Radix ships touch long-press. |
| Tooltip | overlays (Tooltips), media-cards, metadetails (DownloadToCache) | ONE Radix Tooltip + ONE `TooltipProvider` at app root. Wrapper keeps the "drop inside an element, auto-attach to parent" DX by rendering `TooltipTrigger asChild` around children. | Replaces the placeholder+manual-getBoundingClientRect system with portaled, collision-aware, hover+focus+touch+keyboard + aria-describedby. |
| Toast | overlays (Toast) | ONE Sonner `<Toaster/>` at root, wrapped by a reimplemented `useToast`/`ToastProvider` adapter that preserves `show/remove/clear/addFilter/removeFilter`, runs the filters array before `toast()`, maps our item shape and `'alert' -> 'warning'`, passes stremio-icons via Sonner's custom-icon slot. | Sonner is shadcn's current toast (old Radix Toast deprecated); covers every ToastItem feature. Adapter keeps every call site unchanged. |
| Select / labelled dropdown | selection-search (Multiselect + MultiselectMenu), routes-browse (Discover/Library), routes-modal (Addons/Settings), metadetails (StreamsList, SeasonsBar, LanguagePicker) | ONE Radix Select primitive, re-skinned to a `rounded-full` pill trigger + accent-dot indicator, with an OPTIONAL cascade (drill-in + Back) mode built as custom state on top. Type-ahead cases (LanguagePicker, long language lists) use the Combobox pattern (Popover + cmdk Command). Genuinely multi-value cases use DropdownMenu checkbox items or ToggleGroup. | Collapses the two legacy dropdown lineages (Multiselect popup/modal + MultiselectMenu drill-in) into one primitive. Radix Select portals (fixes the overflow-clip anchoring hacks) and handles mobile scroll-lock, so the popup/modal split disappears. The `level` push/pop and Back button are not a Radix idiom - kept custom. |
| Command palette | selection-search (SearchModal) | ONE cmdk `Command` / `CommandDialog`, but KEEP our `createPortal` + deliberately-un-animated `backdrop-blur` backdrop (documented perf choice). Open state driven by the URL (a route-driven layer), not TopNav's internal `searchOpen` state. | Textbook palette: CommandInput/Group-heading/Item/Empty map 1:1 to our search field/History+Suggestions/rows/empty state and add keyboard nav we lack. Paste-to-play, CLEAR_HISTORY, deepLinks nav, focus-restore, `withCoreSuspender` stay custom. |
| Carousel engine | routes-browse (HeroCarousel, MetaRow), metadetails (HeroMedia) | ONE engine = Embla (`embla-carousel-react`) + shadcn Carousel wrapper. HeroMedia uses the wrapper directly (+ `embla-carousel-autoplay`, gated to image slides). HeroCarousel keeps its bespoke 3D coverflow transforms, optionally driven by Embla headless for wrap/keyboard/swipe. MetaRow stays a fixed fit-to-width row unless we opt into a scroller (see open questions). | One carousel dependency, not three. shadcn Carousel is the official Embla wrapper (setApi for index/dots, Autoplay plugin). Aceternity apple-cards is wrong-shape + next/image-coupled - reference only. |
| Bottom sheet (mobile, draggable) | overlays (BottomSheet), routes-browse (Calendar Details) | ONE shadcn Drawer (vaul-backed), `direction=bottom`, controlled `open` from state/URL. Keep our mobile-only media-query gate and `useOrientation` force-close-on-rotate. | Native swipe/drag-dismiss + velocity/threshold snap + swipe handle deletes the manual touchmove/translateY logic. Verify the installed variant's peer dep (vaul vs Base UI) on React 18.3 - both support 18; fall back to vaul directly if the Base-UI variant fights 18.3. |
| Side panel (right edge, full height) | player (SideDrawer) | ONE shadcn Sheet (Radix Dialog based), `side=right`, controlled open. Custom edge-tab `SideDrawerButton` trigger kept. | Distinct axis/behavior from the bottom Drawer; Sheet gives focus-trap + edge slide + aria. See open question about the scrim over still-playing video. |
| Segmented toggle set | form-primitives (Chips), routes-browse (Library sort), metadetails (CuratedStreams preset) | ONE Radix ToggleGroup. `type=multiple` for filter chips (string[]), `type=single` for sort/preset. Re-skin items to `rounded-full` pills; active = accent bg / accent-fill thumb via `motion` layoutId. | Roving keyboard focus + pressed-state a11y replaces manual `selected.includes` plumbing. Wrap in HorizontalScroll where the chip row scrolls; keep the scroll-into-view effect. |
| Switch (on/off) | form-primitives (Toggle), routes-modal (Settings toggles), metadetails (VideosList notifications) | ONE Radix Switch. Retokenize track-off `--overlay-color`, checked accent, thumb foreground, size 3.2x1.7rem. Move call sites from Button-props-controlled to `onCheckedChange`. | Exact semantic/visual match; drops manual keyboard code. Settings hooks emit `{checked,onClick}` bundles - thin adapter to `onCheckedChange`. |
| Numeric stepper | form-primitives (NumberInput), metadetails (EpisodePicker), player (SubtitlesMenu Stepper) | ONE custom `NumberStepper` on the foundation Button. Covers clamp-to-range, controlled/uncontrolled, optional inline label, and optional press-and-hold repeat (250ms delay / 100ms interval). Emits the legacy synthetic `{target:{value:string}}` where NumberInput callers expect it; plain `onChange(number)` elsewhere. AVOID react-aria-components. | shadcn has no number primitive. The player Stepper is display-only with hold-repeat and units (no text entry) and is definitively custom; the Origin UI react-aria field would add a dep for only 2 of 3 usages and change contracts. One small custom primitive is lower-risk. (Flagged for Michael - see open questions.) |
| Color picker | form-primitives (ColorInput) | `react-colorful` (2.8kb, hex+alpha) wrapped in our ModalDialog, keeping the swatch trigger, transparent detection, Select/Cancel commit, i18n, and `#rrggbbaa` persistence via our `parseColor`. | Avoids Kibo's `color` package + Lucide deps for a single subtitle-styling use. Restrained design does not need Kibo's 2D canvas/eyedropper. (Flagged - see open questions.) |
| Media slider (buffered + audioBoost) | form-primitives (Slider), player (SeekBar, VolumeSlider), media scrubbers | KEEP the custom `rillio/components` Slider. Radix Slider ONLY for future plain settings sliders (single value, no buffer). | Radix Slider has no buffered secondary range, no audio-boost gradient zone, no `onSlide` vs `onComplete`, no window-level grab semantics. This is player logic - reused, restyled only. |
| Checkbox | form-primitives (Checkbox), routes-modal (Intro terms) | ONE Radix Checkbox, wrapped to keep the label+inline-link row and adapt `onCheckedChange(boolean)` to our `{type,checked,reactEvent,nativeEvent}` payload. Error state via data attr + `--color-danger`. | Accessible by construction; simplifies the hand-rolled role/aria/keyboard. |
| Radio | form-primitives (RadioButton), routes-modal (URLsManager Item) | ONE Radix RadioGroup / RadioGroupItem. URL list becomes a single-select group; standalone dots become a group-of-one. Error via data attr. | Upgrade: real grouping, roving focus, arrow-key nav that callers currently hand-roll. Touches call sites (per-item boolean -> group value). |
| Text input | form-primitives (TextInput), selection-search (SearchBar), routes-modal (AddItem, CredentialsTextInput, PasswordReset) | ONE shadcn Input, re-skinned flat/borderless with inset-outline focus. Re-add our `onSubmit`-on-Enter helper and the hardcoded autoCorrect/autoCapitalize/spellCheck-off defaults. Wrap for spatial-navigation keydown (CredentialsTextInput). | Same forwardRef + spread-props shape; token theming. |
| Inline editable field | media-cards (DisplayNameEdit) | KEEP custom (edit state machine + stopPropagation-in-menu contract + `--display-name-*` sizing). Use shadcn Input for the edit field. | Dice UI Editable is a near-exact behavioral match but adds a dep, and the stopPropagation-inside-account-dropdown contract is delicate. Custom is small and correct. (Flagged.) |
| Icon set | all | `@stremio/stremio-icons` for all product iconography; allow `lucide-react` as a secondary dep only for shadcn-internal glyphs (Select/Dropdown chevrons, Command). Swap Lucide -> stremio names during each copy where a product glyph is shown. | App standard is stremio-icons (128 names); honoring the canonical icon-button pattern matters more than the glyph source. |

---

## 3. Foundation kit (build/install first)

Phase 2 installs these once, discards the CLI's CSS structure, retokenizes to `@theme static`, flattens `dark:` variants, and exports each as a thin re-skinned wrapper. Order matters: the canonical Button + `cn()` + tokens come first because everything composes on them.

**Setup:**
```
npx shadcn@latest init -b radix        # then discard its CSS layering; hand-merge tokens
pnpm add class-variance-authority       # cva, the variant standard
pnpm add motion                         # motion/react (LazyMotion + domAnimation)
# tw-animate-css: add `@import "tw-animate-css";` UNLAYERED after utilities.css
```

**Motion, theming, interop plumbing** (see Stack decisions): `ignoreWarnings: [/Module level directives/]`, single-React alias, `extendTailwindMerge` for our radius/color utilities, `cn = twMerge(clsx(...))`.

**Canonical Button + IconButton (mandatory, kills the ellipse-button bug class).**
Keep our behavioral base (long-press via use-long-press Pointer, Enter->synthetic-click, mousedown-blur, the `buttonClickPrevented`/`buttonBlurPrevented`/`selectPrevented` nativeEvent escape hatches, polymorphic `href -> <a>`, `forwardRef`) and bolt on cva variants + Radix Slot `asChild`:
- variants: `default | ghost | outline | link`; sizes: `default | sm | lg | icon`.
- Focus is our inset solid outline (accent, negative outline-offset), NOT ring-offset.
- IconButton = `size:icon` and ALWAYS explicit square + flex centering: `inline-flex size-N items-center justify-center rounded-full`. NEVER padding-based sizing (renders ellipses). Bare glyph ~60% opacity, hover bg tint / brightness-110.

```
npx shadcn@latest add button
```

**Primitives to install (one each):**
```
npx shadcn@latest add dialog dropdown-menu popover context-menu tooltip \
  select toggle-group switch checkbox radio-group input command sonner \
  badge skeleton progress collapsible kbd item aspect-ratio field avatar \
  carousel drawer sheet button-group separator
pnpm add embla-carousel-react embla-carousel-autoplay   # carousel engine
pnpm add react-colorful                                  # ColorInput body
```

**Custom foundation primitives to BUILD (no premade fit):**
- `ModalRoute` wrapper on Radix Dialog (controlled open from `useCloseModalRoute`, suspense fallback, per-route size className, restyled overlay = `blur(24px) + rgba(0,0,0,.6)`). Every route-modal and every domain modal composes on this.
- `NumberStepper` on Button (clamp, controlled/uncontrolled, optional hold-repeat, optional label; dual onChange contract).
- Keep custom, re-skin only: `Slider` (buffered + audioBoost), `HorizontalScroll` (edge-fade mask), `Image` (broken-state + renderFallback), `DelayedRenderer` (rewrite as `useDelayedRender` hook), `ErrorBoundary` (class boundary; optional `react-error-boundary`), `Logo` / `LogoMark` (brand SVG + WebGL fluid fill), `WindowControls` (Tauri caption controls), `DisplayNameEdit`.
- Motion foundation: replace the `Transition` CSS-class primitive with `motion` `AnimatePresence` enter/exit variants (fade + slide presets). This is a BATCHED task - every `Transition` consumer (Player, SideDrawer, Indicator, BottomSheet, UpdaterBanner, ContextMenu) migrates together or `Transition` stays until each consumer is rebuilt.
- `useToast` adapter over Sonner (preserves filters + item shape).
- `EmptyState` block (centered illustration + label) shared by NotFound, Discover/Library/Search/Calendar empty states. Adopt shadcn `Empty` if present in the Radix variant set; else custom.

**Router integration rule (applies to Dialog, Drawer, Sheet, Popover, Command):** drive the primitive's controlled `open`/`onOpenChange` from router state; render via portal over the still-visible view beneath; never rely on `*Trigger`/internal open state. This is the single hardest integration constraint and it recurs in every overlay and modal-route.

---

## 4. Per-family component maps

Legend: source (shadcn = official Radix variant unless noted), confidence, then adaptation gaps and the logic that is reused verbatim.

### 4.1 form-primitives
Rewrite Button FIRST (Toggle/Chips/NumberStepper/ColorInput compose on it). Retokenize shadcn's border-heavy/ring-offset defaults to our outline-based, borderless, `--overlay-color`-track look.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| Button | shadcn Button + behavioral wrapper (medium) | No long-press / Enter->click / mousedown-blur / prevented flags / inset outline - keep our behavior layer around cva variants | use-long-press, prevented-flag escape hatches, href->anchor, forwardRef |
| Checkbox | Radix Checkbox (high) | onCheckedChange(bool) -> our rich payload at wrapper; compose label+inline-link row; error via data attr; swap Lucide Check -> stremio `checkmark` | `{type,checked,reactEvent,nativeEvent}` payload, name->id/htmlFor, forwardRef |
| Toggle | Radix Switch (high) | Move from Button-props-controlled to `onCheckedChange`; wrap optional trailing children in a label row; size 3.2x1.7rem | checked prop, disabled/tabIndex passthrough |
| RadioButton | Radix RadioGroup/Item (high) | Contract shifts to group value/onValueChange; add error via data attr | keyboard/selected/disabled; parent group logic moves into RadioGroup |
| Slider | KEEP custom (high) | Radix Slider only for future plain settings sliders | window-drag RAF throttle, useLiveRef, useRouteFocused release, buffered/audioBoost, onSlide/onComplete - do NOT rewrite |
| TextInput | shadcn Input (high) | Re-add onSubmit(Enter); preserve autoCorrect/autoCapitalize/spellCheck-off; flat borderless + inset outline | onKeyDown passthrough, spread InputHTMLAttributes, forwardRef |
| NumberInput | custom NumberStepper on Button (high) | Avoid react-aria; keep synthetic `{target:{value:string}}` event; recreate inline label + stripped spinners; `add`/`remove` glyphs | clampValueToRange, controlled/uncontrolled duality, onSubmit(Enter) |
| ColorInput | react-colorful in ModalDialog (medium) | Normalize output to `#rrggbbaa` via parseColor; keep swatch trigger + transparent detection + Select/Cancel + i18n | a-color-picker replaced; modal commit/cancel via useBinaryState, openModalPrevented, i18n keys, alpha detection |
| Chips | Radix ToggleGroup type=multiple (high) | onValueChange(next[]) -> our onSelect(value) at wrapper; keep HorizontalScroll + active scroll-into-view; pill re-skin | options/selected/onSelect contract, data-value plumbing |

### 4.2 overlays
Biggest integration decision: adopt Radix primitives and drive `open` from the URL, retiring react-focus-lock + useRouteFocused-keydown for these; PRESERVE the `onCloseRequest({type,dataset,reactEvent,nativeEvent})` callback shape the whole app depends on.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| ModalDialog | Radix Dialog -> ModalRoute wrapper (high) | Rebuild DialogFooter to map the `buttons[]` descriptor; add background-image-at-.1 div; portal to modalsContainer or migrate off; close btn -> stremio `close` | router Modal + useModalsContainer, useRouteFocused topmost-Escape gate, onCloseRequest contract, buttons[] shape |
| Popup | Radix Popover (generic) + DropdownMenu (action lists) (high) | Per-call-site render-prop -> Trigger/Content; a compat wrapper preserving open+onCloseRequest+dataset; Radix portals to body (menu no longer a DOM child of label) | open/onCloseRequest contract, dataset passthrough, auto-flip intent (now Radix avoidCollisions) |
| ContextMenu | Radix ContextMenu (high) | `on: ref[]` multi-trigger -> per-trigger wrap or hook + virtual anchor; `lock`-to-edge sites -> DropdownMenu side= | the `on` ref-array attach pattern, autoClose, lock-to-edge intent |
| BottomSheet | shadcn Drawer (vaul) direction=bottom (high) | Verify variant peer dep on 18.3 (fallback vaul direct); keep mobile-only media gate + useOrientation force-close | useBinaryState, show/onClose contract, mobile CSS gate |
| AddonDetailsModal | custom on ModalRoute (high) | AddonDetails card = divide-y rows + rounded-full version Badge; keep Image fallback to `addons` | useAddonDetails, useCore Install/Uninstall, usePlatform.openExternal, withCoreSuspender, remote-vs-local branching |
| EventModal | custom on ModalRoute + floating hero (high) | Set DialogContent overflow visible + absolutely-position the -10rem hero; keep backdrop blur(10px); accent pill CTA | useEvents GetEvents/DismissEvent, Ready-gate, dismiss-by-id, addon-vs-external CTA branch |
| SharePrompt | custom: brand Buttons + copy-input (medium) | Migrate execCommand -> navigator.clipboard; KEEP useToast success (or inline copied-check); brand colors/icons are ours | useToast, share-intent URL builders, auto-select-on-mount |
| Toast | Sonner + useToast adapter (high) | Reimplement provider over Sonner; run filters before toast(); map types (`alert`->`warning`), action, dataset; stremio icons via custom-icon slot | useToast(show/remove/clear/addFilter/removeFilter), filters suppression, item shape |
| Tooltips | Radix Tooltip + one Provider (high) | Wrapper to keep "drop-in auto-anchor" DX; position->side, margin->sideOffset | parent-anchor ergonomics, label/position/margin API |

### 4.3 selection-search

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| Multiselect (legacy) | Radix Select + accent-dot indicator (medium) | Multi-value callers -> DropdownMenu checkbox items; re-implement renderLabelContent/renderLabelText + toggle/close-Prevented as trigger children + controlled open; mode='modal' -> Select overlay or Drawer on mobile | options/selected string[]/onSelect contract, route selectableInputs deep-links, render-prop overrides |
| MultiselectMenu (drill-in) | Radix Select + custom cascade mode (medium) | `level` push/pop + Back button + caret-right are custom on top; merge with Multiselect into one primitive with optional cascade | MultiselectMenuOption shape, hidden-option filter, scroll-to-selected |
| SearchBar | shadcn Input in relative pill + absolute icon (high) | No leading-icon slot (wrap); Placeholder -> Skeleton pill; keep focus-within accent border + cursor:text | className/value/onChange contract |
| SearchModal | cmdk Command / CommandDialog (high) | KEEP custom portal + un-animated blur backdrop; custom: paste-to-play, CLEAR_HISTORY, deepLinks nav + submit, focus-restore, withCoreSuspender; open from URL not TopNav state | useSearchHistory, useLocalSearch (LocalSearch model, 250ms debounce), usePlayUrl, withCoreSuspender, useNavigate, deepLinks.search |

### 4.4 nav-shell
App chrome - mostly bespoke; value is concentrated in the TopNav active-pill (motion layoutId) and the account dropdown (DropdownMenu). Honor Tauri constraints: `data-tauri-drag-region` on the bar + flex spacer (never on interactive elements), reactive `useIsShell()`, route-Link items (not internal-state dialogs).

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| TopNav | custom bar + motion layoutId tab indicator (high) | No navbar block fits (drag regions, WebGL logo, cached badge, account hub); tabs derived from route not controlled value | useIsShell, useActiveDownloads, SearchModal, NavMenu, Link, LogoMark, OPEN_SEARCH_EVENT |
| NavBar (HorizontalNavBar) | custom chrome from Button + DropdownMenu (high) | No premade for HDR-gamma indicator, originPath back, drag regions, addon-logo-with-fallback tab. Confirm+drop dead VerticalNavBar/NavTabButton | useIsShell, useFullscreen, useHorizontalNavGamepadNavigation, useNavigate, NavMenu, SearchBar |
| MainNavBars | custom layout wrapper (high) | Glue only; optionally convert absolute panes to flex column | TopNav, useContentGamepadNavigation, safe-area tokens |
| WindowControls | custom Tauri caption controls (high) | No registry equivalent; restyle SVG glyphs to tokens only | getTauri/isShell/useIsShell, Tauri window API, collapse-fullscreen-on-drag safety |
| HorizontalScroll | custom edge-fade scroller (high) | Radix ScrollArea drops the fade-mask; not worth it | scroll-position derivation + mask-gradient CSS |
| Transition | replace with motion AnimatePresence (high) | Batched foundation task; every consumer migrates together or keep until rebuilt | it IS the logic; `${name}-enter/-exit/-active` class contract |
| DelayedRenderer | custom (rewrite as `useDelayedRender` hook) (high) | none | delay-gate behavior |
| ErrorBoundary | custom class boundary (optional react-error-boundary); fallback from Button + typography (high) | Library only supplies plumbing; fallback visuals are ours | getDerivedStateFromError/componentDidCatch/reset, App.js mount points |
| Logo | custom brand SVG (high) | Preserve paths byte-for-byte | static asset |
| LogoMark | custom WebGL fluid-fill (high) | Reuse verbatim; motion only fades the canvas in | window.__rillioFluidLogo, requestIdleCallback deferral, hoverRef, Logo fallback |

### 4.5 media-cards
Three tiers: true views to rewrite (MetaItem, MetaPreview, MetaRow, Video, ActionsGroup, ShortcutsGroup, DisplayNameEdit, Image, placeholders); pure logic wrappers to keep as-is (LibItem, ContinueWatchingItem); sub-parts folded into parents. The `selectPrevented`/`togglePopupPrevented`/`buttonClickPrevented` bubbling contract is load-bearing across all card + video controls - any wrapper must preserve it or overlay buttons double-fire navigation.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| MetaItem | custom on shadcn AspectRatio + DropdownMenu + Tooltip (high) | Overlay system (dismiss/watched/play/progress/new-videos), hover choreography, selectPrevented contract all custom | useLibraryItemState, useBinaryState, navigateWithOrigin, ICON_FOR_TYPE, metaPreview reconstruction memo |
| MetaPreview | custom hero from ActionsGroup/ToggleGroup/Badge/Dialog (high) | Links reducer, compact branch, IMDb warning-redirect pill, logo-text fallback custom; share modal -> Dialog route-drivable | linksGroups sanitizer (security-relevant), showHref/metaItemActions memos, Ratings core Rate dispatch |
| MetaRow | custom fixed row; SEE ALL -> Button; Carousel only if switching to scroller (high) | Carousel changes behavior + drops placeholder-fill (design decision) | itemComponent injection, CATALOG_PREVIEW_SIZE slicing, ReactIs guard, fill-with-placeholders |
| LibItem | KEEP as-is (logic-only) (high) | Only adapt options array shape if MetaItem menu becomes DropdownMenu | entire file: 5 Ctx dispatches, newVideos memo, optionOnSelect switch, onPlayClick |
| ContinueWatchingItem | KEEP as-is (logic-only) (high) | Ensure MetaItem dismiss layer reads onDismissClick + posterChangeCursor | RewindLibraryItem + DismissNotificationItem, posterChangeCursor |
| Image | KEEP custom (high) | No general image-with-fallback in registries (Avatar is avatar-scoped); optional blur-up here | broken-state machine, src-change reset, renderFallback/fallbackSrc, loading=lazy, onError chain |
| Video | shadcn Item (ItemMedia/Content/Actions) + Itemâ€‹Group + ContextMenu + Badge (high) | Add thumbnail progress bar, spoiler-blur, 3s selected border-flash; keep Popup gesture logic for Ctrl+click + long-press + togglePopupPrevented | useRouteFocused, useProfile (hideSpoilers, lang), usePlatform, useBinaryState, scrollIntoView, mark-watched callbacks |
| ActionsGroup | shadcn ButtonGroup + Tooltip; size prop over LESS :import (high) | Add backdrop-blur pill bg via className; toggle cases (Ratings, library) -> icon swap or ToggleGroup | items[] icon/label/disabled, Tooltip, icon-name-driven API |
| ShortcutsGroup | shadcn Kbd + KbdGroup; group layout custom (high) | Kbd won't do symbol/localization map, numeric-range collapse, OR/TO/+ separators - keep Keys.tsx logic | keyLabelMap, isRange collapse, combos[][] shape |
| DisplayNameEdit | KEEP custom; shadcn Input for edit field (high) | Dice UI Editable is a match but adds a dep + stopPropagation-in-menu is delicate | edit state machine, stopPropagation contract, `--display-name-*` theming, onCommit |

### 4.6 routes-browse
Compositional shells wrapped in MainNavBars + withCoreSuspender (keep both as the outer wrapper). Genuine route-specific work: HeroCarousel, Discover/Library filter bars + all-filters modal + states, Calendar's two-pane view. `catalog.content.type` tri-state (`Loading|Ready|Err`, `content.content` = items | error | `'EmptyContent'`) and `navigate(toPath(deepLinks.*))` recur everywhere. Aceternity/Magic UI blocks assume next/image - de-Next before use.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| Board shell | custom orchestration (high) | Registry covers none of: visible-range lazy load, posterShape rows, EmptyContent, streaming-warning gating | useBoard/loadBoardRows windowing, useContinueWatchingPreview, useStreamingServer, getVisibleChildrenRange |
| HeroCarousel | custom 3D coverflow + motion; Embla headless optional (high) | shadcn/Aceternity carousels are flat scrollers, not perspective coverflow | index/paused/7s interval state; item fields; Button (router <a>) |
| Discover | Radix Select per filter + Dialog all-filters (medium) | 'NONE' extra option wired manually; skeleton grid + DelayedRenderer empties + auto-load-if-short custom; drive Dialog open from URL; swap Lucide -> `filters` | useDiscover/loadNextPage, useSelectableInputs, useOnScrollToBottom, CATALOG_PAGE_SIZE |
| Library | Radix ToggleGroup (sort) + Select (type) (high) | onValueChange -> navigate(toPath); active from selectable.sorts.selected; empty states custom | useLibrary/loadNextPage, useSelectableInputs, withModel HOC, useNotifications |
| Search | custom shell; extract shared catalogs->MetaRow mapper w/ Board (high) | No registry for visible-range lazy load / EmptyContent; shared EmptyState | useSearch/loadSearchRows, getVisibleChildrenRange, tri-state contract |
| Calendar (route) | custom two-pane month view (high) | NOT a date-picker; do not use react-day-picker | useCalendar, useCalendarDate, sub-views Selector/Table/List/Details, BottomSheet |
| Calendar/Selector | custom 3-slot month pager (high) | Pagination models page numbers, not months | useCalendarDate, deepLinks.calendar, Button + chevrons |
| Calendar/Table+Cell | custom CSS-grid; HorizontalScroll (or Embla) in-cell (high) | No registry renders content-bearing day cells | monthInfo firstWeekday/today, per-day items, navigateWithOrigin |
| Calendar/List+Item | custom divide-y agenda (high) | Registry timeline/list parts add unwanted card chrome | filteredItems, toDayMonth, auto-scrollIntoView |
| Calendar/Details | shadcn Drawer (vaul) bottom, controlled from `selected` (high) | Drive open from selected state not DrawerTrigger; inner list + empty custom | items.find by day, BottomSheet contract |

### 4.7 routes-modal
Three routes (Addons, Settings, Cached) are literal modal-route overlays sharing `modal-shell.less`. Build ONE ModalRoute on Radix Dialog (see foundation). Intro (full-screen auth) and NotFound (full-screen empty) are NOT modal routes - do not force them into Dialog.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| ModalRoute shell | Radix Dialog wrapper, controlled open (high) | Keep view-beneath visible (verify blurred underlayer renders); nested-dialog Escape -> nested Radix Dialogs; per-route size via className | useCloseModalRoute, withCoreSuspender, router `modal:true` flag |
| Addons route | custom compose: Select/Combobox filters + Input search + Add Button; 4 nested Dialogs (medium) | Re-skin Select to `--overlay-color` pill; AddonDetailsModal/SharePrompt referenced not rebuilt; mobile Add/filter-icon behavior custom | useInstalledAddons/useRemoteAddons/useSelectableInputs, InstallAddon/UninstallAddon, searchFilterPredicate, nestedModal Escape guard |
| Addon card | custom flat divide-y row on Button/Image + Badge chips (high) | Install/uninstall/configure label logic + stopPropagation preserved; Badge -> muted 10px pill | callback props emitting `{type,nativeEvent,reactEvent,dataset}`, behaviorHints |
| AddonPlaceholder | shadcn Skeleton (high) | Layout scaffold stays custom to match card; shimmer if kit standardizes | presentational only |
| Settings route | custom scrollspy inside ModalRoute; optional ScrollArea (medium) | Do NOT replace scrollspy with Tabs internal state; attach throttled onScroll to ScrollArea viewport ref if used | useProfile/usePlatform/useStreamingServer, SECTIONS, scrollspy math, useCloseModalRoute |
| Settings Menu | custom pill-nav + motion layoutId indicator (low) | Keep externally-controlled selected + data-section contract | usePlatform version info, SECTIONS, onSelect reads data-section |
| Settings Section/Option/Category/Link | shadcn Field (+Label) + Separator/divide-y (medium) | Field defaults stacked; need horizontal 50/50 variant; :global control hooks disappear once controls are real Switch/Select | i18n, forwardRef (Section); layout primitives only |
| Settings sub-sections | Radix Switch + Select + custom ColorInput in Field/Option (high) | Hooks emit MultiselectMenu shape - thin adapter to Select value/onValueChange; preserve every shell/platform gate | useInterface/Player/Streaming/FasterDownloads/DataExport option hooks (REUSE untouched) |
| Settings User | shadcn Avatar + custom header (medium) | Pass branded anonymous/default SVGs as AvatarImage src chain; DisplayNameEdit stays custom | useCore Logout, useDisplayName, openSync, profile.auth |
| URLsManager | custom divide-y list on Button (high) | Keep add/reload wiring + inline AddItem toggle | useStreamingServerUrls |
| URLsManager Item | Radix RadioGroup + custom status pill + bin IconButton (high) | Wire RadioGroup value/onValueChange to selectServerUrl; status dot maps settings.type -> success/warning | useStreamingServer, DEFAULT_STREAMING_SERVER_URL, selected/default memos |
| URLsManager AddItem | shadcn Input + confirm/cancel IconButtons (high) | Keep Enter-to-submit + addMode lifecycle | inputValue state, handleAddUrl |
| Cached route | KEEP structure; swap frame -> ModalRoute, close -> IconButton (high) | Already Tailwind v4 target idiom; ensure focus-trap doesn't break row actions | useCachedTorrents, useLibraryLinksByInfoHash, encode/decodeStream, formatBytes/stateLabel |
| Cached Row | shadcn Progress (bar) + Badge (quality chips); actions custom (high) | Progress -> 0.5px accent bar + rounded-full track; keep deliberate text pause-pill (not triangle) | CacheEntry shape, parseStream, onPlay/onMoreInfo/onSetPaused/onDelete |
| Intro | Aceternity Aurora backdrop (de-Nexted) + shadcn Input/Checkbox/Button form (medium) | Strip Aceternity colors -> #FFA033; do NOT import its form logic; keep reducer/validation/social hooks/Authenticate dispatch; keep spatial-nav keydown | useCore Authenticate/Register, useFacebookLogin/useAppleLogin, useReducer, validation |
| Intro PasswordReset + CredentialsTextInput | shadcn Dialog + Input, wrapped for spatial-nav (high) | Layer arrow-key window.navigate back onto Input via onKeyDown; keep external reset URL | useRouteFocused, openExternal, email validity, ModalDialog buttons |
| NotFound | custom EmptyState under HorizontalNavBar (medium) | Adopt shadcn Empty if in Radix set; keep branded empty.svg | useTranslation; HorizontalNavBar referenced |

### 4.8 route-metadetails
One dense route. Fixed backdrop layer + 50vh `[MetaPreview | HeroMedia]` split + full-width StreamsList/VideosList. View-layer only; every hook/dispatch/streamQuality.js parser reused untouched. MetaPreview is audited here but lives in components family.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| Route shell + 50vh split | custom; optional ScrollArea for main column (high) | Backdrop, gradient scrim, 50vh band, stacking breakpoint, meta-extension modal all hand-authored | useMetaDetails, useSeason, useMetaExtensionTabs, 4 Ctx dispatches, useContentGamepadNavigation |
| HeroMedia carousel | shadcn Carousel (Embla) + autoplay plugin (medium) | Gate autoplay to image slides via setApi; conditional iframe mount (active only); video-vs-image dot shapes; object-position 25% crop; reset-to-0 on meta change | slide-model useMemo, active-index, auto-advance effect |
| MetaPreview column | custom compose Button/Badge/Dialog (high) | Link sanitizer + warning-redirect + Ratings + ActionsGroup custom; share Dialog as URL layer if elevated to route | linksGroups sanitizer (security), metaItemActions, Ratings/MetaLinks/ActionButton |
| StreamsList container | Radix Select addon filter (high) | Must portal (streams-container is overflow-clip); empty/error/install-CTA/loading-bar custom | streamsByAddon/filteredStreams memos, countLoadingAddons, showInstallAddonsButton, backButtonOnClick |
| CuratedStreams preset switch | Radix ToggleGroup single + motion layoutId thumb (high) | Shell only; recommendStream logic stays | preset state, recommendStream, useScreenCapability |
| CuratedStreams Watch/Tiles/Rows/show-all | shadcn Collapsible (expand) + Button + Badge; tile carousel = native overflow (high) | Grid content + caret rotation custom; ~5 tiles don't need a carousel lib | curateStreams/recommendStream/formatSize/badgeFor/providerOf/playHref, showAll, tiles memo |
| LanguagePicker | shadcn Combobox (Popover + cmdk Command) (high) | Drop position:fixed anchoring + manual outside-close (Radix portals); flag emoji + subtitlesLanguage binding custom | lang = profile.settings.subtitlesLanguage, UpdateSettings dispatch, langOptions, flagFor |
| DownloadToCache | custom canonical IconButton + optional Tooltip (high) | Tooltip replaces native title only | useCacheDownload, infoHash guard, stopPropagation |
| Stream legacy row + menu | Radix ContextMenu; row body custom Button (high) | href resolution, clipboard copy + toast, markVideoAsWatched, progress/thumbnail custom; drop togglePopupPrevented for Radix events | useCore/useProfile/usePlatform/useToast, href/download/magnetLink memos |
| Quality badge / tier chip | shadcn Badge (high) | Custom variant map (4K HDR -> accent, SD -> muted) on top | badgeFor, parseStream facets (streamQuality.js untouched) |
| Stream/Video skeletons | shadcn Skeleton (high) | Compose exact geometry to match real rows | component shapes only |
| VideosList | Radix Switch (notifications); grid stays CSS auto-fill (high) | Video card is components family (out of scope here) | videos/seasons memos, savedScrollTop restore, season-change scroll, mark-watched dispatches |
| SeasonsBar | Radix Select (season) + 2 Buttons (prev/next) (high) | Season-stepping math + disabled-edge logic stay; bind Select to selectedSeason | options/selectedSeason/prev-nextDisabled memos, onSelect contract |
| EpisodePicker | custom NumberStepper (high) | Reuses the ONE NumberStepper (react-aria avoided per unification); path-parse seed + disabled-until-changed + submit custom | initialSeason/Episode parse, disabled-when-unchanged guard, onSubmit |

### 4.9 route-player
CRITICAL: playback is NOT an HTML `<video>` - it is `useVideo()`/`usePlayer()` over the mpv bridge. Monolithic "shadcn video player" registries (Kibo, Limeplay, Shadix) are a POOR FIT and are NOT adopted: they own a media element and break the PiP-hoistable requirement. Compose chrome from low-level primitives driven by the hooks; every chrome piece is a pure controlled view taking value + callbacks, never referencing a media element. The immersion system (`overlayHidden`, `menusOpen`, per-menu `xxxMenuClosePrevented` nativeEvent flags) is load-bearing - any Radix Popover/DropdownMenu port must preserve or deliberately replace it. VideosMenu is dead - do not rebuild.

| Component | Recommended part (source, conf) | Gaps / adaptation | Logic to reuse |
|---|---|---|---|
| Player route shell | custom layer-stack orchestrator (high) | No player-owning wrapper; menu layers as state/URL-driven floating panels (not Radix trigger); keep `active-slider-within` hook + gradient scrims | usePlayer/useVideo/useStatistics/useSlowDownload/useNextEpisodePreload/useSubtitles/useMediaSession/useFullscreen + immersion state + closeMenus + closePrevented protocol (all verbatim); this is the PiP-hoist seam |
| ControlBar | shadcn Button (icon/ghost) in ButtonGroup; bar custom (high) | Zero media semantics: play/pause icon-swap, volume tiering, scale-cycle, mobile overflow popover, closePrevented all custom; flatten ButtonGroup to transparent/brightness idiom | useServices chromecast, usePlatform, useFullscreen, forwarded on*Requested callbacks, tabIndex=-1 |
| SeekBar | custom on rillio Slider (high) | Radix Slider lacks buffered range + scrub-preview + remaining-time toggle | Slider (buffered, onSlide/onComplete), useRouteFocused, useBinaryState, debounce reset, formatTime |
| VolumeSlider | custom on rillio Slider (high) | 0-200 audio-boost zone + muted=0 display are bespoke | Slider audioBoost, usePlatform maxVolume 200, debounce |
| SubtitlesMenu | custom 3-col panel on Button rows + NumberStepper (medium) | Persistent multi-column surface, not a click-dismiss menu; NOT DropdownMenu; state-driven layer + closePrevented | useSubtitles props, languages helper, SUBTITLES_SIZES, track sort/priority, embedded-vs-extra routing |
| SubtitlesMenu/Stepper | custom NumberStepper (hold-repeat) (medium) | Reuses the ONE NumberStepper; units (s/%) + hold cadence are why react-aria is avoided | useInterval(100)/useTimeout(250), clamp, onChange, i18n |
| SubtitleVariant | Radix ContextMenu; row custom Button (high) | `triggers` ref + lock='bottom' -> ContextMenuTrigger wraps row; keep in state-driven panel | ContextMenu + Button, useToast, clipboard copy, onSelect, embedded-track guard |
| AudioMenu | custom single-select list on Button rows (medium) | Persistent-panel + closePrevented favors custom over DropdownMenu RadioGroup | languages.label, onAudioTrackSelected, selectedAudioTrackId |
| SpeedMenu | shadcn DropdownMenu RadioGroup, controlled always-open (high) | Restyle RadioItem indicator -> accent dot; drive open externally; keep inside .menu-layer not Radix body portal | onPlaybackSpeedChanged, playbackSpeed, RATES (reversed) |
| OptionsMenu | shadcn ContextMenu (right-click) + shared DropdownMenu action list (high) | Used TWO ways - extract shared item list, mount in both; preserve disabled-when-no-stream + closePrevented | useCore PlayOnDevice, openExternal, useToast, useCacheDownload, deepLinks parsing, playbackDevices |
| StatisticsMenu | custom divide-y readout; Collapsible (show-more) + Badge (tier/HDR) (high) | All mpv formatters + poll effect stay | useStatistics, streamingServer.statistics, getMpvStats poll, resolutionLabel/hdrLabel/etc formatters |
| SideDrawer (+ button) | shadcn Sheet side=right, controlled (high) | Sheet adds scrim + focus-trap over still-playing video - VERIFY acceptable or disable overlay; re-add Safari guard + custom edge-tab | useCore mark-watched, MetaPreview/Video/SeasonsBar, season/videos memos, transition->focus handoff |
| Buffering | fully custom; pills -> Button (high) | Progress-clip fill-logo + torrent escalation panel bespoke | statistics, useSlowDownload (escalated/fastModeAvailable/switchToFastMode), Image fallback, torrent gating |
| Error | custom overlay + Button CTAs (medium) | Alert too heavy for full-bleed; keep layout custom | stream deepLinks, onTryDifferentSource, freeSpace flag, code===2 branch |
| NextVideoPopup | custom "up next" card; buttons -> Button (high) | Not Sonner - needs poster + dual CTA + autofocus + countdown | useProfile hideSpoilers, Image renderFallback, ICON_FOR_TYPE, animationEnded->focus |
| NextEpisodePreloadPrompt | custom toast-styled prompt; buttons -> Button (medium) | Not Sonner - persistent confirm that ignores immersion + forwards hover | useNextEpisodePreload, immersion hover forwarding |
| Indicator | custom ephemeral HUD; motion AnimatePresence over Transition (high) | Change-driven OSD, not a toast queue | useBinaryState, PROPERTIES map + formatters, prev-value diff refs, ignore-first + 1s hide |
| VolumeChangeIndicator | custom transient HUD reusing VolumeSlider (high) | No premade; overlayHidden gating | useBinaryState, VolumeSlider, icon tiering, 1.5s timeout |

---

## 5. Gaps and customs (no premade fit - hand-build)

**Brand / platform glue (fully bespoke, no registry ever applies):** Logo (brand SVG), LogoMark (WebGL fluid fill + `__rillioFluidLogo`), WindowControls (Tauri caption controls + fullscreen-collapse safety), MainNavBars (safe-area layout scaffold), HorizontalScroll (edge-fade mask), TopNav bar (drag regions + WebGL logo + cached badge + account hub).

**Domain UI (compose from primitives; the layout/logic has no equivalent):** MetaItem overlay system (dismiss/watched/play/progress/new-videos + hover choreography + selectPrevented), MetaPreview link-sanitizer + hero, AddonDetailsModal card, EventModal floating -10rem hero, addon card row, StreamsList state machine + install CTA + addons-loading bar, CuratedStreams Watch/Tiles/Rows, StatisticsMenu mpv readout, SubtitlesMenu 3-column panel, AudioMenu, all four Calendar sub-views (Selector/Table/Cell/List/Item), the whole Player layer stack + immersion.

**Player chrome (bespoke, and rewritten LAST per the plan):** Buffering fill-logo + escalation panel, Error overlay, NextVideoPopup, NextEpisodePreloadPrompt, Indicator + VolumeChangeIndicator OSDs, SeekBar, VolumeSlider.

**Primitives we BUILD ourselves:** ModalRoute wrapper, NumberStepper, useToast-over-Sonner adapter, EmptyState, motion enter/exit variant presets (Transition replacement), the Button behavioral layer, ColorInput modal wrapper, DisplayNameEdit.

**Shared logic wrappers kept verbatim (no view):** LibItem, ContinueWatchingItem, Image, DelayedRenderer.

**Cross-family DRY opportunity:** Board and Search render the identical `switch(content.type) -> MetaRow tri-state` mapper. Extract ONE shared catalog-rows renderer + shared EmptyState block so both routes (and the rewrite) consume it once.

---

## 6. Risks (scout + surfaced by families)

1. **Base-UI-vs-Radix split (highest).** shadcn default is Base UI; useful third-party registries ship Radix. Mixing = duplicated primitive libs + double context. MITIGATION: locked to Radix kit-wide (`init -b radix`); normalize every copied part during the clean-room rewrite; the ONLY Base-UI-adjacent exception is avoided by choosing custom NumberStepper over the react-aria Origin UI field.
2. **Tailwind-v4 layering regression.** The CLI wants umbrella `tailwindcss` + `@layer base` + `:root`/`.dark`/`@theme inline`; our unlayered import + `@theme static` are load-bearing. MITIGATION: run CLI for scaffolding, discard its CSS, keep unlayered theme/utilities, define shadcn aliases in `@theme static`, import `tw-animate-css` unlayered after utilities, never reintroduce `@layer base`.
3. **tailwind-merge blind to custom tokens.** `cn()` can drop/mis-merge `rounded-card`, `rounded-squircle`, semantic `--color-*`. MITIGATION: `extendTailwindMerge` class groups for our radius/color utilities, or don't twMerge custom-token strings.
4. **Single-React / "use client" friction in webpack.** Duplicated React breaks Radix context; directives clutter builds. MITIGATION: `resolve.alias` react/react-dom to one copy, keep react-is 18.3 aligned, `ignoreWarnings: [/Module level directives/]`.
5. **Icon-set drift.** Parts hard-default to lucide; app standard is stremio-icons. MITIGATION: lucide as secondary dep for internal chevrons only; stremio-icons for product glyphs; honor the canonical bare-glyph IconButton (never padding-based).
6. **Modal-as-route mismatch (recurs in every overlay).** shadcn Dialog/Sheet/Drawer/Popover/Command are trigger/state-driven; our router is a URL view-stack. MITIGATION: drive controlled `open`/`onOpenChange` from router state, portal over the still-visible view, never use `*Trigger`. This is enforced by the single ModalRoute primitive.
7. **Motion dependency creep.** One Aceternity/Magic UI part commits the app to `motion` (~30kb). MITIGATION: default to CSS + tw-animate-css; add `motion` only for gesture/shared-layout; LazyMotion + domAnimation (~15kb); Aceternity confined to Intro.
8. **Overlay-clip anchoring (surfaced by families).** Several dropdowns (StreamsList filter, LanguagePicker) live inside overflow-clip scroll panels and hand-roll `position:fixed` anchoring. MITIGATION: Radix Select/Popover portal to body - drop the manual getBoundingClientRect anchoring + scroll/resize close listeners.
9. **selectPrevented bubbling contract (media-cards + player).** Inner overlay controls set a nativeEvent flag so the outer Button skips navigation; any premade wrapper that swallows or re-dispatches events double-fires. MITIGATION: preserve the `selectPrevented`/`togglePopupPrevented`/`buttonClickPrevented`/`xxxMenuClosePrevented` protocol through the Button behavioral layer; verify on every card/video/menu.
10. **Player-owning registries break PiP.** Kibo/Limeplay/Shadix assume a `<video>` context. MITIGATION: never adopt a monolithic player; compose from low-level primitives driven by useVideo/usePlayer; keep Video + useVideo lifting-friendly for the deferred app-level session.
11. **vaul/Drawer peer on React 18.3.** shadcn migrated Drawer Vaul -> Base UI. MITIGATION: verify the installed variant's peer on 18.3 (both support 18); fall back to installing `vaul` directly if the Base-UI variant fights.
12. **Sonner is imperative, not context.** MITIGATION: the useToast adapter must faithfully reimplement filters/addFilter/removeFilter and the item shape so no call site changes.
13. **Batched Transition migration.** Every `Transition` consumer shares the `${name}-enter/-exit/-active` class contract; a piecemeal swap to motion breaks siblings. MITIGATION: migrate all consumers together, or keep `Transition` until each is rebuilt in its route pass.
14. **Aceternity/Magic UI next/image coupling (routes-browse, Intro).** MITIGATION: de-Next every block (swap next/image for the app's Image) before use; factor that cost in.