# UI rewrite: open questions and the calls made overnight

Phase 1 research flagged 7 decisions. Michael was asleep and asked for autonomous
completion, so each got the conservative call (preserve current UX, avoid new
dependencies). Reverse any of these by telling Claude; nothing below is hard to undo
except the Radix lock (#1), which is why it follows the synthesis recommendation.

1. **Primitive library: Radix** (via `shadcn init -b radix`, unified `radix-ui`
   package), NOT the new Base UI default. Reason: every third-party registry we pull
   from still ships Radix; mixing would duplicate primitive libs and React context.
   This is the one kit-wide, hard-to-reverse call, and it follows the research
   recommendation exactly.
2. **NumberStepper: custom**, built on the foundation Button (clamp, keyboard step,
   optional hold-repeat). Rejected Origin UI's react-aria NumberField: new dependency
   plus a changed onChange contract for only 2 of 3 usages.
3. **ColorInput: react-colorful** (2.8kb, dep-free) wrapped in our ModalDialog.
   Rejected Kibo UI Color Picker: richer canvas + eyedropper we do not need for
   subtitle colors, at the cost of two extra deps.
4. **DisplayNameEdit: stays custom** (shadcn Input inside). Rejected Dice UI Editable:
   near-exact match but a new dependency, and the stopPropagation-inside-account-menu
   contract is delicate.
5. **MetaRow: KEEP the fixed fit-to-width N-item row** (same UX as today). The
   scrollable peek-next carousel is a real UX change (loses placeholder-fill width
   stabilization), so it needs Michael's eyes, not an overnight call. The row is built
   so switching to the Embla wrapper later is cheap.
6. **Player SideDrawer: shadcn Sheet with modal=false** (no scrim, no focus trap), so
   the playing video stays fully interactive underneath, exactly like the current
   custom drawer.
7. **SearchModal becomes a real URL-driven modal route** in Phase 3, replacing
   TopNav's internal searchOpen state. This matches the router's modal-route
   convention (Addons/Settings/Cached already work this way) and removes a known
   inconsistency rather than adding behavior.
