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

/** Real transport backed by the runtime's global `fetch` (present in Electron/Node ≥18). */
export const fetchTransport: HttpTransport = async (method, url, headers, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body != null ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // leave as raw text for non-JSON error bodies
  }
  return { status: res.status, ok: res.ok, body: parsed }
}
