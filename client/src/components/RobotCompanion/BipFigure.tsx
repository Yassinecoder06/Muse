import React from 'react'
import { motion } from 'framer-motion'

export type BipMood = 'idle' | 'happy' | 'thinking' | 'curious' | 'sleeping' | 'excited' | 'dizzy' | 'singing'

interface BipFigureProps {
  mood?: BipMood
  eyeOffset?: { x: number; y: number }
  isHovered?: boolean
  isDragging?: boolean
  isSpeaking?: boolean
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
  isSpeaking = false,
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
  const isDizzy = mood === 'dizzy'
  const isSinging = mood === 'singing'

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
          isSinging
            ? {
                y: [0, -6, 0, -4, 0],
                rotate: [-3, 3, -2, 2, 0],
                transition: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }
              }
            : isDizzy
            ? {
                rotate: [-8, 8, -6, 6, -3, 3, 0],
                x: [-3, 3, -2, 2, 0],
                y: [-2, 2, -2, 2, 0],
                transition: { repeat: Infinity, duration: 0.7, ease: 'easeInOut' }
              }
            : isDragging
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

          <linearGradient id="bipMicGrille" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="50%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>

          <linearGradient id="bipMicHandle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="100%" stopColor="#0f172a" />
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
              isSinging
                ? { y: [-6, 2, -6], rotate: [-20, 10, -20], transition: { repeat: Infinity, duration: 0.55, ease: 'easeInOut' } }
                : isDizzy
                ? { y: [-4, 4, -4], rotate: [-25, 25, -25], transition: { repeat: Infinity, duration: 0.35 } }
                : isHappy
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
              isSinging
                ? { x: -14, y: -16, rotate: -36 }
                : isDizzy
                ? { y: [4, -4, 4], rotate: [25, -25, 25], transition: { repeat: Infinity, duration: 0.35 } }
                : isHappy
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
            ) : isSinging ? (
              // Joyful singing eyes: happy closed musical arcs ( ^  ^ )
              <g stroke="url(#bipEyeGlow)" strokeWidth="2.8" strokeLinecap="round" fill="none" filter="url(#neonGlow)">
                <motion.path
                  d="M 35 44 Q 40 37 45 44"
                  animate={{ d: ["M 35 44 Q 40 37 45 44", "M 35 45 Q 40 39 45 45", "M 35 44 Q 40 37 45 44"] }}
                  transition={{ repeat: Infinity, duration: 0.5, ease: 'easeInOut' }}
                />
                <motion.path
                  d="M 55 44 Q 60 37 65 44"
                  animate={{ d: ["M 55 44 Q 60 37 65 44", "M 55 45 Q 60 39 65 45", "M 55 44 Q 60 37 65 44"] }}
                  transition={{ repeat: Infinity, duration: 0.5, ease: 'easeInOut' }}
                />
              </g>
            ) : isDizzy ? (
              // Dizzy spiral swirl eyes: comic spinning spirals
              <g stroke="url(#bipEyeGlow)" strokeWidth="2.2" strokeLinecap="round" fill="none" filter="url(#neonGlow)">
                <motion.g
                  style={{ originX: '40px', originY: '45px' }}
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
                >
                  <path d="M 40 45 m -1 0 a 1.2 1.2 0 0 1 2.4 0 a 2.5 2.5 0 0 1 -5 0 a 4 4 0 0 1 8 0 a 5.5 5.5 0 0 1 -11 0" />
                </motion.g>
                <motion.g
                  style={{ originX: '60px', originY: '45px' }}
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
                >
                  <path d="M 60 45 m 1 0 a 1.2 1.2 0 0 1 -2.4 0 a 2.5 2.5 0 0 1 5 0 a 4 4 0 0 1 -8 0 a 5.5 5.5 0 0 1 11 0" />
                </motion.g>
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

            {/* Cute Cheek Blushes when happy, excited, or singing */}
            {(isHappy || isSinging) && (
              <g fill="#f472b6" opacity="0.65">
                <circle cx="32" cy="51" r="2.5" />
                <circle cx="68" cy="51" r="2.5" />
              </g>
            )}

            {/* Speaking audio wave mouth when reading or talking */}
            {isSpeaking && !isSinging && (
              <g filter="url(#neonGlow)">
                <motion.line
                  x1="43"
                  y1="52"
                  x2="43"
                  y2="52"
                  stroke="#67e8f9"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{ y1: [52, 49, 52], y2: [52, 55, 52] }}
                  transition={{ repeat: Infinity, duration: 0.35, ease: 'easeInOut' }}
                />
                <motion.line
                  x1="47"
                  y1="52"
                  x2="47"
                  y2="52"
                  stroke="#a855f7"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{ y1: [52, 47, 52], y2: [52, 57, 52] }}
                  transition={{ repeat: Infinity, duration: 0.3, ease: 'easeInOut', delay: 0.05 }}
                />
                <motion.line
                  x1="51"
                  y1="52"
                  x2="51"
                  y2="52"
                  stroke="#f472b6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{ y1: [52, 48, 52], y2: [52, 56, 52] }}
                  transition={{ repeat: Infinity, duration: 0.32, ease: 'easeInOut', delay: 0.1 }}
                />
                <motion.line
                  x1="55"
                  y1="52"
                  x2="55"
                  y2="52"
                  stroke="#67e8f9"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  animate={{ y1: [52, 50, 52], y2: [52, 54, 52] }}
                  transition={{ repeat: Infinity, duration: 0.28, ease: 'easeInOut', delay: 0.15 }}
                />
              </g>
            )}

            {/* Singing animated vocal mouth */}
            {isSinging && (
              <g filter="url(#neonGlow)">
                <motion.path
                  fill="url(#bipEyeGlow)"
                  stroke="#a855f7"
                  strokeWidth="1.2"
                  animate={{
                    d: [
                      "M 45 52 Q 50 60 55 52 Q 50 56 45 52",
                      "M 44 51 Q 50 64 56 51 Q 50 54 44 51",
                      "M 46 53 Q 50 58 54 53 Q 50 55 46 53",
                      "M 44 51 Q 50 62 56 51 Q 50 55 44 51"
                    ]
                  }}
                  transition={{ repeat: Infinity, duration: 0.45, ease: 'easeInOut' }}
                />
              </g>
            )}

            {/* Wobbly mouth when dizzy */}
            {isDizzy && (
              <g stroke="url(#bipEyeGlow)" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.95">
                <path d="M 41 54 Q 45.5 50.5 50 54 Q 54.5 57.5 59 54" />
              </g>
            )}
          </g>
        </motion.g>

        {/* Held Stage Microphone when singing */}
        {isSinging && (
          <g id="bipMicrophone" filter="url(#neonGlow)">
            {/* Pulsing soundwave ring from mic capsule */}
            <motion.circle
              cx="57"
              cy="50"
              r="7"
              fill="none"
              stroke="#f472b6"
              strokeWidth="1"
              animate={{ r: [6, 13, 6], opacity: [0.85, 0, 0.85] }}
              transition={{ repeat: Infinity, duration: 0.85, ease: 'easeOut' }}
            />
            {/* Curving flexible mic cord */}
            <path
              d="M 68 64 Q 76 74 72 82 Q 68 89 74 95"
              fill="none"
              stroke="#1e293b"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Metallic handle */}
            <line x1="58" y1="52" x2="68" y2="64" stroke="url(#bipMicHandle)" strokeWidth="4.2" strokeLinecap="round" />
            <line x1="58" y1="52" x2="68" y2="64" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
            {/* Gold collar band */}
            <line x1="56" y1="53.5" x2="60" y2="49.5" stroke="#facc15" strokeWidth="2.4" strokeLinecap="round" />
            {/* Microphone Capsule Mesh */}
            <circle cx="56" cy="49" r="5" fill="url(#bipMicGrille)" stroke="#cbd5e1" strokeWidth="1.2" />
            <path d="M 53 49 H 59 M 56 46 V 52" stroke="#334155" strokeWidth="0.8" strokeLinecap="round" />
          </g>
        )}

        {/* Floating Musical Notes when singing */}
        {isSinging && (
          <g>
            <motion.text
              x="52"
              y="38"
              fill="#f472b6"
              fontSize="11"
              fontWeight="bold"
              initial={{ opacity: 0, y: 0, x: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [0, -18, -32],
                x: [0, -6, -12],
                scale: [0.8, 1.2, 1]
              }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
            >
              ♪
            </motion.text>
            <motion.text
              x="63"
              y="36"
              fill="#67e8f9"
              fontSize="13"
              fontWeight="bold"
              initial={{ opacity: 0, y: 0, x: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [0, -22, -38],
                x: [0, 8, 14],
                scale: [0.8, 1.3, 1]
              }}
              transition={{ repeat: Infinity, duration: 1.8, delay: 0.5, ease: 'easeOut' }}
            >
              ♫
            </motion.text>
            <motion.text
              x="47"
              y="34"
              fill="#a855f7"
              fontSize="10"
              fontWeight="bold"
              initial={{ opacity: 0, y: 0, x: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [0, -16, -30],
                x: [0, -4, -8],
                scale: [0.7, 1.1, 0.9]
              }}
              transition={{ repeat: Infinity, duration: 1.5, delay: 1.0, ease: 'easeOut' }}
            >
              ♬
            </motion.text>
          </g>
        )}

        {/* Circling dizzy stars above head */}
        {isDizzy && (
          <motion.g
            style={{ originX: '50px', originY: '18px' }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'linear' }}
          >
            <circle cx="33" cy="14" r="2.5" fill="#facc15" filter="url(#neonGlow)" />
            <circle cx="67" cy="14" r="2.2" fill="#38bdf8" filter="url(#neonGlow)" />
            <polygon points="50,6 52,10 56,10 53,13 54,17 50,14 46,17 47,13 44,10 48,10" fill="#f59e0b" opacity="0.9" />
          </motion.g>
        )}

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
