# Accessibility audit

Evidence for the launch gate `accessibility-audit` in `ops/launch-evidence.json`:
core non-media workflows pass an accessibility audit, and the limitations
Airboard publishes are accurate.

> **Re-run required:** recorded on 6 November 2026, before RGB-046 (Trash removed) and RGB-047 (creation-first redesign) changed the UI it tested. Treat the results below as history until the audit is run again.

**Status (6 November 2026):** every page outside the drawing canvas passes
WCAG 2.2 AA automated rules at 1280 and 320 CSS px, works with a keyboard,
keeps focus visible and returns it after menus and dialogs, reflows to 320 px
and respects reduced motion. Two structural fixes wait on files another
engineer is editing (see [Fixes in the board and live-link files](#fixes-in-the-board-and-live-link-files)).
This was an internal audit with automated tools and keyboard testing. No one
has yet used Airboard with a real screen reader, so Airboard does not claim
conformance. The owner signs the gate off.

## Method

- **Automated rules.** axe-core 4 through `@axe-core/playwright`, WCAG 2.0,
  2.1 and 2.2 A and AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
  `wcag22aa`), on each page at 1280×720 and again at 320 px wide, and on each
  dialog, menu and popover once it is open. axe's best-practice rules (one
  `main`, one `h1`, unique landmarks) were read as well, and the important ones
  became tests.
- **Keyboard.** Tab and Shift+Tab through each page, recording every stop, its
  name and its focus ring. Each menu and dialog was opened from the keyboard,
  used, and closed with Escape, checking where focus went.
- **Focus after changes.** Client-side navigation between pages, and focus
  after actions that remove the focused control: choosing a menu item,
  closing a dialog, sending a sign-in link, answering the cookie banner,
  deleting a board.
- **Reduced motion.** `prefers-reduced-motion: reduce` emulated, then every
  running animation and transition listed with `document.getAnimations()`.
- **Contrast.** axe's colour-contrast rule, plus hand calculations for what
  axe can't measure: gradients, translucent panels, focus rings, hover states,
  placeholder text and the dark sidebar.
- **Reflow.** 640 px (a 1280 px window at 200%) and 320 px (400%): no
  horizontal page scroll, and nothing hidden without another way to reach it.
- **Screen-reader path.** Playwright's accessibility snapshots
  (`locator.ariaSnapshot()`) and axe: landmarks, heading outline, accessible
  names and roles, form labels, live regions, and text alternatives for board
  content. VoiceOver, NVDA and JAWS could not be driven from this environment;
  see [Limitations of this audit](#limitations-of-this-audit).

Tools: Playwright 1.64 with Chromium, the E2E API and the signed-in harness in
`apps/web/e2e/support/signedInApi.ts` (owner, admin and Viewer roles, personal
and team workspaces).

## Pages covered

| Area | Pages |
| --- | --- |
| Public | `/`, `/product`, `/pricing`, `/security`, `/accessibility`, `/privacy`, `/integrations`, `/integrations/google-meet`, `/use-cases/product-teams`, `/status`, `/support`, `/contact-sales`, `/help` and three articles, every `/pilot/*` page, the 404 pages (site and help), `/invite/<token>`, `/login` and `/signup` signed out, `/auth/callback` |
| Sharing | `/s/<token>` (a working link and an expired one), `/live/<id>` (the expired-link error) |
| Signed in | Overview, Boards, Shared, Trash, Activity, Integrations, Plan & billing, all six Settings sections, all six Admin sections, a personal workspace's Admin page, an unknown section, `/onboarding` |
| Board | The editor's chrome: top bar, rename, Share dialog, ••• menu, Move to Trash dialog, Airo composer, the creation toolbar, every creation menu and the shape library, zoom; the Viewer's view-only board |
| Cookie banner | First visit, at 1280 and 320 px |

Out of scope as media workflows: drawing on the canvas, camera gestures, Airo
voice and screen or camera composition. Their controls were still checked for
names and keyboard access.

## Results

After the fixes below, `apps/web/e2e/accessibilityAudit.spec.ts` passes in
full, including the tests for the board and live-link fixes. The earlier checks in `accessibility.spec.ts`, `keyboardAccess.spec.ts`
and `signedInApp.spec.ts` still pass.

| Check | Result |
| --- | --- |
| axe WCAG 2.2 AA, 1280 px | No violations on any page, dialog or menu listed above |
| axe WCAG 2.2 AA, 320 px | No violations |
| One `main`, one `h1` | Every page except the board editor and the expired live link (pending changes) |
| Page titles | Every page has its own; the board tab shows the board's name |
| Route changes | Next.js announces the new title (or the new page's `h1`) after each client-side navigation |
| Keyboard | Every control reachable in a sensible order; no traps; the canvas lets Tab leave after its last object |
| Focus visible | Every Tab stop has a solid ring of at least 3:1 |
| Focus return | Menus, dialogs, menu items that open dialogs, creation menus and the shape library all return focus to the button that opened them |
| Reduced motion | No running animation or transition on the landing page, demo, help or board |
| Reflow | No horizontal scroll at 640 or 320 px; every navigation destination still reachable |
| Screen-reader structure | Landmarks named, tables exposed as tables, form fields labelled, results announced through live regions that exist before they change |

## What failed and how it was fixed

1. **Page titles.** Almost every page had the site title, so Next.js's route
   announcer, which only speaks when the title changes, never announced a
   client-side navigation (WCAG 2.4.2). Every route now has a title
   (`pageTitles.ts` for the section routes), the board tab shows the board's
   name, and a unit test fails if a new page has none.
2. **Focus rings below 3:1.** The shared ring was violet at 34% opacity
   (1.6:1), the toolbar's 26% (1.4:1), the canvas's teal 35% (1.8:1). Creation
   menus and the shape library marked focus only with a pale fill identical to
   "selected" (1.2:1), and the help search field and Airo composer had none
   (WCAG 1.4.11, 2.4.7). Rings are now solid `--focus-ring` (#6948dc, 5.4–5.9:1
   on the light surfaces), a light tint (#c4b5fd) on the dark sidebar, Airo
   panel, mobile bar and dark banners, and drawn inside the canvas edge so the
   workspace can't clip it. A unit test rejects translucent focus outlines.
3. **Navigation lost at narrow widths.** Below 1000 px the public header hid
   Product, Integrations, Pricing and Enterprise; below 820 px the app hid the
   sidebar, so Settings, Plan & billing, Sign out, Activity, Integrations and
   all Admin pages were unreachable at 200% zoom (WCAG 1.4.10). The public
   navigation now wraps to a second row, and the app's bottom bar has a
   **More** button (a disclosure that closes on Escape and returns focus) with
   everything else.
4. **Settings overflowed at 320 px.** The section list widened the grid to
   695 px. Fixed with a `minmax(0, 1fr)` column; the list is now a labelled
   `nav` with `aria-current`.
5. **Tables you couldn't scroll with a keyboard.** At 320 px the admin and
   settings tables and the help articles' tables scrolled sideways with no way
   to focus them (axe `scrollable-region-focusable`, WCAG 2.1.1). The app
   tables now stack each row's cells on narrow screens; help tables take focus
   so arrow keys scroll them.
6. **Div tables.** Members, invitations, view-only links, SCIM tokens, audit
   events, installations, activity, connected accounts, data requests and
   sessions were grids of `div`s with no table semantics (WCAG 1.3.1). They now
   carry `table`, `row`, `columnheader` and `cell` roles and a name.
7. **Unlabelled field.** The SCIM token name had no label (axe `label`,
   critical). Labelled.
8. **Contrast.** The billing badge (4.48:1), the sidebar's section labels
   (3.0:1), its lower links (4.1:1) and "Sign out" (4.0:1), the Airo
   composer's placeholder (3.3:1, and it is the only visible prompt), the help
   search placeholder (2.9:1), the table-size hint (4.1:1) and creation menu
   shortcuts (3.7:1), and the light start of the primary buttons' gradient
   (4.0:1, 3.5:1 on hover) were raised to 4.5:1 or better.
9. **Reduced motion missed some surfaces.** The rule covered only the product
   shells; the standalone and shared boards, live pages and cookie banner
   animated regardless. It now applies to every element.
10. **Landmarks and headings.** Board pages had a `main` inside `main`; the
    sign-in and signup pages had none; error states, the board's loading and
    error states, the auth callback and the global error page had no `main` or
    `h1`, and two used `role="alert"` on `main`, which removes the landmark.
    Help articles had five unnamed navigation landmarks. A personal
    workspace's Admin page and unknown app sections had no `h1`. All fixed.
11. **Focus lost after actions.** Choosing a menu item, cancelling a dialog
    opened from a menu (Rename, Move to Trash, in the library and the board),
    closing a creation menu with Escape or by choosing a tool, closing the
    shape library, sending a sign-in link, answering the cookie banner and
    "Ask for more pilot time" all dropped focus on the page. Focus now returns
    to the button that opened the menu, or moves to the new content. The shape
    library also closes on Escape now.
12. **Invalid ARIA in the creation menus.** The table-size picker was a `grid`
    of `menuitem`s with `aria-pressed`; the shape library's buttons were
    `menuitem`s outside any menu. The picker is a `group` of menu items; the
    library's are toggle buttons with `aria-pressed`.
13. **Target size.** Table-size cells were 20 px on a 23 px pitch (WCAG
    2.5.8). Now 21 px on a 24 px pitch.
14. **Label in name.** Creation menu items were named "Marker, shortcut M"
    but showed "Marker M" (WCAG 2.5.3). The shortcut key is drawn from an
    attribute, so the visible label is the start of the name.
15. **Announcements.** Help search results and the library's "moved to
    Trash" notice used live regions inserted together with their text, which
    screen readers often miss. Both regions now exist before they change.
16. **Zoom controls at 200%.** The board hid its zoom buttons below 700 px,
    leaving keyboard users at 200% zoom no way to zoom the canvas. They now
    hide only at phone widths (480 px and below).
17. **Ambiguous name.** A member's status button read only "active". It now
    reads, for example, "active, suspend Acme Owner".

## Fixes in the board and live-link files

These files were being changed for live links at the same time, so the audit
specified the fixes and they were applied there afterwards:

1. **Live link errors** (`LiveBoardJoin.tsx`): the expired, replaced, ended
   and members-only states are a `main` with an `h1`, and only the message
   itself is an alert.
2. **Joining a live board** (`LiveBoardViewer.tsx`): the joining state is a
   `main` with a status line.
3. **Board editor** (`AirboardPrototype.tsx`):
   - The board's name is the page's `h1`.
   - Renaming hands focus back to the title after Enter or Escape.
   - The canvas's description names the real field, "Type a board command".
   - When Tab moves the selection, a status line says which object is
     selected, for example "Selected “Checkout API”.".
   - The board's words are listed for screen readers beside the canvas (up to
     200), and the canvas points to that list, as on the view-only board.

## What remains

- **The selection toolbar is far from the canvas in Tab order.** It is
  reachable while an object stays selected, but it sits early in the Tab
  order, about eight stops from the top of the page and some twenty before the
  canvas. A shortcut from the canvas (such as `Alt+F10`) would make it
  practical.
- **Drawing needs a pointer.** Freehand drawing, erasing and placing or
  resizing an object at an exact spot need a pointer or touchpad. Typed
  commands cover create, connect, rename, move, colour, resize, align and
  delete.
- **Phone widths.** Below 480 px the canvas zoom buttons are hidden (pinch or
  scroll instead), and the board's chrome there was checked for axe and
  overflow only.
- **Browsers.** The audit ran in Chromium only; Edge and Chrome share its
  engine, Firefox and Safari aren't supported products.

## Limitations of this audit

- **No real screen reader.** VoiceOver, NVDA and JAWS couldn't be run here.
  The screen-reader path was judged from accessibility snapshots and axe,
  which show what a screen reader is given but not how it reads it. Before a
  conformance claim, someone should do the core workflows with VoiceOver on
  macOS and NVDA on Windows, ideally with people who use them daily.
- **Automated contrast is partial.** axe can't measure text over gradients,
  blurred or translucent panels. Those were calculated by hand for the
  elements listed above, not for every pixel of every state.
- **Hover states** were checked by calculation for the shared buttons, links
  and menus, not exhaustively. Disabled controls are exempt from contrast
  under WCAG and weren't changed.
- **Internal audit.** This isn't an independent audit or a VPAT. The public
  [accessibility page](/accessibility) and the help article
  [Keyboard, pointer, and touchpad](help/using-the-board/07-keyboard-pointer-and-touchpad.md)
  say so and list the limitations above.

## Published statements

- `/accessibility` (in `apps/web/app/[marketingSlug]/page.tsx`) said the
  release matrix "must verify" each path and that reduced motion, focus,
  contrast and screen-reader structure "remain launch requirements". It now
  describes what was checked, names the pointer-only tasks, and says there has
  been no screen-reader user test or independent audit.
- The help article *Keyboard, pointer, and touchpad* now lists the tool
  shortcuts, the toolbar's arrow keys and Escape, and an **Accessibility
  status** section with the known limitations.
- *Limits and support matrix* already says it is not an accessibility
  conformance claim, which stays true.

## Keeping it fixed

- `apps/web/e2e/accessibilityAudit.spec.ts`: axe at 1280 and 320 px, one `main`
  and `h1`, a title of its own and reflow on every page above; skip link;
  route-change announcements; the More menu at 320 px; focus rings on every
  Tab stop and their colours; focus return for the library, board, creation
  menus and shape library; Tab leaving the canvas; help search's live region;
  the cookie banner; reduced motion; zoom controls at 640 px.
- `apps/web/test/accessibilityStyles.test.mjs`: no translucent focus
  outlines, the reduced-motion rule covers every element, every page exports
  a title, and section titles are distinct.
- The earlier specs: `accessibility.spec.ts`, `keyboardAccess.spec.ts` and the
  axe test in `signedInApp.spec.ts`.
