import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import { robotAudio } from '../services/robot-audio.service'

export interface ConfirmModalProps {
  isOpen: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  icon?: 'trash' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = true,
  icon,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        robotAudio.play('blip')
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        robotAudio.play('chirp')
        onConfirm()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel, onConfirm])

  if (!isOpen) return null

  const resolvedIcon = icon || (danger ? 'trash' : 'warning')

  return (
    <AnimatePresence>
      <motion.div
        className="confirm-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onMouseDown={() => {
          robotAudio.play('blip')
          onCancel()
        }}
      >
        <motion.div
          className="confirm-modal-card"
          initial={{ opacity: 0, scale: 0.94, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onMouseDown={e => e.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
        >
          <div className="confirm-modal-header">
            <div className={`confirm-modal-icon-badge ${danger ? 'danger' : resolvedIcon}`}>
              {resolvedIcon === 'trash' && <Trash2 size={20} />}
              {resolvedIcon === 'warning' && <AlertTriangle size={20} />}
              {resolvedIcon === 'info' && <Info size={20} />}
            </div>
            <div className="confirm-modal-text">
              <h3>{title || (danger ? 'Confirm Deletion' : 'Confirm Action')}</h3>
              <p>{message}</p>
            </div>
          </div>

          <div className="confirm-modal-actions">
            <button
              type="button"
              className="confirm-modal-btn cancel"
              onClick={() => {
                robotAudio.play('blip')
                onCancel()
              }}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={`confirm-modal-btn ${danger ? 'danger' : 'primary'}`}
              autoFocus
              onClick={() => {
                robotAudio.play('chirp')
                onConfirm()
              }}
            >
              {confirmText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
