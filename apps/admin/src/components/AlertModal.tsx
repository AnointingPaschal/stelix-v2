import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type AlertKind = 'success' | 'error' | 'info' | 'confirm'

interface AlertModalProps {
  kind: AlertKind
  /** When empty or unset the modal is not rendered. */
  message?: string | null
  title?: string
  onClose: () => void
  /** Confirm mode only: label of the confirm button. */
  confirmLabel?: string
  /** Confirm mode only: runs when the confirm button is tapped. */
  onConfirm?: () => void
  cancelLabel?: string
}

const TITLES: Record<AlertKind, string> = {
  success: 'Done',
  error: 'Something went wrong',
  info: 'Heads up',
  confirm: 'Are you sure?',
}

/**
 * AlertModal — the one place admin alerts live.
 *
 * Error and success messages across the admin used to render as inline
 * banners at the top of the page body, easy to miss on a phone. They now
 * open as a centred popup modal instead: an icon, a short title, the
 * message, and a button to dismiss. Confirm mode replaces the browser's
 * native window.confirm with the same centred card (Cancel + confirm
 * button). Escape or tapping the backdrop closes it; while open the
 * page behind cannot scroll.
 */
export function AlertModal({ kind, message, title, onClose, confirmLabel, onConfirm, cancelLabel }: AlertModalProps) {
  useEffect(() => {
    if (!message) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [message, onClose])

  if (!message) return null

  const icon =
    kind === 'success' ? <CheckCircle2 className="alert-icon-img success" />
    : kind === 'error' ? <AlertTriangle className="alert-icon-img error" />
    : kind === 'info' ? <Info className="alert-icon-img info" />
    : <AlertTriangle className="alert-icon-img confirm" />

  return (
    <div className="alert-overlay" role="dialog" aria-modal="true" aria-label={title ?? TITLES[kind]} onClick={onClose}>
      <div className="alert-card" onClick={(e) => e.stopPropagation()}>
        <button className="alert-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <div className={`alert-icon ${kind}`}>{icon}</div>
        <h3 className="alert-title">{title ?? TITLES[kind]}</h3>
        <p className="alert-message">{message}</p>
        {kind === 'confirm' ? (
          <div className="alert-actions">
            <button className="btn ghost" onClick={onClose}>{cancelLabel ?? 'Cancel'}</button>
            <button
              className="btn danger"
              onClick={() => { onConfirm?.(); onClose() }}
            >
              {confirmLabel ?? 'Delete'}
            </button>
          </div>
        ) : (
          <div className="alert-actions">
            <button className="btn mint alert-ok" onClick={onClose}>Got it</button>
          </div>
        )}
      </div>
    </div>
  )
}
