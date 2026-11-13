import type { ReactNode } from 'react'

/**
 * Shared building blocks for the Settings page. Every section composes these,
 * so the page reads as one system: a section is a stack of titled cards, and a
 * card is a stack of rows (label + description on the left, control on the right).
 */

export function SettingsSection({ title, description, actions, children, className }: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`settings-section${className ? ` ${className}` : ''}`}>
      <header className="settings-section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="settings-section-actions">{actions}</div> : null}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

export function SettingsCard({ title, description, icon, actions, children, tone, className, footer }: {
  title?: string
  description?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  tone?: 'default' | 'danger'
  className?: string
  footer?: ReactNode
}) {
  return (
    <div className={`settings-card${tone === 'danger' ? ' danger' : ''}${className ? ` ${className}` : ''}`}>
      {title ? (
        <header className="settings-card-head">
          {icon ? <span className="settings-card-icon">{icon}</span> : null}
          <div className="settings-card-title-group">
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="settings-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="settings-card-body">{children}</div>
      {footer ? <footer className="settings-card-footer">{footer}</footer> : null}
    </div>
  )
}

export function SettingsRow({ label, description, icon, children, className, align }: {
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children?: ReactNode
  className?: string
  align?: 'center' | 'start'
}) {
  return (
    <div className={`settings-row${align === 'start' ? ' align-start' : ''}${className ? ` ${className}` : ''}`}>
      <div className="settings-row-label">
        {icon ? <span className="settings-row-icon">{icon}</span> : null}
        <div>
          <strong>{label}</strong>
          {description ? <small>{description}</small> : null}
        </div>
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  )
}

/** Accessible on/off switch. */
export function SettingsSwitch({ checked, onChange, label, disabled, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`settings-switch${checked ? ' on' : ''}${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => { if (!disabled) onChange(!checked) }}
    >
      <i/>
    </button>
  )
}

