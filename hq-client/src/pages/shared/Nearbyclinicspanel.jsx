import { useState, useEffect, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import { clinicsApi } from '../../services/api'

const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000')
  .replace(/\/api\/?$/, '')

const STATUS_META = {
  open:        { label: 'Open',        bg: '#DCFCE7', color: '#16A34A' },
  active:      { label: 'Open',        bg: '#DCFCE7', color: '#16A34A' },
  busy:        { label: 'Busy',        bg: '#FEF3C7', color: '#D97706' },
  maintenance: { label: 'Maintenance', bg: '#F3F4F6', color: '#6B7280' },
  inactive:    { label: 'Inactive',    bg: '#F3F4F6', color: '#6B7280' },
  closed:      { label: 'Closed',      bg: '#FEE2E2', color: '#DC2626' },
}

/**
 * NearbyClinicsPanel — real-time cross-clinic status for Facility Admin
 * referral decisions ("can I send this patient to another clinic nearby?").
 *
 * Data source: GET /api/clinics/network-status
 * (clinicController.getClinicNetworkStatus) — authenticated, and returns
 * each peer clinic already sorted by distance from the requesting clinic,
 * with atCapacity already computed server-side (queueLength vs
 * maxQueueCapacity). Aggregate fields only — no patient or individual
 * queue-entry data crosses clinics here, by design; that boundary is what
 * keeps this consistent with clinic data separation elsewhere in the system.
 *
 * Real-time: reuses the exact same 'global_queue_change' Socket.IO event
 * QueueOversightPage.jsx already listens to (emitted on every join/serve/
 * complete/cancel/no-show, across ALL clinics — see
 * queueController.emitQueueUpdate). On that event we just refetch; the
 * payload doesn't carry the new numbers itself, so a full refetch is the
 * simplest correct way to stay in sync without inventing a second event shape.
 */
export default function NearbyClinicsPanel() {
  const [peers, setPeers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  const loadNetworkStatus = useCallback(async () => {
    try {
      const res = await clinicsApi.networkStatus()
      setPeers(Array.isArray(res.data) ? res.data : [])
      setError('')
    } catch {
      setError('Unable to load nearby clinic status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNetworkStatus()
  }, [loadNetworkStatus])

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'] })

    const handleChange = () => {
      // Several queue events can fire in a burst (e.g. bulk check-ins) —
      // debounce so we don't hammer the endpoint on every one.
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(loadNetworkStatus, 400)
    }

    socket.on('global_queue_change', handleChange)
    return () => {
      socket.off('global_queue_change', handleChange)
      socket.disconnect()
      clearTimeout(debounceRef.current)
    }
  }, [loadNetworkStatus])

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Nearby Clinics</span>
        <button
          className="btn btn-outline"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={loadNetworkStatus}
          disabled={loading}
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
        Live queue status — for referring patients when you're at capacity
      </div>

      {error ? (
        <div style={{ fontSize: 12, color: 'var(--error, #DC2626)', padding: '20px 0', textAlign: 'center' }}>{error}</div>
      ) : peers.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', padding: '30px 0', textAlign: 'center' }}>
          {loading ? 'Loading…' : 'No other clinics found.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
          {peers.map((c) => {
            const meta = STATUS_META[c.status] || STATUS_META.open
            return (
              <div
                key={c._id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {c.distanceKm != null ? `${c.distanceKm} km away — ` : ''}
                    {c.queueLength ?? 0} waiting · ~{c.currentWaitingTime || c.baseWaitTimePerPerson || 0} min wait
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                      background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
                    }}
                  >
                    {meta.label}
                  </span>
                  {c.atCapacity && (
                    <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 600 }}>At capacity</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}