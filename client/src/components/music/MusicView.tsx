import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Music2,
  DownloadCloud,
  BarChart2,
  ListMusic,
  HardDrive,
  Sparkles,
  Bot
} from 'lucide-react'
import { MusicLibrary } from './MusicLibrary'
import { MusicPlaylists } from './MusicPlaylists'
import { MusicTasks } from './MusicTasks'
import { MusicAnalytics } from './MusicAnalytics'
import { api } from '../../services/api'

type MusicTab = 'library' | 'playlists' | 'tasks' | 'analytics'

export function MusicView({
  onBack,
  onNavigate
}: {
  onBack: () => void
  onNavigate?: (path: string) => void
}) {
  const [activeTab, setActiveTab] = useState<MusicTab>('library')
  const [activeTasksCount, setActiveTasksCount] = useState<number>(0)
  const [refreshKey, setRefreshKey] = useState<number>(0)

  const checkActiveTasks = async () => {
    try {
      const res = await api.getMusicTasks()
      const running = (res.tasks || []).filter((t: any) =>
        ['queued', 'searching', 'downloading', 'converting'].includes(t.status)
      )
      setActiveTasksCount(running.length)
    } catch {}
  }

  useEffect(() => {
    checkActiveTasks()
    const interval = setInterval(checkActiveTasks, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="music-view-layout">
      {/* Top Header */}
      <header className="music-view-header">
        <div className="music-header-left">
          <button className="music-back-btn" onClick={onBack} title="Back to Dashboard">
            <ArrowLeft size={18} />
            <span>Dashboard</span>
          </button>
          <div className="music-header-title-block">
            <div className="music-header-icon-badge">
              <Music2 size={20} />
            </div>
            <div>
              <h2>Music Hub</h2>
              <p className="music-header-desc">
                Multi-song downloader, robot playback, and library analytics
              </p>
            </div>
          </div>
        </div>

        <div className="music-header-right">
          <button
            className="music-ask-bip-btn"
            onClick={() => onNavigate?.('/assistant')}
            title="Ask Bip to sing or download music"
          >
            <Bot size={15} />
            <span>Ask Bip in Chat</span>
          </button>
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="music-tabs-nav-bar">
        <button
          className={`music-tab-btn ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          <Music2 size={16} />
          <span>Library</span>
        </button>

        <button
          className={`music-tab-btn ${activeTab === 'playlists' ? 'active' : ''}`}
          onClick={() => setActiveTab('playlists')}
        >
          <ListMusic size={16} />
          <span>Playlists</span>
        </button>

        <button
          className={`music-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          <DownloadCloud size={16} />
          <span>Downloader & Tasks</span>
          {activeTasksCount > 0 && (
            <span className="tab-counter-badge">{activeTasksCount}</span>
          )}
        </button>

        <button
          className={`music-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <BarChart2 size={16} />
          <span>Analytics</span>
        </button>
      </div>

      {/* Main Tab Content */}
      <main className="music-tab-body">
        {activeTab === 'library' && (
          <MusicLibrary
            key={`lib-${refreshKey}`}
            onRefreshTasks={() => setRefreshKey(k => k + 1)}
          />
        )}
        {activeTab === 'playlists' && (
          <MusicPlaylists key={`pl-${refreshKey}`} />
        )}
        {activeTab === 'tasks' && (
          <MusicTasks
            onTaskCompleted={() => setRefreshKey(k => k + 1)}
          />
        )}
        {activeTab === 'analytics' && <MusicAnalytics key={`analytics-${refreshKey}`} />}
      </main>
    </div>
  )
}
