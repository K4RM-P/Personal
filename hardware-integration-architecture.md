# Hardware Integration Architecture — Electron Desktop POS

Platform decision: **Electron**. Rationale: only Electron/native gives raw USB, serial, and network
socket access needed for receipt printers and payment terminals — a browser sandbox cannot do this
without extra hardware bridges. Electron's **main process** (Node.js, full OS access) talks to devices;
the **renderer process** (Chromium, your actual POS screen/UI) never touches hardware directly — it
sends IPC messages to the main process, which does the real work. This separation matters: it's what
lets you swap hardware later without touching UI code.

```
┌─────────────────────────────┐        IPC        ┌──────────────────────────────┐
│  Renderer (UI - React etc.)  │ <───────────────> │  Main process (Node.js)       │
│  - checkout screen           │                    │  - device-manager module      │
│  - scan field / cart         │                    │  - printer module              │
│  - payment button             │                    │  - payment-adapter factory     │
└─────────────────────────────┘                    └──────────────────────────────┘
                                                              │
                                            ┌─────────────────┼─────────────────┐
                                       barcode scanner   receipt printer   payment terminal
                                       (USB HID)         (USB/Network)     (network/API)
```

---

## 1. Barcode Scanner

**Default mode — do nothing special.** 95% of USB/Bluetooth barcode scanners ship in "HID keyboard
wedge" mode: to the OS they *are* a keyboard. Scan a barcode, it "types" the digits + Enter into
whatever text field has focus. This is why almost no POS software writes custom scanner code — you
just:
- keep an invisible/always-focused input field on the checkout screen
- listen for the Enter keypress → treat the buffered digits as a scanned barcode → look up the SKU
- guard against a *human* typing fast by requiring the input to complete in a tight window (e.g. all
  characters within ~50ms of each other) — genuine scanners type far faster than any person can

**Advanced mode (optional, later).** Some higher-end scanners support raw serial/USB-CDC output for
extra data (e.g. weight-embedded barcodes on scale-priced items, or scanning 2D DataMatrix codes off
drug packaging for DSCSA lot/expiry capture). For that tier, use `node-hid` or `serialport` in the main
process to read raw device input instead of relying on keyboard emulation. Not needed for MVP — only
build this if/when you add DSCSA barcode scanning from the earlier spec.

**Build order:** ship keyboard-wedge support first (it's free), add raw HID/serial support as a
separate module later without touching checkout logic.

---

## 2. Receipt Printer (needs the receipt generation feature)

Thermal receipt printers speak **ESC/POS**, a byte-command protocol (bold, cut paper, barcode, etc.),
over one of three transports:
- **USB** — simplest for a single-till setup; printer shows up as a Windows printer or raw USB device
- **Network (Ethernet/Wi-Fi, port 9100)** — best for multi-station setups; just open a TCP socket and
  stream bytes, no driver dependency at all
- **Serial** — older printers only

**Recommended build:**
1. **Receipt template module** (your own code, lives in main process): takes a structured order object
   (store info, line items, tax breakdown, tender, change due, optional Rx pickup/HIPAA footer) and
   renders it into a layout — column-aligned item/price rows, header/footer, logo.
2. **Encoder library**: use `@point-of-sale/receipt-printer-encoder` (or `escpos`/`electron-pos-printer`
   as alternatives) to turn that layout into actual ESC/POS byte commands — don't hand-write the byte
   protocol yourself.
3. **Transport layer**: send the encoded bytes via network socket (preferred — printer IP set once in
   settings) or via `electron-pos-printer`'s USB/Windows-print-queue path as a fallback for USB-only
   printers.
4. **Fallback path**: also support printing to *any* standard printer (e.g. a regular office printer, or
   PDF) through Electron's normal print API, for pharmacies without a thermal printer yet, or for
   printing longer documents (statements, reports) that don't belong on 3-inch thermal paper.

This gives you: one internal "receipt object" format → pluggable output (thermal ESC/POS, standard
printer, or PDF/email receipt) without rewriting the receipt logic three times.

---

## 3. Payment Machine (must support "any provider, just add an API key")

This is the adapter pattern, and it's exactly how real payment platforms handle "support everything."
Two provider categories exist and your adapter interface needs to accommodate both:

- **Semi-integrated terminals** (Moneris, most Global Payments Integrated setups): the PIN pad is a
  separate physical device on the network/serial that handles card entry *itself*. Your POS sends "charge
  $42.17" to the terminal's local IP/COM port and gets back approved/declined — raw card data never
  touches your app. This is good: it keeps your POS mostly out of PCI-DSS scope.
- **Cloud SDK terminals** (Stripe Terminal, Square Terminal): you call a cloud API to create a payment
  intent, then push it to a paired reader over local network via their SDK, and poll/listen for the
  result.

**Common interface (implement this once, everything else plugs into it):**

```
interface PaymentProvider {
  init(config: { apiKey, terminalId?, environment }): Promise<void>
  charge(amountCents, orderRef): Promise<{ status, transactionId, cardLast4?, authCode? }>
  refund(transactionId, amountCents?): Promise<{ status }>
  void(transactionId): Promise<{ status }>
  getReaderStatus(): Promise<{ connected, batteryLevel? }>
}
```

- `MonerisAdapter`, `GlobalPaymentsAdapter`, `StripeTerminalAdapter`, `SquareAdapter` each implement this
  same interface, translating to their own real API/protocol underneath.
- A **provider registry/factory** picks the right adapter at runtime based on a settings value (`provider:
  "moneris"`) — this is the literal mechanism behind "just plug in an API key and go": your settings
  screen has a provider dropdown + credential fields, and the factory instantiates the matching adapter.
- Checkout code only ever calls the generic `PaymentProvider` interface — it never needs to know which
  processor is actually wired up.

**Practical notes:**
- Store API keys/credentials encrypted at rest (Electron's `safeStorage` API, OS keychain-backed) —
  never plain-text config files.
- Each real provider's SDK/docs will need pulling individually when you actually wire one up (Moneris,
  Stripe Terminal, Square, and Global Payments each have different auth flows) — the adapter shell above
  is the scaffold; Claude Code can build each adapter as its own small, testable module once you pick
  which processor to wire up first.
- Recommend building **one adapter fully working end-to-end first** (whichever processor you can get a
  sandbox/test account for fastest) before building the other three — validates the interface shape
  before you commit to it everywhere.

---

## Suggested build order for Claude Code
1. Barcode scanner (keyboard-wedge) — fastest win, unblocks checkout flow testing
2. Receipt template + PDF/standard-printer fallback — lets you test full transactions end-to-end
3. Payment adapter interface + one real adapter (pick your primary processor)
4. ESC/POS thermal printer transport (network socket first, USB fallback)
5. Remaining payment adapters, using the same interface
