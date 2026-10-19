import React, { useEffect, useRef, useState } from 'react'
import type { DailyPoint, HeatCell } from '../services/insights'
import { WEEKDAYS } from '../services/insights'

// Small dependency-free SVG charts for the Insights page. Colors come from CSS
// variables on .analytics-page so light and dark themes share the markup.

export const SERIES = [
  { key: 'notes', label: 'Notes', color: 'var(--an-notes)' },
  { key: 'tasks', label: 'Tasks done', color: 'var(--an-tasks)' },
  { key: 'chats', label: 'Bip chats', color: 'var(--an-chats)' }
] as const

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
export const formatNumber = (value: number) => value >= 10_000 ? compact.format(value) : value.toLocaleString('en')

const longDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

export function Legend({ showChats = true }: { showChats?: boolean }) {
  return (
    <div className="an-legend">
      {SERIES.filter(series => showChats || series.key !== 'chats').map(series => (
        <span key={series.key}><i style={{ background: series.color }}/>{series.label}</span>
      ))}
    </div>
  )
}

/** Stacked bars of notes, completed tasks and Bip chats per day (or week). */
export function TrendChart({ points, bucket, showChats }: { points: DailyPoint[]; bucket: 'day' | 'week'; showChats: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const series = SERIES.filter(item => showChats || item.key !== 'chats')
  const width = 640
  const height = 200
  const top = 12
  const bottom = 24
  const left = 28
  const plotHeight = height - top - bottom
  const totals = points.map(point => series.reduce((sum, item) => sum + point[item.key], 0))
  const max = Math.max(4, ...totals)
  const niceMax = Math.ceil(max / 4) * 4
  const slot = (width - left) / Math.max(points.length, 1)
  const barWidth = Math.max(2, Math.min(28, slot * 0.7))
  const labelEvery = Math.ceil(points.length / 8)
  const hovered = hover !== null ? points[hover] : null

  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Activity over time" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map(step => {
          const y = top + plotHeight - (step / 4) * plotHeight
          return (
            <g key={step}>
              <line x1={left} x2={width} y1={y} y2={y} className="an-gridline"/>
              <text x={left - 6} y={y + 3} textAnchor="end" className="an-axis">{niceMax * step / 4}</text>
            </g>
          )
        })}
        {points.map((point, index) => {
          const x = left + index * slot + (slot - barWidth) / 2
          let y = top + plotHeight
          return (
            <g key={point.key} onMouseEnter={() => setHover(index)}>
              <rect x={left + index * slot} y={top} width={slot} height={plotHeight} fill="transparent"/>
              {series.map(item => {
                const h = point[item.key] / niceMax * plotHeight
                y -= h
                return h > 0 ? <rect key={item.key} x={x} y={y} width={barWidth} height={h} rx={Math.min(3, barWidth / 3)} fill={item.color} opacity={hover === null || hover === index ? 1 : 0.45}/> : null
              })}
              {index % labelEvery === 0 && <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="an-axis">{point.label}</text>}
            </g>
          )
        })}
      </svg>
      {hovered && (
        <div className="an-tooltip" style={{ left: `${Math.min(80, Math.max(8, (hover! + 0.5) / points.length * 100))}%` }}>
          <strong>{bucket === 'week' ? `Week of ${longDate(hovered.key)}` : longDate(hovered.key)}</strong>
          {series.map(item => <span key={item.key}><i style={{ background: item.color }}/>{hovered[item.key]} {item.label.toLowerCase()}</span>)}
        </div>
      )}
    </div>
  )
}

/** A year of activity, one square per day, Monday-first columns. */
export function Heatmap({ weeks }: { weeks: HeatCell[][] }) {
  // On narrow screens the year scrolls sideways; start at the most recent weeks.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth }, [weeks])
  const cell = 11
  const gap = 3
  const left = 26
  const top = 16
  // A month label above the week that contains its 1st.
  const months = weeks.flatMap((week, index) => {
    const first = week.find(day => day.key.endsWith('-01'))
    return first && index < weeks.length - 2 ? [{ x: index, label: new Date(`${first.key}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }) }] : []
  })
  return (
    <div className="an-heatmap">
      <div className="an-scroll" ref={scroller}><svg viewBox={`0 0 ${left + weeks.length * (cell + gap)} ${top + 7 * (cell + gap)}`} role="img" aria-label="Daily activity over the last year">
        {months.map(month => <text key={`${month.x}-${month.label}`} x={left + month.x * (cell + gap)} y={10} className="an-axis">{month.label}</text>)}
        {[0, 2, 4].map(day => <text key={day} x={0} y={top + day * (cell + gap) + cell - 2} className="an-axis">{WEEKDAYS[day]}</text>)}
        {weeks.map((week, x) => week.map((day, y) => day.future ? null : (
          <rect key={day.key} x={left + x * (cell + gap)} y={top + y * (cell + gap)} width={cell} height={cell} rx={2.5} className={`an-heat-${day.level}`}>
            <title>{`${longDate(day.key)}: ${day.count ? `${day.count} action${day.count === 1 ? '' : 's'}` : 'no activity'}`}</title>
          </rect>
        )))}
      </svg></div>
      <div className="an-heat-scale"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`an-heat-${level}`}/>)}<span>More</span></div>
    </div>
  )
}

const HOURS = [0, 6, 12, 18]
const hourName = (hour: number) => hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? `${hour}a` : `${hour - 12}p`

/** When you work: weekday × hour, dot size by activity. */
export function Punchcard({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat())
  const cell = 22
  const left = 34
  const top = 6
  return (
    <svg className="an-punchcard" viewBox={`0 0 ${left + 24 * cell} ${top + 7 * cell + 18}`} role="img" aria-label="Activity by weekday and hour">
      {grid.map((row, day) => (
        <g key={day}>
          <text x={0} y={top + day * cell + cell / 2 + 4} className="an-axis">{WEEKDAYS[day]}</text>
          {row.map((count, hour) => (
            <circle key={hour} cx={left + hour * cell + cell / 2} cy={top + day * cell + cell / 2} r={count ? 2.5 + Math.sqrt(count / max) * (cell / 2 - 3) : 1.5} className={count ? 'an-punch' : 'an-punch-empty'}>
              <title>{`${WEEKDAYS[day]} ${hourName(hour)}: ${count}`}</title>
            </circle>
          ))}
        </g>
      ))}
      {HOURS.map(hour => <text key={hour} x={left + hour * cell + cell / 2} y={top + 7 * cell + 14} textAnchor="middle" className="an-axis">{hourName(hour)}</text>)}
    </svg>
  )
}

export type BarItem = { key: string; label: React.ReactNode; value: number; detail?: React.ReactNode; onClick?: () => void }

/** Horizontal bars, scaled to the largest value. */
export function BarList({ items, color = 'var(--an-notes)', format = formatNumber }: { items: BarItem[]; color?: string; format?: (value: number) => string }) {
  const max = Math.max(1, ...items.map(item => item.value))
  return (
    <ul className="an-bars">
      {items.map(item => {
        const content = (
          <>
            <span className="an-bar-label">{item.label}</span>
            <span className="an-bar-value">{item.detail}{format(item.value)}</span>
            <span className="an-bar-track"><i style={{ width: `${Math.max(2, item.value / max * 100)}%`, background: color }}/></span>
          </>
        )
        return <li key={item.key}>{item.onClick ? <button onClick={item.onClick}>{content}</button> : <div>{content}</div>}</li>
      })}
    </ul>
  )
}
