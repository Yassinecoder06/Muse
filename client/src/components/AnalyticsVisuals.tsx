import React, { useMemo, useState } from 'react';

export interface AnalyticsSummary {
  activitySeries: { label: string; notes: number; tasksCompleted: number }[];
  noteDistribution: { category: string; count: number; color: string }[];
  pipelineSteps: { id: string; label: string; status: 'done' | 'active' | 'pending' }[];
  localPrivateRatio: number;
}

export const DEFAULT_DATA: AnalyticsSummary = {
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
    { category: 'Archived Notes', count: 15, color: '#10b981' },
  ],
  pipelineSteps: [
    { id: 'scan', label: 'Local Document Indexing', status: 'done' },
    { id: 'embed', label: 'Qdrant Vector Indexing', status: 'done' },
    { id: 'graph', label: 'Knowledge Graph Linking', status: 'active' },
    { id: 'report', label: 'Modular Report Synthesis', status: 'pending' },
  ],
  localPrivateRatio: 100,
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
      {/* 1. Weekly Velocity Curve Chart */}
      <div className="analytics-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3>Weekly Velocity (Notes vs Tasks)</h3>
          <div style={{ display: 'flex', gap: '0.85rem', fontSize: '0.75rem', opacity: 0.8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} /> Notes
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} /> Tasks
            </span>
          </div>
        </div>
        <svg viewBox="0 0 460 150" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          <path d={notesCurve.areaPath} fill="rgba(99, 102, 241, 0.16)" />
          <path d={tasksCurve.areaPath} fill="rgba(16, 185, 129, 0.16)" />
          <path d={notesCurve.dPath} fill="none" stroke="#6366f1" strokeWidth="2.5" />
          <path d={tasksCurve.dPath} fill="none" stroke="#10b981" strokeWidth="2.5" />
          {notesCurve.pts.map((pt, i) => (
            <g key={pt.label} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} style={{ cursor: 'pointer' }}>
              <title>{`${pt.label}: ${data.activitySeries[i].notes} notes, ${data.activitySeries[i].tasksCompleted} tasks completed`}</title>
              {hoveredIndex === i && (
                <line x1={pt.x} y1={12} x2={pt.x} y2={126} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
              )}
              <circle cx={pt.x} cy={pt.y} r={hoveredIndex === i ? 5.5 : 3.5} fill="#6366f1" stroke="#ffffff" strokeWidth={hoveredIndex === i ? 1.5 : 0} />
              <circle cx={tasksCurve.pts[i].x} cy={tasksCurve.pts[i].y} r={hoveredIndex === i ? 5.5 : 3.5} fill="#10b981" stroke="#ffffff" strokeWidth={hoveredIndex === i ? 1.5 : 0} />
              <text x={pt.x} y={144} textAnchor="middle" fill="currentColor" fillOpacity={hoveredIndex === i ? 1 : 0.6} fontSize="10" fontWeight={hoveredIndex === i ? 700 : 400}>{pt.label}</text>
            </g>
          ))}
          {hoveredIndex !== null && (() => {
            const pt = notesCurve.pts[hoveredIndex];
            const item = data.activitySeries[hoveredIndex];
            const tooltipX = Math.min(Math.max(pt.x, 70), 390);
            return (
              <g transform={`translate(${tooltipX}, 26)`} style={{ pointerEvents: 'none' }}>
                <rect
                  x="-65"
                  y="-22"
                  width="130"
                  height="42"
                  rx="6"
                  fill="#1f1e26"
                  stroke="rgba(255, 255, 255, 0.2)"
                  strokeWidth="1"
                />
                <text x="0" y="-7" textAnchor="middle" fill="#c7d2fe" fontSize="10" fontWeight="600">
                  {item.label} · {item.notes} notes
                </text>
                <text x="0" y="9" textAnchor="middle" fill="#a7f3d0" fontSize="10" fontWeight="600">
                  {item.tasksCompleted} tasks done
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* 2. Knowledge Base Breakdown */}
      <div className="analytics-card">
        <h3 style={{ marginBottom: '1rem' }}>Knowledge Base Breakdown ({totalNotes})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {data.noteDistribution.map((item) => {
            const pct = Math.round((item.count / Math.max(totalNotes, 1)) * 100);
            return (
              <div key={item.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                  <span>{item.category}</span>
                  <span className="analytics-card-subtitle">{item.count} ({pct}%)</span>
                </div>
                <div className="analytics-progress-track">
                  <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: '999px', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. AI & Knowledge Engine Pipeline */}
      <div className="analytics-card">
        <h3 style={{ marginBottom: '1rem' }}>AI & Knowledge Engine Pipeline</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {data.pipelineSteps.map((step, idx) => (
            <div key={step.id} className="pipeline-item">
              <span>{idx + 1}. {step.label}</span>
              <span className={`pipeline-status pipeline-status-${step.status}`}>{step.status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
