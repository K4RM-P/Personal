import * as React from 'react'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { Switch } from './ui/Switch'
import {
  CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH,
  type CustomerDisplaySettingsDTO,
  type CustomerDisplaySlideDTO
} from '@shared/customerDisplay'

/**
 * Settings → Customer Display (spec §6). Slide edits save immediately so a
 * running second screen picks them up live, with no restart.
 */
export function CustomerDisplaySettingsCard(): React.JSX.Element {
  const [slides, setSlides] = React.useState<CustomerDisplaySlideDTO[]>([])
  const [settings, setSettings] = React.useState<CustomerDisplaySettingsDTO>({
    enabled: true,
    slideDurationSeconds: 8,
    eTransferEmail: '',
    pharmacyName: ''
  })
  const [durationInput, setDurationInput] = React.useState('8')
  const [emailInput, setEmailInput] = React.useState('')
  const [saved, setSaved] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [modalOpen, setModalOpen] = React.useState(false)
  const [modalText, setModalText] = React.useState('')
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)

  const load = async (): Promise<void> => {
    try {
      if (!window.api?.customerDisplay) return
      const [loadedSlides, loadedSettings] = await Promise.all([
        window.api.customerDisplay.getSlides(),
        window.api.customerDisplay.getSettings()
      ])
      setSlides(loadedSlides)
      setSettings(loadedSettings)
      setDurationInput(String(loadedSettings.slideDurationSeconds))
      setEmailInput(loadedSettings.eTransferEmail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer display settings')
    }
  }

  React.useEffect(() => {
    // Initial fetch on mount, matching the other settings cards. The setState
    // calls happen in load()'s async continuation, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  const persistSlides = async (next: CustomerDisplaySlideDTO[]): Promise<void> => {
    setError(null)
    setSaved(null)
    try {
      const result = await window.api.customerDisplay.saveSlides(
        next.map((s) => ({ text: s.text }))
      )
      setSlides(result)
      setSaved('Slides updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save slides')
      void load()
    }
  }

  const persistSettings = async (next: {
    enabled: boolean
    slideDurationSeconds: number
    eTransferEmail: string
  }): Promise<void> => {
    setError(null)
    setSaved(null)
    try {
      const result = await window.api.customerDisplay.saveSettings(next)
      setSettings(result)
      setDurationInput(String(result.slideDurationSeconds))
      setEmailInput(result.eTransferEmail)
      setSaved('Customer display settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer display settings')
    }
  }

  const handleToggleEnabled = (enabled: boolean): void => {
    void persistSettings({
      enabled,
      slideDurationSeconds: settings.slideDurationSeconds,
      eTransferEmail: emailInput
    })
  }

  const handleSaveDetails = (): void => {
    const duration = Number(durationInput)
    if (!Number.isFinite(duration) || duration < 1) {
      setError('Slide duration must be at least 1 second.')
      return
    }
    void persistSettings({
      enabled: settings.enabled,
      slideDurationSeconds: Math.round(duration),
      eTransferEmail: emailInput
    })
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= slides.length) return
    const next = [...slides]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setSlides(next)
    void persistSlides(next)
  }

  const handleDelete = (slide: CustomerDisplaySlideDTO): void => {
    if (!window.confirm(`Delete the slide “${slide.text}”?`)) return
    setError(null)
    setSaved(null)
    window.api.customerDisplay
      .deleteSlide(slide.id)
      .then(() => load())
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to delete slide')
      )
  }

  const openAdd = (): void => {
    setEditingIndex(null)
    setModalText('')
    setModalOpen(true)
  }

  const openEdit = (index: number): void => {
    setEditingIndex(index)
    setModalText(slides[index].text)
    setModalOpen(true)
  }

  const remaining = CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH - modalText.length
  const modalValid = modalText.trim().length > 0 && remaining >= 0

  const handleModalSave = (): void => {
    if (!modalValid) return
    const next = [...slides]
    if (editingIndex === null) {
      next.push({ id: -1, text: modalText.trim(), sortOrder: next.length })
    } else {
      next[editingIndex] = { ...next[editingIndex], text: modalText.trim() }
    }
    setModalOpen(false)
    void persistSlides(next)
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Customer Display</CardTitle>
        <CardDescription>
          The customer-facing second screen: an idle slideshow, then a live mirror of the cart and
          payment totals. Opens automatically when a second monitor is connected.
        </CardDescription>
      </CardHeader>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              Enable customer-facing display
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Turn off to leave a connected second monitor free for something else.
            </p>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Pharmacy name shown on this screen: <strong>{settings.pharmacyName || '—'}</strong> (from
          Store Information — edit it there).
        </p>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
            E-Transfer receiving email (shown to the customer when paying by e-transfer)
          </label>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="payments@yourpharmacy.com"
            className="input"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
            Slide duration (seconds)
          </label>
          <input
            type="number"
            min={1}
            max={120}
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            className="input"
          />
        </div>

        <button
          onClick={handleSaveDetails}
          className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)]"
        >
          Save Customer Display Settings
        </button>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--foreground)]">Slideshow slides</p>
            <button
              onClick={openAdd}
              className="min-h-11 rounded-[var(--radius)] border border-[var(--primary)]/30 px-3 text-xs text-[var(--primary)] hover:bg-[var(--muted)]"
            >
              + Add Slide
            </button>
          </div>

          {slides.length === 0 ? (
            <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              No slides yet — the display shows your pharmacy name instead.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)]">
              {slides.map((slide, index) => (
                <li key={slide.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-6 shrink-0 text-xs text-[var(--muted-foreground)]">
                    {index + 1}.
                  </span>
                  <span className="flex-1 truncate text-sm text-[var(--foreground)]">
                    {slide.text}
                  </span>
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move “${slide.text}” up`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-30"
                  >
                    <ArrowUp className="icon-4" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === slides.length - 1}
                    aria-label={`Move “${slide.text}” down`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-30"
                  >
                    <ArrowDown className="icon-4" />
                  </button>
                  <button
                    onClick={() => openEdit(index)}
                    aria-label={`Edit “${slide.text}”`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                  >
                    <Pencil className="icon-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(slide)}
                    aria-label={`Delete “${slide.text}”`}
                    className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] text-[var(--error)] hover:bg-[var(--error-bg)]"
                  >
                    <Trash2 className="icon-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {saved && <Alert variant="success">{saved}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {editingIndex === null ? 'Add slide' : 'Edit slide'}
            </h3>
            <label className="mt-3 mb-1 block text-xs text-[var(--muted-foreground)]">
              Slide text
            </label>
            <input
              type="text"
              autoFocus
              value={modalText}
              maxLength={CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH}
              onChange={(e) => setModalText(e.target.value)}
              placeholder="FREE DELIVERY"
              className="input"
            />
            <p
              className={
                remaining < 0
                  ? 'mt-1 text-[11px] text-[var(--error)]'
                  : 'mt-1 text-[11px] text-[var(--muted-foreground)]'
              }
            >
              {remaining} characters remaining
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSave}
                disabled={!modalValid}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                Save slide
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
