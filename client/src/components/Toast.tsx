import { CheckCircle2, X } from 'lucide-react'

export type ToastAction = { label: string; onClick: () => void }

export function Toast({
  message,
  action,
  onClose
}: {
  message: string
  action?: ToastAction
  onClose: () => void
}) {
  if (!message) return null
  return (
    <div className="toast">
      <CheckCircle2 size={17}/>
      <span>{message}</span>
      {action && (
        <button
          className="toast-action"
          onClick={() => {
            action.onClick()
            onClose()
          }}
        >
          {action.label}
        </button>
      )}
      <button onClick={onClose} title="Dismiss" aria-label="Dismiss">
        <X size={16}/>
      </button>
    </div>
  )
}

