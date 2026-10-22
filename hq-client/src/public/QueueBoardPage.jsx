import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { publicApi } from '../services/api'
import styles from './queueBoard.module.css'

const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '')

const POLL_MS = 10000

// Short two-tone chime, generated in the browser (no audio file needed).
// Browsers only allow sound after a click, hence the "Enable sound" button.
function playChime(ctx) {
  if (!ctx) return
  const now = ctx.currentTime
  ;[880, 1175].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + i * 0.25)
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.25 + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.25)
    osc.stop(now + i * 0.25 + 0.45)
  })
}

/**
 * Public "Now Serving" display for a TV/monitor in the waiting room.
 * Route: /board/:clinicId  (no login). Shows ticket numbers only.
 */
export default function QueueBoardPage() {
  const { clinicId } = useParams()
  const [board, setBoard] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [offline, setOffline] = useState(false)
  const [now, setNow] = useState(new Date())
  const [soundOn, setSoundOn] = useState(false)

  const audioRef = useRef(null)
  const seenCalledRef = useRef(null) // Set of "called" tickets already announced

  const load = useCallback(async () => {
    try {
      const res = await publicApi.queueBoard(clinicId)
      const data = res.data
      setBoard(data)
      setOffline(false)

      // Chime when a ticket newly appears as "called" (not on the first load).
      const calledNow = new Set(data.nowServing.filter((t) => t.status === 'called').map((t) => t.ticket))
      if (seenCalledRef.current) {
        const isNew = [...calledNow].some((t) => !seenCalledRef.current.has(t))
        if (isNew) playChime(audioRef.current)
      }
      seenCalledRef.current = calledNow
    } catch (err) {
      if (err?.response?.status === 404) setNotFound(true)
      else setOffline(true) // keep showing the last good data
    }
  }, [clinicId])

  // Initial load + steady polling (safety net if the live socket drops).
  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  // Live refresh: the server broadcasts an anonymous `global_queue_change`
  // (clinic id only, no personal data) on every queue change.
  useEffect(() => {
    let debounce
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'] })
    socket.on('global_queue_change', (payload) => {
      if (payload?.clinicId && String(payload.clinicId) !== String(clinicId)) return
      clearTimeout(debounce)
      debounce = setTimeout(load, 300)
    })
    return () => {
      clearTimeout(debounce)
      socket.disconnect()
    }
  }, [clinicId, load])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.title = board?.clinic?.name ? `${board.clinic.name} — Now Serving` : 'Now Serving'
  }, [board?.clinic?.name])

  const enableSound = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!audioRef.current && Ctx) audioRef.current = new Ctx()
      audioRef.current?.resume?.()
      setSoundOn(true)
      playChime(audioRef.current) // confirms that sound works
    } catch (_) { /* sound is optional */ }
  }

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
    } catch (_) { /* optional */ }
  }

  if (notFound) return <div className={styles.fullpage}>This clinic could not be found. Check the display link.</div>
  if (!board) return <div className={styles.fullpage}>Loading…</div>

  const closed = board.clinic?.status === 'closed'

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}>HealthQueue+</div>
          <div className={styles.clinic}>{board.clinic?.name}</div>
        </div>
        <div>
          <div className={styles.clock}>
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className={styles.controls} style={{ justifyContent: 'flex-end', marginTop: 6 }}>
            {!soundOn && <button className={styles.btn} onClick={enableSound}>🔔 Enable sound</button>}
            <button className={styles.btn} onClick={toggleFullscreen}>Full screen</button>
          </div>
        </div>
      </header>

      {closed && <div className={`${styles.banner} ${styles.closed}`}>This clinic is currently closed.</div>}
      {offline && (
        <div className={styles.banner}>
          Connection lost — showing the last update. Trying to reconnect…
        </div>
      )}

      {(board.lines || []).length > 1 ? (
        // Several services are active: one column per service line. The same
        // ticket number can sit in more than one column (one ticket, many lines);
        // in a line where that patient is busy at another service it is greyed.
        <div className={styles.columns} style={{ gridTemplateColumns: `repeat(${Math.min(board.lines.length, 4)}, minmax(0, 1fr))` }}>
          {board.lines.map((line) => (
            <section key={line.service} className={styles.panel} aria-live="polite">
              <h2 className={styles.panelTitle}>{line.service}</h2>
              {line.nowServing.length > 0 && (
                <div className={styles.serving}>
                  {line.nowServing.map((t) => (
                    <div key={`${line.service}-${t.ticket}`} className={`${styles.tile} ${t.status === 'called' ? styles.tileCalled : ''}`}>
                      <div className={styles.ticket}>{t.ticket}</div>
                      <div className={`${styles.tag} ${t.status === 'serving' ? styles.tagServing : ''}`}>
                        {t.status === 'called' ? 'Please proceed' : 'In consultation'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {line.nextUp.length === 0 ? (
                <div className={styles.empty}>No one is waiting.</div>
              ) : (
                <ol className={styles.next}>
                  {line.nextUp.map((t) => (
                    <li key={`${line.service}-${t.ticket}`} className={`${styles.nextRow} ${t.held ? styles.held : ''}`}>
                      <span className={styles.nextTicket}>{t.ticket}</span>
                      <span className={styles.nextPos}>
                        {t.held ? `At ${t.heldAt}` : t.position === 1 ? 'You’re next' : `#${t.position}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      ) : (
      <div className={styles.grid}>
        <section className={styles.panel} aria-live="polite">
          <h2 className={styles.panelTitle}>Now serving</h2>
          {board.nowServing.length === 0 ? (
            <div className={styles.empty}>No ticket is being served right now.</div>
          ) : (
            <div className={styles.serving}>
              {board.nowServing.map((t) => (
                <div
                  key={t.ticket}
                  className={`${styles.tile} ${t.status === 'called' ? styles.tileCalled : ''}`}
                >
                  <div className={styles.ticket}>{t.ticket}</div>
                  <div className={`${styles.tag} ${t.status === 'serving' ? styles.tagServing : ''}`}>
                    {t.status === 'called' ? 'Please proceed to the counter' : 'In consultation'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Next in line</h2>
          {board.nextUp.length === 0 ? (
            <div className={styles.empty}>No one is waiting.</div>
          ) : (
            <ol className={styles.next}>
              {board.nextUp.map((t) => (
                <li key={t.ticket} className={styles.nextRow}>
                  <span className={styles.nextTicket}>{t.ticket}</span>
                  <span className={styles.nextPos}>{t.position === 1 ? 'You’re next' : `#${t.position}`}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      )}

      <footer className={styles.footer}>
        <span>{board.waitingCount} waiting</span>
        <span>Find your ticket number on your slip. Updated {new Date(board.updatedAt).toLocaleTimeString()}</span>
      </footer>
    </main>
  )
}
