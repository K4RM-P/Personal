/**
 * Minimal JSON-over-HTTPS transport shared by the gateway/cloud REST adapters
 * (Square, Moneris, Global Payments). Kept as an injectable function so adapters
 * stay unit-testable without real network access — tests pass a fake transport.
 */
export interface HttpResponse {
  status: number
  ok: boolean
  body: unknown
}

export type HttpTransport = (
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: unknown
) => Promise<HttpResponse>

/** Bound on how long a charge/refund HTTP call may hang before we treat it as a timeout. */
const DEFAULT_TIMEOUT_MS = 30_000

/** Real transport backed by the runtime's global `fetch` (present in Electron/Node ≥18). */
export const fetchTransport: HttpTransport = async (method, url, headers, body) => {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    })
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'.
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    throw new Error(
      isTimeout
        ? `Payment request timed out after ${DEFAULT_TIMEOUT_MS}ms with no response — charge status is unknown, do not assume it failed`
        : `Payment request failed before receiving a response: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // leave as raw text for non-JSON error bodies
  }
  return { status: res.status, ok: res.ok, body: parsed }
}
