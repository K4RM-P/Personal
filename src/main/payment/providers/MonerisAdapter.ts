import { Socket } from 'net'
import type {
  PaymentConfig,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../../shared/types'
import type { PaymentProvider } from '../PaymentProvider'

/** Injectable so tests don't need a real socket/network. */
export type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>

const defaultTcpProbe: TcpProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = new Socket()
    const finish = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })

/**
 * Moneris V400c — Core Semi-Integrated (Ethernet).
 *
 * This is a DIFFERENT Moneris product from what earlier versions of this file
 * targeted. The first version of this adapter was built against Moneris Go
 * Cloud (a JSON REST API requiring `ist_config_code`, `ippostest.moneris.com`,
 * etc.) — that was the wrong product for a V400c. Confirmed via Moneris's own
 * V400c Core Semi-Integrated setup guide (moneris.com/help — V400C-WH-EN):
 * Core Semi-Integrated is a LOCAL NETWORK connection — the POS talks directly
 * to the terminal's own IP address and a configurable Listening Port on the
 * LAN. There is no cloud call, no store_id/api_token/ist_config_code in the
 * wire protocol at all for this product.
 *
 * What is CONFIRMED (from the setup guide, and from reading the terminal's own
 * settings screen — Settings → Application → Integration):
 *  - The terminal is reachable at `terminalIp:terminalPort` once Core
 *    Semi-Integrated + Ethernet is enabled on the device.
 *  - Once semi-integrated mode is on, the terminal's own Transactions menu
 *    disappears — every transaction must originate from the POS over this
 *    connection; there's no fallback.
 *
 * What is NOT confirmed, despite exhausting public Moneris documentation
 * (merchant setup guides, the iCT250 semi-integrated *operating* guide, the
 * public developer portal at developer.moneris.com — none of which contain
 * it): the actual ECR/POS wire protocol — message framing, field names, how a
 * Purchase/Refund/Void request and response look, how approved/declined is
 * signaled to the POS programmatically. Moneris's own docs explicitly say to
 * "consult your POS integration provider" for this — it's gated to
 * registered integration partners, not public. A request for it is pending
 * (emailed api@moneris.com / ClientConsulting@moneris.com).
 *
 * Given that, this adapter does the honest, real thing it CAN do without that
 * spec: verify the terminal is actually reachable at the configured IP/port
 * (a real TCP connection test, not a guess), and refuse to fabricate a
 * charge/refund/void protocol. `charge`/`refund`/`void` return a clear
 * `status: 'error'` explaining exactly what's missing, rather than a
 * plausible-looking request built on invented field names — that would be
 * worse than not working at all, since it could look like it's doing
 * something while silently never charging (or worse, double-charging) a
 * customer's card.
 *
 * Once the real protocol spec arrives, only `charge`/`refund`/`void` below
 * need to be filled in — `init`/`getReaderStatus`/config plumbing are already
 * correct for this product and don't need to change.
 */
export class MonerisAdapter implements PaymentProvider {
  readonly name = 'moneris' as const
  readonly interactionMode = 'automatic' as const

  private terminalIp: string | null = null
  private terminalPort: number | null = null

  constructor(private readonly probe: TcpProbe = defaultTcpProbe) {}

  async init(config: PaymentConfig): Promise<void> {
    const ip = config.terminalIp?.trim()
    const port = config.terminalPort?.trim()
    if (!ip || !port) {
      throw new Error(
        "Moneris Core Semi-Integrated requires the terminal's local IP address and Listening Port " +
          '(read from the terminal itself: Settings → Application → Integration)'
      )
    }
    const portNum = Number(port)
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
      throw new Error(`Moneris terminal port must be a valid port number, got "${port}"`)
    }
    this.terminalIp = ip
    this.terminalPort = portNum
  }

  private notImplemented(action: string): string {
    return (
      `Moneris Core Semi-Integrated ${action} is not implemented yet — the ECR/POS protocol spec ` +
      'for this connection has not been confirmed (Moneris gates it to registered integration ' +
      'partners; request is pending). The terminal connection itself is configured and reachable, ' +
      'but no request is sent because the real message format is unknown, and guessing risks a ' +
      'silent failure or a duplicate charge. Do not attempt this transaction on Moneris until the ' +
      'spec is confirmed — use Manual/External Terminal mode instead.'
    )
  }

  async charge(amountCents: number): Promise<ChargeResult> {
    if (!this.terminalIp)
      return { status: 'error', amountCents, message: 'Moneris terminal not configured' }
    return { status: 'error', amountCents, message: this.notImplemented('Purchase') }
  }

  async refund(): Promise<RefundResult> {
    return { status: 'declined', message: this.notImplemented('Refund') }
  }

  async void(): Promise<VoidResult> {
    return { status: 'error', message: this.notImplemented('Void') }
  }

  /**
   * The one thing that CAN be verified for real right now: is the terminal actually
   * reachable at the configured IP/port over the LAN? Plain TCP connect, no protocol
   * knowledge required — this alone confirms the network setup is correct so that
   * whoever wires up the real protocol later isn't also debugging connectivity.
   */
  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.terminalIp || !this.terminalPort) {
      return {
        connected: false,
        provider: this.name,
        message: 'Not configured — set the terminal IP and port'
      }
    }
    const label = `Moneris V400c at ${this.terminalIp}:${this.terminalPort}`
    const reachable = await this.probe(this.terminalIp, this.terminalPort, 5_000)
    return {
      connected: reachable,
      provider: this.name,
      label,
      message: reachable
        ? 'Terminal is reachable on the network (protocol not yet implemented — see adapter notes)'
        : 'Could not open a TCP connection to the terminal — check the IP/port and that Core ' +
          'Semi-Integrated + Ethernet is enabled on the device'
    }
  }
}
