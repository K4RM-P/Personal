# Feature Spec — Customer-Facing Display (Second Screen)

A non-touch secondary display, physically facing the customer at the register, mirroring checkout
activity in real time. This is a read-only view — the customer never interacts with it directly. It
exists to build trust (the customer can see prices as they're scanned and confirm the total before
paying) and to fill idle time with pharmacy-controlled promotional content when nothing is
happening.

---

## 1. Architecture

### 1.1 Second Electron window, second physical monitor
This is a **second Electron `BrowserWindow`**, not a second app. It runs in the same Electron process
as the main POS app, launched automatically alongside it.

- On app launch, the main process detects connected displays (`screen.getAllDisplays()`)
- If a second display is present, a new `BrowserWindow` opens **full-screen, kiosk-style, on that
  second display** — no window chrome, no title bar, no way to close/minimize it from the customer
  side
- If only one display is present (e.g. during development, or a single-monitor register), the
  customer display window is simply not created — the app should not error or hang waiting for a
  screen that doesn't exist
- The customer display window has **no input handling** — no mouse cursor visible on it if
  avoidable, no keyboard focus, nothing clickable. It is strictly an output surface.

### 1.2 One-way data flow via IPC
The main checkout window is the source of truth. The customer display is a passive renderer of
whatever state the main process broadcasts to it.

```
Checkout window (renderer)
    → IPC → Main process
                 → broadcasts "customer-display:update" → Customer display window (renderer)
```

The customer display window never calls back into business logic, never queries the database
directly, and never affects checkout state. It only receives a stream of display-state updates and
renders whatever it's told to render. This keeps the second screen simple and impossible to use as
an attack surface against the actual transaction.

### 1.3 Display states
The customer display is always in exactly one of these states:

1. **Idle / Slideshow** — no sale in progress, or cart is empty
2. **Cart** — an active sale with at least one item, no payment in progress
3. **Payment: Cash**
4. **Payment: Card**
5. **Payment: E-Transfer**
6. **Payment: Pharmacy Credit**
7. **Thank You** — sale just completed, brief confirmation before returning to Idle

State transitions are driven entirely by what's happening in checkout — see §3 for the exact
triggers.

---

## 2. Idle / Slideshow

### 2.1 When it shows
- No sale in progress (cashier hasn't started scanning/adding items), OR
- The cart is empty (all items removed)

### 2.2 Content and behavior
- A rotating slideshow of manager-configured slides, each with a single short line of text (e.g.
  "FREE DELIVERY", "CHEAP PRICES", "LANGUAGE SUPPORT")
- **Text is massive and bold** — this is the dominant visual element on the entire screen, not a
  headline above other content. Think digital-signage scale, not app-UI scale.
- **Font size is dynamic, calculated per slide** based on the character length of that slide's text,
  so short text (e.g. "SALE!") renders enormous, and longer text (e.g. "ASK US ABOUT FREE
  PRESCRIPTION DELIVERY") shrinks just enough to fit cleanly on one or two lines without ever feeling
  small. See §2.4 for the sizing algorithm.
- Slides auto-advance on a fixed interval (default 8 seconds, configurable — see §5)
- Transition between slides: a simple, fast crossfade (per the locked motion guideline — functional,
  not decorative, under ~400ms transition since this is signage rather than an app interaction, so a
  slightly longer fade than the app's normal 150ms cap is acceptable here specifically because it's
  not a UI response to user input)
- If there are zero slides configured, show a sensible default single "slide": the pharmacy name
  (from Settings) large and centered — the screen should never render blank

### 2.3 Layout
- Full-screen, centered text, generous padding on all sides so text never touches screen edges
- Background: solid color from the locked palette (light background, e.g. white or very light gray)
  — no gradients, no imagery behind the text unless a future version adds slide images (out of scope
  for this spec)
- Text color: dark gray or the locked teal accent, high contrast against the background

### 2.4 Dynamic font sizing algorithm
The goal: text should always look intentional and maximal, never awkwardly small or awkwardly
overflowing.

```
1. Start with a maximum font size (e.g. 220px for a 1920x1080-class display — tune to actual
   target resolution)
2. Measure the rendered width (and height, if wrapping to 2 lines) of the slide's text at that size
3. If it overflows the safe display area (accounting for padding margins), reduce font size in
   small steps and re-measure
4. Allow up to 2 lines of wrap for longer slides — never more than 2; if a slide's text is long
   enough that it would need 3+ lines even at a reasonably small font size, that's a content
   problem, not a rendering problem (see the character limit in §5)
5. Settle on the largest font size that fits within 2 lines and the safe display area
6. Re-run this calculation whenever the slideshow content changes (slide edited, added, deleted) —
   don't hardcode sizes per slide in the data model, always compute at render time so it stays
   correct if slide text is edited later
```

Implementation note: use a canvas-based text measurement (`context.measureText`) or an iterative
DOM-based measure-and-shrink approach — either is fine, but the sizing must be genuinely dynamic and
computed at render time, not a lookup table of preset sizes per character-count bucket.

---

## 3. Cart state (mirrors checkout)

### 3.1 When it shows
As soon as the cashier adds the first item to a cart in checkout, the customer display transitions
from Idle to Cart state and stays there, live-updating, until either the cart is emptied (back to
Idle) or payment begins (§4).

### 3.2 Content
This mirrors **only the cart portion** of the checkout screen — not the product search bar, not the
PAY button, not any cashier-facing controls. Just what the customer needs to see:

- Line items, in the order they were added (or however checkout currently orders them):
  product name, quantity, line price
- Per-item discounts shown if applied (matching what the receipt/cart already displays — same
  formatting, e.g. "Cough drops (2) $6.24 → $5.62")
- Running subtotal
- Whole-bill discount shown if applied
- Tax
- **Total**, visually the most prominent number on the screen — this is the number the customer
  cares about most while waiting

### 3.3 Layout and updates
- Full-screen list layout, generously sized text (readable from a normal customer standing distance
  at a register — larger than the cashier-facing cart text, since the customer is often a bit
  further from this screen and reading it passively rather than interacting with it)
- Updates **live and instantly** as the cashier scans/removes items or applies discounts — no
  perceptible lag, no manual refresh
- If the list of items grows longer than fits on screen at a comfortably readable size, scroll
  smoothly to keep the most recently added item and the running total both visible — total and tax
  should behave like a fixed footer that's always visible even as items scroll, per typical POS
  customer-display convention
- Styling: same locked palette (cool grays, teal accent), flat 1px dividers between line items, no
  decorative elements — this screen's job is legibility, not visual flourish

---

## 4. Payment states

Triggered the moment the cashier selects a payment method inside the PAY popup in checkout. The
customer display switches from Cart state to the payment-method-specific screen below. The cart
total remains visible/referenced on each of these screens so the customer isn't left wondering what
number is being discussed.

### 4.1 Cash

```
┌─────────────────────────────────────┐
│                                       │
│         Total: $47.50                │
│                                       │
│         Cash Given: $50.00           │
│                                       │
│         Change: $2.50                │
│                                       │
└─────────────────────────────────────┘
```

- Shows the sale total, the cash amount entered by the cashier, and the change due — updates live as
  the cashier types the cash-given amount in checkout
- **If the payment is being applied to Pharmacy Credit instead of returned as change** (per the
  existing short-pay-to-tab / deposit behavior already in the system), show that instead of "Change":
  ```
  Total: $47.50
  Cash Given: $50.00
  Deposited to Pharmacy Credit: $2.50
  ```
  Which of these two labels renders is driven by whatever the actual transaction is doing — this
  display doesn't decide the behavior, it reflects it.

### 4.2 Card

```
┌─────────────────────────────────────┐
│                                       │
│         Total: $47.50                │
│                                       │
│      Please Tap, Insert, or          │
│      Swipe Your Card                 │
│                                       │
│   (Follow instructions on the        │
│    payment terminal)                 │
│                                       │
└─────────────────────────────────────┘
```

- Shows the total and a clear instruction to interact with the physical terminal, since the actual
  payment interaction happens on that separate device, not on this screen
- If the sale includes the 2% credit surcharge, the total shown here is the surcharge-inclusive
  total (i.e. exactly the amount the terminal will charge) — never show a pre-surcharge number here,
  since a customer comparing this screen to the terminal's displayed amount is a natural trust check
  this screen should pass, not fail
- No card-specific status detail (approved/declined/processing) needs to be mirrored here in detail
  — the terminal itself communicates that. Keep this screen simple and instructional.

### 4.3 E-Transfer

```
┌─────────────────────────────────────┐
│                                       │
│         Total: $47.50                │
│                                       │
│      Please send an E-Transfer to:   │
│                                       │
│      payments@mainstreetpharmacy.com │
│                                       │
└─────────────────────────────────────┘
```

- Shows the total and the pharmacy's e-transfer recipient email (from Settings — this should already
  exist somewhere in the payment/e-transfer configuration built earlier; reuse it, don't introduce a
  second place to configure the same email)
- If the cashier entered a specific customer email during the e-transfer flow (per the existing
  checkout e-transfer screen), that's for the pharmacy's records — this display always shows the
  **pharmacy's own receiving email**, not the customer's, since that's the address the customer
  actually needs to send to

### 4.4 Pharmacy Credit

```
┌─────────────────────────────────────┐
│                                       │
│         Total: $47.50                │
│                                       │
│      Amount Charged to Tab: $47.50   │
│                                       │
│      Balance After: $12.50 credit    │
│      (or: $8.00 owed)                │
│                                       │
└─────────────────────────────────────┘
```

- Shows the total, the amount actually charged to Pharmacy Credit (which may be less than the total
  if this is a split tender with another method covering the rest), and the customer's resulting
  balance after the transaction
- Owed vs. credit is distinguished the same way it is everywhere else in the app — icon + label, not
  color alone (per the locked colorblind-safe status pattern) — even though this is a passive
  display, consistency matters and some customers may have color vision deficiency too
- If this is a split tender (e.g. Cash + Pharmacy Credit), this screen can either show sequentially
  (cash screen, then credit screen) as the cashier completes each part of the tender, or show both
  amounts together if the checkout flow finalizes them together — follow whatever the actual
  checkout sequencing already does, mirror it faithfully rather than inventing a different sequence
  for this screen alone

---

## 5. Thank You screen

### 5.1 Trigger
Immediately when a sale completes successfully (same moment the receipt-print popup would appear on
the cashier's screen).

### 5.2 Content

```
┌─────────────────────────────────────┐
│                                       │
│                                       │
│      Thank you for choosing          │
│      Main Street Pharmacy!           │
│                                       │
│                                       │
└─────────────────────────────────────┘
```

- Pharmacy name pulled from Settings (the same pharmacy-name field used elsewhere in the app —
  receipts, etc. — reuse it, don't add a second configuration field)
- Large, bold, centered — similar visual weight to a slideshow slide
- Displays for a short fixed duration (default 5 seconds, could reuse the same timing pattern as the
  receipt-popup auto-close if one exists) and then **automatically transitions back to Idle /
  Slideshow state**, ready for the next customer
- If a new sale starts (cart gets its first item) before the Thank You duration elapses, transition
  immediately to Cart state rather than waiting out the timer — the next real customer's experience
  takes priority over finishing an idle animation

---

## 6. Settings — Manager-only configuration

Add a **"Customer Display"** section to Settings (manager-gated, consistent with other
manager-only settings sections already in the app):

```
Customer Display

Pharmacy name shown on this screen: [ pulled from existing Settings field, not duplicated ]

Slideshow Slides                              [ + Add Slide ]
┌─────────────────────────────────────────────────────────┐
│ 1. FREE DELIVERY                          [Edit] [Delete]│
│ 2. CHEAP PRICES                           [Edit] [Delete]│
│ 3. LANGUAGE SUPPORT — SE HABLA ESPAÑOL    [Edit] [Delete]│
└─────────────────────────────────────────────────────────┘

Slide duration: [ 8 ] seconds
```

### 6.1 Slide management
- **Add Slide:** opens a simple modal with a single text field. Enforce a reasonable character limit
  (e.g. 60 characters) so the dynamic sizing algorithm in §2.4 never has to fight an unreasonably
  long string down to unreadably small text — show a live character counter in the modal
- **Edit:** same modal, pre-filled with the existing text
- **Delete:** confirmation before removing (simple confirm, doesn't need to be as heavy as a
  financial-data deletion elsewhere in the app)
- **Reorder:** drag-to-reorder the slide list if the component library in use supports it easily;
  if not, a simple up/down arrow per row is an acceptable substitute — the slideshow plays slides in
  the order they're listed here
- Slide duration is configurable (default 8 seconds), applies uniformly to all slides — per-slide
  custom durations are not required for this pass

### 6.2 Live behavior
- Any change made here (add/edit/delete/reorder a slide, change duration) should be reflected on the
  customer display **immediately** if it's currently showing the slideshow — no restart required.
  If the customer display happens to be mid-payment-state when a slide is edited, the change simply
  takes effect the next time the display returns to Idle.

---

## 7. Data model

```prisma
model CustomerDisplaySlide {
  id          Int      @id @default(autoincrement())
  text        String   // enforce max length (e.g. 60 chars) at the application layer
  sortOrder   Int      // determines slideshow order
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([sortOrder])
}
```

Slide duration and any other display-level settings (on/off toggle for the whole feature, if
desired) can live in the existing app settings store used elsewhere in the project — no need for a
dedicated table for a single numeric setting.

```prisma
// Addition to existing Settings model/table (however settings are currently stored):
// customerDisplaySlideDurationSeconds: Int, default 8
// customerDisplayEnabled: Boolean, default true
```

---

## 8. Second-window lifecycle details

### 8.1 Launch behavior
- On app start, after the main window is created, check `screen.getAllDisplays()`
- If more than one display is detected, create the customer display `BrowserWindow`:
  - `fullscreen: true`
  - Positioned on the secondary display (use the non-primary display's `bounds` for `x`/`y`)
  - `frame: false` (no title bar/chrome)
  - `kiosk: true` (prevents the user from easily escaping/resizing it — appropriate since this is a
    dedicated fixed customer-facing screen)
  - No dev tools accessible in production builds
  - Loads a separate renderer route/entry dedicated to the customer display, not the main app's
    router — keep this a distinct, minimal renderer bundle since it never needs the full app's
    functionality (no auth, no navigation, no forms)

### 8.2 If the second display isn't present at launch
- Don't error, don't retry aggressively, don't block the main app's startup
- Optionally, re-check periodically (e.g. every 30 seconds) in case a second monitor is connected
  after the app has already started, and open the customer display window if one becomes available —
  this handles the case where the monitor is powered on slightly after the PC boots

### 8.3 If the second display is disconnected while running
- Detect via `screen.on('display-removed', ...)`
- Close the customer display window cleanly (don't let it become an orphaned invisible window) and
  don't crash the main app
- If the display later reconnects, recreate the window per §8.1

### 8.4 Manual override
In Settings, alongside the slide management, include a simple toggle: **"Enable customer-facing
display"** (default on). If turned off, the second window should not be created/should close if
already open, even if a second monitor is present — some registers may have a second monitor used
for something else entirely, and the feature shouldn't force itself onto a screen the pharmacy
doesn't want it on.

---

## 9. IPC contract

### 9.1 Channel: `customer-display:update`
Sent from main process to the customer display renderer whenever checkout state changes in a way
that affects what should be shown.

```typescript
type CustomerDisplayState =
  | { mode: 'idle' } // slideshow — renderer pulls its own slide data separately, see 9.2
  | {
      mode: 'cart';
      lineItems: Array<{ name: string; qty: number; lineTotalCents: number; discountCents?: number }>;
      subtotalCents: number;
      billDiscountCents?: number;
      taxCents: number;
      totalCents: number;
    }
  | { mode: 'payment-cash'; totalCents: number; cashGivenCents: number; changeCents: number; depositedToCreditCents?: number }
  | { mode: 'payment-card'; totalCents: number } // total already includes surcharge if applicable
  | { mode: 'payment-etransfer'; totalCents: number; pharmacyEmail: string }
  | { mode: 'payment-tab'; totalCents: number; chargedToTabCents: number; balanceAfterCents: number }
  | { mode: 'thank-you'; pharmacyName: string };
```

### 9.2 Channel: `customer-display:slides` and `customer-display:settings`
Sent once on the customer display window's load, and again any time slides or the pharmacy name /
duration setting change in Settings — the renderer keeps these locally and drives the idle slideshow
from them without needing a round-trip to the main process on every slide transition.

### 9.3 Source of truth
The checkout renderer sends state changes to the main process via the existing IPC pattern already
established in this app (not a new pattern) — the main process simply relays/broadcasts to the
customer display window. The checkout renderer does not talk to the customer display window
directly; everything passes through the main process, consistent with how this app's IPC
architecture already works everywhere else.

---

## 10. Edge cases

| Case | Required behavior |
|---|---|
| Only one monitor connected | No customer display window is created; main app functions normally |
| Second monitor connected mid-session | Customer display window opens automatically within ~30s, starts in Idle |
| Second monitor disconnected mid-session | Window closes cleanly, no crash, no orphaned process |
| Sale is voided/cancelled mid-ring | Customer display returns to Idle immediately |
| Cart is emptied (all items removed) without completing a sale | Customer display returns to Idle |
| Zero slides configured | Falls back to a default single "slide" showing the pharmacy name |
| A slide's text is edited while it's currently showing | The currently-displayed instance finishes its normal duration with the old text; the new text applies on its next rotation — don't yank text off screen mid-display in a jarring way |
| App is closed/restarted | Customer display window closes and reopens cleanly on next launch, no leftover process |
| Split tender across two methods | Display sequences through each payment-state screen matching the actual checkout sequence, per §4.4 |

---

## 11. Non-negotiables

- The customer display is strictly **read-only / non-interactive** — no click handlers, no visible
  cursor if avoidable, no way for a customer to affect the transaction from this screen
- It never shows information the customer shouldn't see: no other customers' data, no cashier-only
  controls, no internal cost/margin figures — only what's explicitly specified above
- Card total shown always includes any applicable surcharge — never a number that would mismatch
  what the terminal itself charges
- Text sizing is genuinely dynamic (computed at render time), never a hardcoded lookup table
- The feature must never block, slow down, or crash the main checkout app if the second screen or
  its window has any kind of failure — the customer display is enhancement, not critical path
- Settings changes to slides apply live, no app restart required

## 12. Build order

1. Second-window creation/lifecycle in the main process (§8) — get an empty full-screen window
   opening correctly on the second monitor before building any content for it
2. IPC broadcast plumbing (§9) — wire checkout state changes through to a "hello world" customer
   display renderer
3. Idle/Slideshow screen + dynamic text sizing algorithm (§2)
4. Settings: slide management CRUD + live updates (§6)
5. Cart-mirroring screen (§3)
6. Payment-state screens: Cash, Card, E-Transfer, Pharmacy Credit (§4)
7. Thank You screen + auto-return-to-Idle (§5)
8. Edge case handling: monitor connect/disconnect, manual on/off toggle (§8.2–8.4)
9. Full end-to-end test: ring up a real multi-item sale on the main screen while watching the
   customer display update live through every state
