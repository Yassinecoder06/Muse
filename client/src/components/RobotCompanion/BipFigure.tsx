import React from 'react'
import { motion } from 'framer-motion'

export type BipMood = 'idle' | 'happy' | 'thinking' | 'curious' | 'sleeping' | 'excited'

interface BipFigureProps {
  mood?: BipMood
  eyeOffset?: { x: number; y: number }
  isHovered?: boolean
  isDragging?: boolean
  onClick?: () => void
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  size?: number
}

export function BipFigure({
  mood = 'idle',
  eyeOffset = { x: 0, y: 0 },
  isHovered = false,
  isDragging = false,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMouseEnter,
  onMouseLeave,
  size = 80
}: BipFigureProps) {
  // Constrain eye offset to visor boundary (-4 to +4 px)
  const clampedX = Math.max(-4, Math.min(4, eyeOffset.x))
  const clampedY = Math.max(-3, Math.min(3, eyeOffset.y))

  const isThinking = mood === 'thinking'
  const isSleeping = mood === 'sleeping'
  const isHappy = mood === 'happy' || mood === 'excited'
  const isCurious = mood === 'curious'

  return (
    <div
      className={`bip-figure-wrapper mood-${mood} ${isDragging ? 'is-dragging' : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ width: size, height: size * 1.15 }}
      role="button"
      tabIndex={0}
      title="Bip, your Muse AI assistant"
    >
      <motion.svg
        viewBox="0 0 100 115"
        width="100%"
        height="100%"
        animate={
          isDragging
            ? { y: -4, rotate: 2, scale: 1.05 }
            : isSleeping
            ? { y: [0, 3, 0], transition: { repeat: Infinity, duration: 4, ease: 'easeInOut' } }
            : isHovered
            ? { y: [-2, -7, -2], transition: { repeat: Infinity, duration: 1.5, ease: 'easeInOut' } }
            : { y: [0, -5, 0], transition: { repeat: Infinity, duration: 2.5, ease: 'easeInOut' } }
        }
      >
        <defs>
          {/* Gradients */}
          <linearGradient id="bipChassis" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#d9d6ea" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient id="bipVisor" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1824" />
            <stop offset="100%" stopColor="#252136" />
          </linearGradient>

          <linearGradient id="bipEyeGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>

          <linearGradient id="bipAntennaGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>

          <radialGradient id="thrusterGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
          </radialGradient>

          <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Thruster / Levitation particle glow */}
        <motion.ellipse
          cx="50"
          cy="104"
          rx={isDragging ? 18 : 14}
          ry={isDragging ? 6 : 4}
          fill="url(#thrusterGlow)"
          animate={
            isThinking
              ? { rx: [14, 20, 14], opacity: [0.6, 1, 0.6], transition: { repeat: Infinity, duration: 0.8 } }
              : isSleeping
              ? { rx: 10, opacity: 0.3 }
              : { rx: [12, 16, 12], opacity: [0.5, 0.9, 0.5], transition: { repeat: Infinity, duration: 1.8 } }
          }
        />

        {/* Antenna */}
        <g className="bip-antenna">
          <line
            x1="50"
            y1="24"
            x2="50"
            y2="10"
            stroke="#b4adc9"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Antenna tip glowing orb */}
          <motion.circle
            cx="50"
            cy="8"
            r="5"
            fill="url(#bipAntennaGlow)"
            filter="url(#neonGlow)"
            animate={
              isThinking
                ? { scale: [1, 1.4, 1], filter: ['drop-shadow(0 0 3px #f472b6)', 'drop-shadow(0 0 8px #f472b6)', 'drop-shadow(0 0 3px #f472b6)'], transition: { repeat: Infinity, duration: 0.6 } }
                : isHappy
                ? { scale: [1, 1.3, 1], transition: { repeat: Infinity, duration: 1 } }
                : isSleeping
                ? { opacity: 0.4, scale: 0.9 }
                : { scale: [1, 1.15, 1], opacity: [0.8, 1, 0.8], transition: { repeat: Infinity, duration: 2.2 } }
            }
          />
        </g>

        {/* Side Ear Buds */}
        <rect x="14" y="38" width="6" height="14" rx="3" fill="#9d95ba" />
        <rect x="80" y="38" width="6" height="14" rx="3" fill="#9d95ba" />

        {/* Body Chassis */}
        <g className="bip-body">
          {/* Torso */}
          <path
            d="M 32 64 C 32 64, 28 88, 36 94 C 42 98, 58 98, 64 94 C 72 88, 68 64, 68 64 Z"
            fill="url(#bipChassis)"
            stroke="#b8b0cf"
            strokeWidth="1.5"
          />

          {/* Central Power Core */}
          <motion.circle
            cx="50"
            cy="78"
            r="4.5"
            fill="url(#bipEyeGlow)"
            filter="url(#neonGlow)"
            animate={
              isThinking
                ? { opacity: [0.5, 1, 0.5], scale: [0.9, 1.2, 0.9], transition: { repeat: Infinity, duration: 0.7 } }
                : isSleeping
                ? { opacity: 0.25 }
                : { opacity: [0.7, 1, 0.7], transition: { repeat: Infinity, duration: 2 } }
            }
          />

          {/* Floating Little Hands */}
          <motion.ellipse
            cx="22"
            cy="74"
            rx="4.5"
            ry="7"
            fill="#d3cde5"
            stroke="#afa7c7"
            strokeWidth="1"
            animate={
              isHappy
                ? { y: [-2, -6, -2], rotate: [-10, -25, -10], transition: { repeat: Infinity, duration: 0.7 } }
                : isDragging
                ? { y: 3, rotate: 15 }
                : { y: [0, 2, 0], transition: { repeat: Infinity, duration: 2 } }
            }
          />
          <motion.ellipse
            cx="78"
            cy="74"
            rx="4.5"
            ry="7"
            fill="#d3cde5"
            stroke="#afa7c7"
            strokeWidth="1"
            animate={
              isHappy
                ? { y: [-2, -6, -2], rotate: [10, 25, 10], transition: { repeat: Infinity, duration: 0.7 } }
                : isDragging
                ? { y: 3, rotate: -15 }
                : { y: [0, 2, 0], transition: { repeat: Infinity, duration: 2, delay: 0.3 } }
            }
          />
        </g>

        {/* Head Shell */}
        <motion.g
          animate={isCurious ? { rotate: -8, originX: '50px', originY: '45px' } : { rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          {/* Main head container */}
          <rect
            x="18"
            y="22"
            width="64"
            height="46"
            rx="23"
            fill="url(#bipChassis)"
            stroke="#b8b0cf"
            strokeWidth="1.5"
          />

          {/* Glossy Head Highlight */}
          <path
            d="M 28 27 Q 50 24 72 27"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.8"
          />

          {/* Visor Display */}
          <rect
            x="24"
            y="30"
            width="52"
            height="30"
            rx="15"
            fill="url(#bipVisor)"
            stroke="#3a3454"
            strokeWidth="1"
          />

          {/* Visor Specular Reflection */}
          <path
            d="M 28 35 Q 40 32 54 34"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.25"
          />

          {/* Eyes Group with dynamic moods */}
          <g transform={`translate(${clampedX}, ${clampedY})`}>
            {isSleeping ? (
              // Sleeping eyes: relaxed lines (- -)
              <g stroke="url(#bipEyeGlow)" strokeWidth="3" strokeLinecap="round" opacity="0.7">
                <line x1="36" y1="46" x2="44" y2="46" />
                <line x1="56" y1="46" x2="64" y2="46" />
              </g>
            ) : isHappy ? (
              // Happy eyes: smiling curves (^ ^)
              <g stroke="url(#bipEyeGlow)" strokeWidth="3" strokeLinecap="round" fill="none" filter="url(#neonGlow)">
                <path d="M 35 47 Q 40 40 45 47" />
                <path d="M 55 47 Q 60 40 65 47" />
              </g>
            ) : isThinking ? (
              // Thinking eyes: rotating/pulsing starry dots
              <g fill="url(#bipEyeGlow)" filter="url(#neonGlow)">
                <motion.circle
                  cx="40"
                  cy="45"
                  r="4"
                  animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.6, 1, 0.6] }}
                  transition={{ repeat: Infinity, duration: 0.8 }}
                />
                <motion.circle
                  cx="60"
                  cy="45"
                  r="4"
                  animate={{ scale: [1.3, 0.8, 1.3], opacity: [1, 0.6, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8 }}
                />
              </g>
            ) : (
              // Neutral / Curious eyes: expressive pills with cute specular dots
              <g fill="url(#bipEyeGlow)" filter="url(#neonGlow)">
                {/* Left eye */}
                <motion.rect
                  x="36"
                  y="40"
                  width="8"
                  height="11"
                  rx="4"
                  animate={{ scaleY: [1, 1, 0.1, 1] }}
                  transition={{ repeat: Infinity, duration: 3.5, times: [0, 0.92, 0.95, 1] }}
                />
                <circle cx="38.5" cy="42" r="1.5" fill="#ffffff" opacity="0.9" />

                {/* Right eye */}
                <motion.rect
                  x="56"
                  y="40"
                  width="8"
                  height="11"
                  rx="4"
                  animate={{ scaleY: [1, 1, 0.1, 1] }}
                  transition={{ repeat: Infinity, duration: 3.5, times: [0, 0.92, 0.95, 1] }}
                />
                <circle cx="58.5" cy="42" r="1.5" fill="#ffffff" opacity="0.9" />
              </g>
            )}

            {/* Cute Cheek Blushes when happy or excited */}
            {isHappy && (
              <g fill="#f472b6" opacity="0.65">
                <circle cx="32" cy="51" r="2.5" />
                <circle cx="68" cy="51" r="2.5" />
              </g>
            )}
          </g>
        </motion.g>

        {/* Floating "Z z Z" bubbles when sleeping */}
        {isSleeping && (
          <motion.g
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], y: [-2, -14, -22], x: [0, 4, 8] }}
            transition={{ repeat: Infinity, duration: 2.8, ease: 'easeOut' }}
          >
            <text x="74" y="24" fill="#a78bfa" fontSize="9" fontWeight="bold" fontFamily="monospace">z</text>
            <text x="82" y="16" fill="#c084fc" fontSize="12" fontWeight="bold" fontFamily="monospace">Z</text>
          </motion.g>
        )}
      </motion.svg>
    </div>
  )
}
