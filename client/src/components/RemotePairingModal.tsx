import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Laptop, Loader2, Phone, RefreshCw, Smartphone, Trash2, Wifi, X } from 'lucide-react'
import { api, type NetworkInfo, type PairingSession, type RemoteDevice } from '../services/api'
import { robotAudio } from '../services/robot-audio.service'

interface RemotePairingModalProps {
  isOpen: boolean
  onClose: () => void
}

export function RemotePairingModal({ isOpen, onClose }: RemotePairingModalProps) {
  const [session, setSession] = useState<PairingSession | null>(null)
  const [network, setNetwork] = useState<NetworkInfo | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pairedDevice, setPairedDevice] = useState<{ name: string; model?: string } | null>(null)
  const [copiedPin, setCopiedPin] = useState(false)
  const [devices, setDevices] = useState<RemoteDevice[]>([])

  useEffect(() => {
    if (!isOpen) {
      setSession(null)
      setPairedDevice(null)
      return
    }

    let isMounted = true
    setLoading(true)

    // Load network info and initial pairing token
    api.getNetworkInfo()
      .then(net => {
        if (!isMounted) return
        setNetwork(net)
        const initialUrl = net.localUrl || `http://${net.localIp}:8080`
        setCustomUrl(initialUrl)
        return api.createPairingSession(initialUrl)
      })
      .then(sess => {
        if (!isMounted || !sess) return
        setSession(sess)
      })
      .catch(err => {
        console.error('Failed to init pairing session:', err)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    // Load registered devices
    void loadDevices()

    return () => {
      isMounted = false
    }
  }, [isOpen])

  // Poll pairing status while waiting for scan
  useEffect(() => {
    if (!session?.token || pairedDevice) return
    const interval = setInterval(async () => {
      try {
        const res = await api.checkPairingStatus(session.token)
        if (res.claimed && res.device) {
          setPairedDevice(res.device)
          robotAudio.play('success')
          void loadDevices()
        }
      } catch {}
    }, 2000)

    return () => clearInterval(interval)
  }, [session?.token, pairedDevice])

  async function loadDevices() {
    try {
      const list = await api.listRemoteDevices()
      setDevices(list)
    } catch {}
  }

  async function refreshPairing(targetUrl?: string) {
    setLoading(true)
    setPairedDevice(null)
    try {
      const sess = await api.createPairingSession(targetUrl || customUrl)
      setSession(sess)
      robotAudio.play('blip')
    } catch (err) {
      console.error('Failed to refresh pairing code:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.revokeRemoteDevice(id)
      setDevices(prev => prev.filter(d => d.id !== id))
      robotAudio.play('chirp')
    } catch (err) {
      console.error('Failed to revoke device:', err)
    }
  }

  const copyPin = () => {
    if (!session?.pinCode) return
    navigator.clipboard.writeText(session.pinCode)
    setCopiedPin(true)
    setTimeout(() => setCopiedPin(false), 2000)
    robotAudio.play('blip')
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="remote-modal-card" onClick={e => e.stopPropagation()}>
        <header className="remote-modal-header">
          <div className="remote-modal-title">
            <Smartphone size={22} className="remote-modal-icon" />
            <div>
              <h3>Link Phone (Remote Companion)</h3>
              <p>Control Muse and talk with Bip from your smartphone on the same network.</p>
            </div>
          </div>
          <button className="remote-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="remote-modal-body">
          {/* Network Banner */}
          <div className="remote-network-bar">
            <span className="remote-network-indicator">
              <Wifi size={15} />
              <span>Network: <strong>Local Wi-Fi</strong> ({network?.localIp || '192.168.100.136'})</span>
            </span>
            <div className="remote-url-controls">
              {isEditingUrl ? (
                <div className="remote-url-edit">
                  <input
                    type="text"
                    value={customUrl}
                    onChange={e => setCustomUrl(e.target.value)}
                    placeholder="http://192.168.x.x:8080"
                  />
                  <button
                    onClick={() => {
                      setIsEditingUrl(false)
                      void refreshPairing(customUrl)
                    }}
                  >
                    Apply
                  </button>
                </div>
              ) : (
                <button className="remote-url-toggle" onClick={() => setIsEditingUrl(true)}>
                  URL: <code>{customUrl || 'Detecting...'}</code> (Edit)
                </button>
              )}
            </div>
          </div>

          {/* Main Pairing Stage */}
          <div className="remote-pairing-stage">
            {loading ? (
              <div className="remote-loading-box">
                <Loader2 size={32} className="animate-spin" />
                <p>Generating pairing ceremony...</p>
              </div>
            ) : pairedDevice ? (
              <div className="remote-success-box">
                <div className="remote-success-circle">
                  <Check size={36} />
                </div>
                <h4>Device Connected!</h4>
                <p>
                  <strong>{pairedDevice.name}</strong> ({pairedDevice.model || 'Phone'}) is now linked to your Muse workspace.
                </p>
                <button className="remote-action-btn" onClick={() => void refreshPairing()}>
                  Pair Another Device
                </button>
              </div>
            ) : (
              <div className="remote-qr-box">
                <div className="remote-qr-frame">
                  {session?.qrData ? (
                    <QRCodeSVG
                      value={session.qrData}
                      size={210}
                      level="M"
                      includeMargin
                      fgColor="#1e1b2e"
                    />
                  ) : (
                    <div className="remote-qr-placeholder" />
                  )}
                </div>

                <div className="remote-pin-strip">
                  <span className="remote-pin-label">Or enter 6-digit PIN manually:</span>
                  <div className="remote-pin-value-wrap" onClick={copyPin} title="Click to copy PIN">
                    <span className="remote-pin-value">{session?.pinCode || '------'}</span>
                    <button type="button" className="remote-pin-copy">
                      {copiedPin ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                <div className="remote-qr-status">
                  <span className="remote-pulse-dot" />
                  <span>Waiting for phone scan... (expires in 5m)</span>
                  <button className="remote-refresh-btn" onClick={() => void refreshPairing()} title="Refresh code">
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Linked Devices Section */}
          <div className="remote-devices-section">
            <div className="remote-devices-header">
              <h4>Linked Mobile Devices ({devices.length})</h4>
              <button className="remote-devices-refresh" onClick={() => void loadDevices()}>
                <RefreshCw size={12} />
              </button>
            </div>

            {devices.length === 0 ? (
              <p className="remote-devices-empty">No phones currently linked. Scan the QR code above with your mobile app to link one.</p>
            ) : (
              <ul className="remote-devices-list">
                {devices.map(dev => (
                  <li key={dev.id} className="remote-device-item">
                    <div className="remote-device-info">
                      <Smartphone size={16} />
                      <div>
                        <strong>{dev.device_name}</strong>
                        <small>{dev.device_model || dev.platform} · active {new Date(dev.last_seen_at).toLocaleTimeString()}</small>
                      </div>
                    </div>
                    <button
                      className="remote-revoke-btn"
                      onClick={() => void handleRevoke(dev.id)}
                      title="Unlink and revoke access"
                    >
                      <Trash2 size={14} />
                      <span>Revoke</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
