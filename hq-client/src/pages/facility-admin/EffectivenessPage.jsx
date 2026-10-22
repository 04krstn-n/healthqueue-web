import { useState, useEffect, useCallback } from 'react'
import { analyticsApi } from '../../services/api'

const fmt = (n) => (n === null || n === undefined ? '—' : n)

/**
 * Before-vs-after waiting time. "Before" = observations the clinic timed by
 * hand (paste one per line); "After" = real completed HealthQueue+ entries.
 * Shows the number of observations so the manuscript never overclaims.
 */
export default function EffectivenessPage() {
  const [range, setRange] = useState({ beforeFrom: '', beforeTo: '', afterFrom: '', afterTo: '' })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(range).filter(([, v]) => v))
      const res = await analyticsApi.effectiveness(params)
      setData(res.data?.data || null)
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load results.')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  // Each line: date, wait minutes, service minutes (optional)  e.g. 2026-09-01, 45, 12
  const saveBaseline = async () => {
    setMsg('')
    const observations = []
    for (const [i, raw] of text.split('\n').entries()) {
      const line = raw.trim()
      if (!line) continue
      const [d, w, s] = line.split(',').map((x) => x.trim())
      if (!d || Number.isNaN(new Date(d).getTime()) || w === undefined || !(Number(w) >= 0)) {
        setMsg(`Line ${i + 1} is not valid. Use: date, wait minutes, service minutes (optional).`)
        return
      }
      observations.push({ observedAt: d, waitMinutes: Number(w), ...(s ? { serviceMinutes: Number(s) } : {}) })
    }
    if (observations.length === 0) { setMsg('Enter at least one line.'); return }
    setSaving(true)
    try {
      await analyticsApi.addBaseline({ observations })
      setText('')
      setMsg(`${observations.length} observation(s) saved.`)
      await load()
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const b = data?.before?.waitMinutes
  const a = data?.after?.waitMinutes
  const ch = data?.change

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 980 }}>
      <div>
        <h2 style={{ margin: 0 }}>Before vs After HealthQueue+</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
          Compares patient waiting time timed by hand before the system with real completed queue entries recorded by HealthQueue+.
        </p>
      </div>

      {error && <div style={{ color: '#DC2626', fontSize: 13 }}>{error}</div>}

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Results</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginBottom: 12 }}>
          {[['beforeFrom', 'Before from'], ['beforeTo', 'Before to'], ['afterFrom', 'After from'], ['afterTo', 'After to']].map(([k, l]) => (
            <label key={k} style={{ display: 'grid', gap: 2 }}>
              {l}
              <input type="date" className="form-input" value={range[k]} onChange={(e) => setRange((r) => ({ ...r, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        {loading ? <div>Loading…</div> : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th></th><th>Observations (n)</th><th>Average wait (min)</th><th>Median wait (min)</th><th>Longest (min)</th></tr></thead>
            <tbody>
              <tr><td>Before (timed by hand)</td><td>{fmt(b?.n)}</td><td>{fmt(b?.mean)}</td><td>{fmt(b?.median)}</td><td>{fmt(b?.max)}</td></tr>
              <tr><td>After (HealthQueue+)</td><td>{fmt(a?.n)}</td><td>{fmt(a?.mean)}</td><td>{fmt(a?.median)}</td><td>{fmt(a?.max)}</td></tr>
              <tr><td>— joined remotely</td><td>{fmt(data?.after?.remoteJoiners?.n)}</td><td>{fmt(data?.after?.remoteJoiners?.mean)}</td><td>{fmt(data?.after?.remoteJoiners?.median)}</td><td>{fmt(data?.after?.remoteJoiners?.max)}</td></tr>
              <tr><td>— walk-ins</td><td>{fmt(data?.after?.walkIns?.n)}</td><td>{fmt(data?.after?.walkIns?.mean)}</td><td>{fmt(data?.after?.walkIns?.median)}</td><td>{fmt(data?.after?.walkIns?.max)}</td></tr>
            </tbody>
          </table>
        )}
        {ch && (
          <p style={{ fontWeight: 700, marginTop: 12 }}>
            Average wait changed by {ch.meanWaitDifferenceMinutes} min ({ch.percent}%): {ch.direction}.
          </p>
        )}
        {(data?.warnings || []).map((w) => (
          <div key={w} style={{ fontSize: 12, color: '#B45309', marginTop: 4 }}>• {w}</div>
        ))}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Add "before" observations</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>
          One visit per line: <code>date, wait minutes, service minutes (optional)</code>. Example: <code>2026-09-01, 45, 12</code>
        </p>
        <textarea className="form-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'2026-09-01, 45, 12\n2026-09-01, 38'} />
        <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={saveBaseline} disabled={saving}>{saving ? 'Saving…' : 'Save observations'}</button>
          {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}
