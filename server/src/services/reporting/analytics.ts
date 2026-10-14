export type NumericValue = { label: string; value: number; unit?: string }
export type Kpi = { label: string; value: number; unit?: string }
export type ChartSpec =
  | { kind: 'bar' | 'line' | 'donut' | 'table'; title: string; values: NumericValue[] }
  | { kind: 'data-gap'; message: string }

export function total(values: NumericValue[]) { return values.reduce((sum, item) => sum + item.value, 0) }
export function average(values: NumericValue[]) { return values.length ? total(values) / values.length : null }
export function percentChange(previous: number, current: number) { return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100 }

// Deterministic tools accept only finite numeric values. AI can select a tool
// but cannot inject renderer markup or fabricate a chart data point.
export function chart(kind: 'bar' | 'line' | 'donut' | 'table', title: string, values: NumericValue[]): ChartSpec {
  const clean = values.filter(item => item.label.trim() && Number.isFinite(item.value)).slice(0, 12)
  if (clean.length < (kind === 'donut' ? 1 : 2)) return { kind: 'data-gap', message: 'Not enough reliable numeric data to render this visual.' }
  return { kind, title: title.slice(0, 120), values: clean.map(item => ({ label: item.label.slice(0, 100), value: item.value, unit: item.unit })) }
}
