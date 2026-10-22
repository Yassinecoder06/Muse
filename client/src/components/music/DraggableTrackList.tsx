import { useState } from 'react'
import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Trash2,
  Play,
  Volume2,
  Music2
} from 'lucide-react'

export interface TrackItem {
  filename: string
  title: string
  artist?: string
  url: string
  size?: number
}

interface DraggableTrackListProps {
  tracks: TrackItem[]
  onReorder: (newTracks: TrackItem[]) => void
  onRemove?: (index: number) => void
  onPlayTrack?: (track: TrackItem, index: number) => void
  currentPlayingIndex?: number
  emptyMessage?: string
  title?: string
  compact?: boolean
  showPlayButton?: boolean
}

export function DraggableTrackList({
  tracks,
  onReorder,
  onRemove,
  onPlayTrack,
  currentPlayingIndex,
  emptyMessage = 'No tracks added yet. Select songs from the library to build your playlist priority.',
  title,
  compact = false,
  showPlayButton = false
}: DraggableTrackListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    const updated = [...tracks]
    const [movedTrack] = updated.splice(draggedIndex, 1)
    updated.splice(dropIndex, 0, movedTrack)

    setDraggedIndex(null)
    setDragOverIndex(null)
    onReorder(updated)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const moveUp = (index: number) => {
    if (index <= 0) return
    const updated = [...tracks]
    const temp = updated[index]
    updated[index] = updated[index - 1]
    updated[index - 1] = temp
    onReorder(updated)
  }

  const moveDown = (index: number) => {
    if (index >= tracks.length - 1) return
    const updated = [...tracks]
    const temp = updated[index]
    updated[index] = updated[index + 1]
    updated[index + 1] = temp
    onReorder(updated)
  }

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return ''
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${Math.round(bytes / 1024)} KB`
  }

  if (tracks.length === 0) {
    return (
      <div className="draggable-tracks-empty">
        <Music2 size={32} className="draggable-empty-icon" />
        <p className="draggable-empty-text">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={`draggable-tracks-container ${compact ? 'compact' : ''}`}>
      {title && (
        <div className="draggable-tracks-header">
          <span className="draggable-header-title">{title}</span>
          <span className="draggable-header-count">{tracks.length} tracks</span>
        </div>
      )}

      <div className="draggable-tracks-list">
        {tracks.map((track, index) => {
          const isDragging = draggedIndex === index
          const isDragOver = dragOverIndex === index
          const isPlaying = currentPlayingIndex === index
          const isTopPriority = index === 0

          return (
            <div
              key={`${track.filename}-${index}`}
              className={`draggable-track-row ${isDragging ? 'dragging' : ''} ${
                isDragOver ? 'drag-over' : ''
              } ${isPlaying ? 'playing' : ''} ${isTopPriority ? 'top-priority' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, index)}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={e => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              {/* Drag handle */}
              <div
                className="drag-handle-grip"
                title="Click and drag up or down to set playback priority"
              >
                <GripVertical size={16} />
              </div>

              {/* Priority rank indicator */}
              <div
                className={`track-priority-badge ${isTopPriority ? 'priority-1' : ''}`}
                title={isTopPriority ? 'Top Priority (Plays 1st)' : `Priority #${index + 1}`}
              >
                <span className="priority-num">#{index + 1}</span>
              </div>

              {/* Track Title and Artist */}
              <div className="track-info-col">
                <div className="track-name-row">
                  <span className="track-title-text" title={track.title}>
                    {track.title || track.filename}
                  </span>
                  {isPlaying && (
                    <span className="playing-now-pill">
                      <Volume2 size={12} className="spin-slow" /> Playing
                    </span>
                  )}
                </div>
                <div className="track-meta-sub">
                  {track.artist && <span className="track-artist-text">{track.artist}</span>}
                  {track.size && track.size > 0 && (
                    <span className="track-size-text">{formatSize(track.size)}</span>
                  )}
                </div>
              </div>

              {/* Actions: Reorder up/down + Play + Remove */}
              <div className="track-priority-controls">
                <button
                  type="button"
                  className="priority-step-btn"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  title="Increase priority (play earlier)"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  className="priority-step-btn"
                  onClick={() => moveDown(index)}
                  disabled={index === tracks.length - 1}
                  title="Decrease priority (play later)"
                >
                  <ChevronDown size={15} />
                </button>

                {showPlayButton && onPlayTrack && (
                  <button
                    type="button"
                    className="priority-play-btn"
                    onClick={() => onPlayTrack(track, index)}
                    title="Play from this track"
                  >
                    <Play size={13} fill="currentColor" />
                  </button>
                )}

                {onRemove && (
                  <button
                    type="button"
                    className="priority-remove-btn"
                    onClick={() => onRemove(index)}
                    title="Remove from priority playlist"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
