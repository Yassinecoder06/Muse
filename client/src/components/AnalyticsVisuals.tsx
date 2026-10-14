import React, { useMemo, useState } from 'react';

export interface AnalyticsSummary {
  activitySeries: { label: string; notes: number; tasksCompleted: number }[];
  noteDistribution: { category: string; count: number; color: string }[];
  pipelineSteps: { id: string; label: string; status: 'done' | 'active' | 'pending' }[];
  vaultEncryptedRatio: number;
}

const DEFAULT_DATA: AnalyticsSummary = {
  activitySeries: [
    { label: 'Mon', notes: 4, tasksCompleted: 6 },
    { label: 'Tue', notes: 7, tasksCompleted: 5 },
    { label: 'Wed', notes: 5, tasksCompleted: 9 },
    { label: 'Thu', notes: 11, tasksCompleted: 8 },
    { label: 'Fri', notes: 8, tasksCompleted: 12 },
    { label: 'Sat', notes: 6, tasksCompleted: 4 },
    { label: 'Sun', notes: 9, tasksCompleted: 7 },
  ],
  noteDistribution: [
    { category: 'Standard Notes', count: 42, color: '#6366f1' },
    { category: 'AI Research', count: 28, color: '#8b5cf6' },
    { category: 'Specialized Notes', count: 19, color: '#ec4899' },
    { category: 'Secure Vault', count: 15, color: '#10b981' },
  ],
  pipelineSteps: [
    { id: 'scan', label: 'Document Scan & Extraction', status: 'done' },
    { id: 'embed', label: 'Qdrant Vector Indexing', status: 'done' },
    { id: 'graph', label: 'Knowledge Graph Linking', status: 'active' },
    { id: 'report', label: 'Modular Report Synthesis', status: 'pending' },
  ],
  vaultEncryptedRatio: 88,
};

export const AnalyticsVisuals: React.FC<{ data?: AnalyticsSummary }> = ({ data = DEFAULT_DATA }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxMetric = useMemo(
    () => Math.max(...data.activitySeries.flatMap((d) => [d.notes, d.tasksCompleted]), 10),
    [data.activitySeries]
  );

  const totalNotes = useMemo(
    () => data.noteDistribution.reduce((acc, item) => acc + item.count, 0),
    [data.noteDistribution]
  );

  const buildSmoothPath = (key: 'notes' | 'tasksCompleted', width = 460, height = 150) => {
    const pts = data.activitySeries.map((d, idx) => ({
      x: (idx / Math.max(data.activitySeries.length - 1, 1)) * (width - 40) + 20,
      y: height - 24 - (d[key] / maxMetric) * (height - 48),
      val: d[key],
      label: d.label,
    }));

    const dPath = pts.reduce((acc, pt, i, a) => {
      if (i === 0) return `M ${pt.x},${pt.y}`;
      const prev = a[i - 1];
      const cx = prev.x + (pt.x - prev.x) / 2;
      return `${acc} C ${cx},${prev.y} ${cx},${pt.y} ${pt.x},${pt.y}`;
    }, '');

    const areaPath = `${dPath} L ${pts[pts.length - 1].x},${height - 24} L ${pts[0].x},${height - 24} Z`;
    return { dPath, areaPath, pts };
  };

  const notesCurve = buildSmoothPath('notes');
  const tasksCurve = buildSmoothPath('tasksCompleted');

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', margin: '1.25rem 0' }}>
      <div style={{ background: 'rgba(17, 24, 39, 0.75)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.25rem', color: '#f9fafb' }}>
        <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 600 }}>Weekly Velocity (Notes vs Tasks)</h3>
        <svg viewBox="0 0 460 150" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          <path d={notesCurve.areaPath} fill="rgba(99, 102, 241, 0.2)" />
          <path d={tasksCurve.areaPath} fill="rgba(16, 185, 129, 0.18)" />
          <path d={notesCurve.dPath} fill="none" stroke="#6366f1" strokeWidth="2.5" />
          <path d={tasksCurve.dPath} fill="none" stroke="#10b981" strokeWidth="2.5" />
          {notesCurve.pts.map((pt, i) => (
            <g key={pt.label} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} style={{ cursor: 'pointer' }}>
              <circle cx={pt.x} cy={pt.y} r={hoveredIndex === i ? 5 : 3.5} fill="#6366f1" />
              <circle cx={tasksCurve.pts[i].x} cy={tasksCurve.pts[i].y} r={hoveredIndex === i ? 5 : 3.5} fill="#10b981" />
              <text x={pt.x} y={144} textAnchor="middle" fill="#9ca3af" fontSize="10">{pt.label}</text>
            </g>
          ))}
        </svg>
      </div>

      <div style={{ background: 'rgba(17, 24, 39, 0.75)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.25rem', color: '#f9fafb' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 600 }}>Knowledge Base Breakdown ({totalNotes})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {data.noteDistribution.map((item) => {
            const pct = Math.round((item.count / Math.max(totalNotes, 1)) * 100);
            return (
              <div key={item.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                  <span>{item.category}</span>
                  <span style={{ color: '#9ca3af' }}>{item.count} ({pct}%)</span>
                </div>
                <div style={{ width: '100%', height: '7px', background: 'rgba(255,255,255,0.07)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: '999px' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: 'rgba(17, 24, 39, 0.75)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.25rem', color: '#f9fafb' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 600 }}>AI & Vault Pipeline Schema ({data.vaultEncryptedRatio}% Encrypted)</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {data.pipelineSteps.map((step, idx) => (
            <div key={step.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: '0.82rem' }}>{idx + 1}. {step.label}</span>
              <span style={{ fontSize: '0.72rem', color: '#a5b4fc', textTransform: 'uppercase' }}>{step.status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
