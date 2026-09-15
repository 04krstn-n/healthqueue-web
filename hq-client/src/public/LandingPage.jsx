import { useState } from 'react'
import TermsAndAgreements from '../components/legal/TermsAndAgreements'
import PrivacyPolicy from '../components/legal/PrivacyPolicy'
import '../components/legal/policy.css'
import logo from '../../src/assets/img/hq_logo.png'
import background from '../../src/assets/img/landing_background.png'
import stepJoinRemotely from '../../src/assets/img/join_remotely.jpg'
import stepSeeWait from '../../src/assets/img/see_wait.jpg'
import stepGetNotified from '../../src/assets/img/notified.jpg'
import stepWalkIn from '../../src/assets/img/walkin.jpg'
import qrCode from '../../src/assets/img/mobile_phone_qr.png'
import './landingpage.css'


const CORE_FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: 'Smart Remote Queueing',
    desc: 'Join the line from home with a flexible 5-minute arrival window. Skip the crowded waiting room entirely.',
    color: '#1a6fa8', bg: '#eaf6ff',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" />
        <path d="M12 8v4l3 3" /><path d="M16.24 7.76l-2.12 2.12" />
      </svg>
    ),
    title: 'Predictive AI Routing',
    desc: 'Directs patients to the nearest or fastest branch using live congestion data, cutting delays across your network.',
    color: '#174e7d', bg: '#e4f1fb',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Instant AI Assistant',
    desc: 'Get immediate answers and queue sign-ups anytime via our 24/7 interactive RASA-powered chat assistant.',
    color: '#2ea02e', bg: '#edfaed',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M9 7h6M9 11h4" />
      </svg>
    ),
    title: 'Secure SMS Sign-In',
    desc: 'Hassle-free account verification with one-time passcodes via Semaphore — fully compliant with RA 10173.',
    color: '#1a6fa8', bg: '#eaf6ff',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 16l2 2 4-4" />
      </svg>
    ),
    title: 'Seamless Appointment Booking',
    desc: 'Schedule visits with automated SMS reminders — keeps your day and the clinic schedule running on time.',
    color: '#2ea02e', bg: '#edfaed',
  },
]

const NAV_LINKS = [
  { label: 'About', href: '#about' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
]

export default function LandingPage() {
  const [qrOpen, setQrOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [policyModal, setPolicyModal] = useState(null) // null | 'privacy' | 'terms'

  return (
    <div className="hq-landing min-h-screen bg-white">

      {/* ─────────────────── NAV ─────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5">
            <img src={logo} alt="HealthQueue+ logo" className="h-9 w-9 object-contain" />
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: '#174e7d', fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
              HealthQueue<span style={{ color: '#45c245' }}>+</span>
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(l => (
              <a key={l.label} href={l.href} className="text-sm font-medium text-gray-500 hover:text-[#1a6fa8] transition-colors">{l.label}</a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => setQrOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #1a6fa8, #174e7d)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M12 15V3m0 12l-4-4m4 4l4-4" /><rect x="2" y="17" width="20" height="4" rx="1" />
              </svg>
              Download App
            </button>
          </div>

          <button
            className="md:hidden text-gray-600"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              {menuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-5 py-4 flex flex-col gap-3">
            {NAV_LINKS.map(l => (
              <a
                key={l.label}
                href={l.href}
                className="text-sm font-medium text-gray-600"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <button
              onClick={() => { setQrOpen(true); setMenuOpen(false) }}
              className="text-sm font-semibold px-4 py-2.5 rounded-lg text-white"
              style={{ background: 'linear-gradient(135deg, #1a6fa8, #174e7d)' }}
            >
              Download App
            </button>
          </div>
        )}
      </header>

      {/* ─────────────────── 1. HERO ─────────────────── */}
      <section className="relative overflow-hidden" style={{ minHeight: '94vh' }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${background})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center 30%',
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(120deg, rgba(10,26,55,0.92) 0%, rgba(23,78,125,0.85) 40%, rgba(26,111,168,0.65) 70%, rgba(69,194,69,0.30) 100%)',
          }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-5 flex items-center" style={{ minHeight: '94vh' }}>
          <div className="max-w-2xl pt-20 pb-24">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6"
              style={{
                background: 'rgba(255,255,255,0.14)',
                color: '#d4f5d4',
                border: '1px solid rgba(255,255,255,0.22)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#7eed7e] animate-pulse" />
              AI-Powered Healthcare Queue System
            </div>

            <h1
              className="text-4xl sm:text-5xl lg:text-6xl leading-tight mb-5 text-white"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 800,
                letterSpacing: '-0.03em',
                textShadow: '0 2px 24px rgba(0,0,0,0.4)',
              }}
            >
              Smarter Queues.<br />
              <span style={{ color: '#a8f5a8' }}>Healthier</span> Communities.
            </h1>

            <p
              className="text-base md:text-lg leading-relaxed mb-9"
              style={{ color: 'rgba(255,255,255,0.80)', maxWidth: '520px' }}
            >
              HealthQueue+ eliminates crowded waiting rooms with AI-powered queue forecasting and real-time patient flow management — connecting patients, staff, and administrators seamlessly.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <button
                onClick={() => setQrOpen(true)}
                className="flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-base font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{
                  background: 'linear-gradient(135deg, #45c245, #2ea02e)',
                  boxShadow: '0 6px 24px rgba(69,194,69,0.38)',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-5 h-5">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="2" height="2" />
                  <rect x="18" y="14" width="3" height="3" />
                  <rect x="14" y="19" width="7" height="2" />
                </svg>
                Download via QR
              </button>

              <a
                href="#about"
                className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold hover:bg-white/10 transition-all"
                style={{
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.28)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                Learn More
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                { value: '–62%', label: 'Wait Reduction', color: '#7eed7e' },
                { value: '12,480+', label: 'Patients Served', color: '#a8d8ff' },
                { value: '94.3%', label: 'AI Accuracy', color: '#ffd77a' },
                { value: '6 Sites', label: 'Branch Centers', color: '#c8f0ff' },
              ].map(s => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl"
                  style={{
                    background: 'rgba(255,255,255,0.11)',
                    border: '1px solid rgba(255,255,255,0.17)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <span
                    className="text-base font-black"
                    style={{ fontFamily: "'Outfit', sans-serif", color: s.color }}
                  >
                    {s.value}
                  </span>
                  <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.62)' }}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="absolute -bottom-px left-0 right-0 pointer-events-none">
          <svg viewBox="0 0 1440 70" preserveAspectRatio="none" className="w-full h-14 md:h-20 block" fill="white">
            <path d="M0,70 C480,0 960,70 1440,30 L1440,70 Z" />
          </svg>
        </div>
      </section>

      {/* ─────────────────── 2. ABOUT ─────────────────── */}
      <section id="about" className="py-20 px-5 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#1a6fa8' }}>
                About HealthQueue+
              </p>
              <h2
                className="text-3xl lg:text-4xl leading-snug mb-5"
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 700,
                  color: '#0c2d4e',
                  letterSpacing: '-0.02em',
                }}
              >
                A Modern Ecosystem for Effortless Healthcare
              </h2>
              <p className="text-base leading-relaxed mb-4" style={{ color: '#2d5a82' }}>
                HealthQueue+ is an intelligent queue management platform built to eliminate crowded waiting rooms and streamline outpatient care. By connecting patients, clinic staff, and administrators through real-time AI insights, it transforms long, unpredictable clinic visits into a smooth, data-driven experience.
              </p>
              <p className="text-base leading-relaxed mb-6" style={{ color: '#2d5a82' }}>
                Operating across a <strong style={{ color: '#174e7d' }}>patient mobile app</strong>, a <strong style={{ color: '#174e7d' }}>staff tablet app</strong>, and an <strong style={{ color: '#174e7d' }}>admin web platform</strong> — all powered by an AI forecasting engine — HealthQueue+ replaces reactive waiting rooms with proactive, data-driven patient flow.
              </p>
              <div className="flex flex-wrap gap-3">
                {[
                  { icon: '🛡️', text: 'ISO/IEC 25010 Certified' },
                  { icon: '🔒', text: 'RA 10173 Compliant' },
                  { icon: '🤖', text: 'AI-Powered Forecasting' },
                ].map(b => (
                  <span
                    key={b.text}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{ background: '#eaf6ff', color: '#174e7d', border: '1px solid #b8d8f0' }}
                  >
                    {b.icon} {b.text}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {[
                { title: '3 Platforms', sub: 'Patient · Staff · Admin', color: '#1a6fa8', bg: '#eaf6ff' },
                { title: '5-Min Grace', sub: 'Remote arrival window', color: '#2ea02e', bg: '#edfaed' },
                { title: 'RASA Chatbot', sub: '24/7 AI assistant', color: '#174e7d', bg: '#e4f1fb' },
                { title: 'Live Routing', sub: 'Nearest & fastest branch', color: '#2ea02e', bg: '#edfaed' },
              ].map(t => (
                <div
                  key={t.title}
                  className="rounded-2xl p-5"
                  style={{ background: t.bg, border: `1px solid ${t.color}22` }}
                >
                  <p className="text-2xl font-black mb-1" style={{ fontFamily: "'Outfit', sans-serif", color: t.color }}>
                    {t.title}
                  </p>
                  <p className="text-xs font-medium" style={{ color: '#3d6e96' }}>{t.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────── HOW IT WORKS ─────────────────── */}
      <section
        id="how-it-works"
        className="py-20 px-5"
        style={{ background: 'linear-gradient(180deg, #deeeff 0%, #c8e3f7 100%)' }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#1a6fa8' }}>
              How It Works
            </p>
            <h2
              className="text-3xl lg:text-4xl"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 700,
                color: '#0c2d4e',
                letterSpacing: '-0.02em',
              }}
            >
              From Anywhere to Walk-In, in Four Moves
            </h2>
            <p className="text-base mt-3 max-w-xl mx-auto" style={{ color: '#2d5a82' }}>
              No app tutorial needed — join a queue in seconds and let HealthQueue+ handle the waiting.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: 'Join Remotely',
                desc: 'Open the app and get in line from home — no need to be there yet.',
                img: stepJoinRemotely ,
                alt: 'Person using a phone at home',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                    <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 18h6" />
                  </svg>
                ),
                color: '#1a6fa8',
              },
              {
                title: 'See Your Wait',
                desc: 'AI forecasting gives you a live, honest estimate — not a guess.',
                img: stepSeeWait ,
                alt: 'Dashboard showing live data on a screen',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                ),
                color: '#174e7d',
              },
              {
                title: 'Get Notified',
                desc: "We'll ping you as your turn approaches, so you can time your arrival.",
                img: stepGetNotified,
                alt: 'Phone showing a notification alert',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                ),
                color: '#2ea02e',
              },
              {
                title: 'Walk Straight In',
                desc: 'Arrive within your 5-minute grace period — skip the line entirely.',
                img: stepWalkIn,
                alt: 'Patient walking into a clinic',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                ),
                color: '#45c245',
              },
            ].map(step => (
              <div
                key={step.title}
                className="rounded-2xl overflow-hidden bg-white hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 group"
                style={{ border: '1px solid #b8d8f0' }}
              >
                <div className="relative h-40 overflow-hidden" style={{ background: '#c8e3f7' }}>
                  <img
                    src={step.img}
                    alt={step.alt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to top, rgba(23,78,125,0.45) 0%, transparent 60%)' }}
                  />
                  <div
                    className="absolute bottom-3 left-3 w-9 h-9 rounded-xl flex items-center justify-center bg-white"
                    style={{ color: step.color }}
                  >
                    {step.icon}
                  </div>
                </div>
                <div className="p-4">
                  <h3
                    className="text-base font-semibold mb-1.5"
                    style={{ fontFamily: "'Outfit', sans-serif", color: '#0c2d4e' }}
                  >
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: '#3d6e96' }}>
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────── 4. AUDIENCE ROLES ─────────────────── */}
      <section
        id="audience"
        className="py-20 px-5"
        style={{ background: 'linear-gradient(180deg, #e4f1fb 0%, #cfe5f7 100%)' }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#1a6fa8' }}>
              Built for Everyone
            </p>
            <h2
              className="text-3xl lg:text-4xl"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 700,
                color: '#0c2d4e',
                letterSpacing: '-0.02em',
              }}
            >
              Built for the Entire Healthcare Journey
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                role: 'For Patients',
                tagline: 'Skip the waiting room.',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                ),
                color: '#1a6fa8', bg: '#eaf6ff',
                header: 'linear-gradient(135deg, #1a6fa8, #2589c7)',
                points: [
                  'Queue remotely — join from home',
                  'Track live wait times in real time',
                  'Book appointments from your phone',
                  'Chat with an AI assistant 24/7',
                ],
              },
              {
                role: 'For Clinic Staff',
                tagline: 'Eliminate desk friction.',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                ),
                color: '#2ea02e', bg: '#edfaed',
                header: 'linear-gradient(135deg, #2ea02e, #45c245)',
                points: [
                  'Manage patient flow with a single tap',
                  'Call queues and update statuses instantly',
                  'Simple tablet interface, zero learning curve',
                  'Real-time coordination across the clinic',
                ],
              },
              {
                role: 'For Administrators',
                tagline: 'Take control of operations.',
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                ),
                color: '#174e7d', bg: '#e4f1fb',
                header: 'linear-gradient(135deg, #174e7d, #1a6fa8)',
                points: [
                  'Multi-branch analytics in one dashboard',
                  'Monitor peak traffic hours per clinic',
                  'Optimize staffing with live data',
                  'Full operational control via web platform',
                ],
              },
            ].map(col => (
              <div
                key={col.role}
                className="rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-lg transition-shadow"
                style={{ border: '1px solid #b8d8f0' }}
              >
                <div className="px-6 py-5" style={{ background: col.header }}>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
                      {col.icon}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white/70 uppercase tracking-widest">{col.role}</p>
                      <p className="text-base font-bold text-white" style={{ fontFamily: "'Outfit', sans-serif" }}>
                        {col.tagline}
                      </p>
                    </div>
                  </div>
                </div>
                <ul className="px-6 py-5 space-y-3">
                  {col.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center"
                        style={{ background: col.bg, color: col.color }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                      <span className="text-sm leading-snug" style={{ color: '#2d5a82' }}>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────── 5. CORE FEATURES ─────────────────── */}
      <section id="features" className="py-20 px-5 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#1a6fa8' }}>
              Core Features
            </p>
            <h2
              className="text-3xl lg:text-4xl"
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 700,
                color: '#0c2d4e',
                letterSpacing: '-0.02em',
              }}
            >
              Everything Your Clinics Need
            </h2>
            <p className="text-base mt-3 max-w-xl mx-auto" style={{ color: '#2d5a82' }}>
              Five intelligent capabilities that replace the traditional waiting room with a seamless, data-driven patient experience.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {CORE_FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`rounded-2xl p-6 hover:-translate-y-1 hover:shadow-lg transition-all duration-200 ${i === 4 ? 'sm:col-span-2 lg:col-span-1' : ''}`}
                style={{ border: '1px solid #d4e8f7', background: '#fafcff' }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: f.bg, color: f.color }}
                >
                  {f.icon}
                </div>
                <h3
                  className="text-base font-semibold mb-2"
                  style={{ fontFamily: "'Outfit', sans-serif", color: '#0c2d4e' }}
                >
                  {f.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#3d6e96' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────── 6. FOOTER ─────────────────── */}
      <footer style={{ background: '#0c2d4e' }}>
        <div className="max-w-6xl mx-auto px-5 py-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <img src={logo} alt="HealthQueue+ logo" className="h-10 w-10 object-contain" />
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'white', fontSize: '1.05rem' }}>
                HealthQueue<span style={{ color: '#45c245' }}>+</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              AI-driven queue management for public health centers across Metro Manila.
            </p>
            <div className="space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <div className="flex items-start gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 mt-0.5 shrink-0">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
                551 M.F. Jhocson St., Sampaloc, Manila
              </div>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 3.1 4.18 2 2 0 0 1 5.08 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 23 17z" />
                </svg>
                (+63) 8888-HQUEUE
              </div>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                healthqueueorg@gmail.com
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4 tracking-wide">Quick Links</h4>
            <ul className="footer-links space-y-2.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {[['About HealthQueue+', '#about'], ['How It Works', '#how-it-works'], ['Core Features', '#features'], ['Download the App', '#']].map(([label, href]) => (
                <li key={label}>
                  <a href={href} className="hover:text-white transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4 tracking-wide">Platforms</h4>
            <ul className="footer-links space-y-2.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {['Patient Mobile App', 'Staff Tablet App', 'Admin Web Platform'].map(label => (
                <li key={label}>
                  <a href="#audience" className="hover:text-white transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4 tracking-wide">Compliance</h4>
            <div>
              {[
                { label: 'ISO/IEC 25010', sub: 'Software Quality Standard' },
                { label: 'RA 10173', sub: 'Data Privacy Act of 2012' },
              ].map((b, i) => (
                <div
                  key={b.label}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    marginTop: i === 0 ? 0 : '10px',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="#45c245" strokeWidth="2" className="w-4 h-4 shrink-0">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
                  </svg>
                  <div>
                    <p className="text-xs font-bold text-white">{b.label}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{b.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              © 2026 HealthQueue+. All rights reserved.
            </p>
            <div className="flex items-center gap-5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <button
                onClick={() => setPolicyModal('privacy')}
                className="hover:text-white/70 transition-colors"
                style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', }} >
                Privacy Policy
              </button>
              <button
                onClick={() => setPolicyModal('terms')}
                className="hover:text-white/70 transition-colors"
                style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', }} >
                Terms of Use
              </button>
              <a href="#" className="hover:text-white/70 transition-colors">Sitemap</a>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: 'Facebook', d: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z' },
                { label: 'Instagram', d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01M7.5 2h9a5.5 5.5 0 0 1 5.5 5.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2z' },
                { label: 'YouTube', d: 'M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.95C5.12 20 12 20 12 20s6.88 0 8.59-.47a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58zM9.75 15.02l5.75-3.02-5.75-3.02v6.04z' },
              ].map(({ label, d }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-all"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                    <path d={d} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {qrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(12,45,78,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setQrOpen(false)}
        >
          <div
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <img src={logo} alt="HealthQueue+ logo" className="w-14 h-14 object-contain mx-auto mb-3" />
              <h3
                className="text-xl font-bold mb-1"
                style={{ fontFamily: "'Outfit', sans-serif", color: '#174e7d' }}
              >
                Download HealthQueue<span style={{ color: '#45c245' }}>+</span>
              </h3>
              <p className="text-sm mb-6" style={{ color: '#3d6e96' }}>
                Scan with your phone camera to download the APK
              </p>
              <div className="flex justify-center mb-4 p-4 rounded-2xl" style={{ background: '#f0f7ff' }}>
                <img src={qrCode} alt="QR code to download HealthQueue+ APK" className="w-48 h-48 object-contain" />
              </div>
              <p className="text-xs mb-6" style={{ color: '#6b8cac' }}>
                Currently available for Android (APK)
              </p>
            </div>

            <div className="text-left border-t pt-5 mb-6" style={{ borderColor: '#e4f1fb' }}>
              <p className="text-xs font-bold tracking-widest uppercase mb-4" style={{ color: '#1a6fa8' }}>
                How to Install the APK
              </p>
              <ol className="space-y-4">
                {[
                  {
                    step: 'Scan the QR code',
                    desc: 'Open your phone camera and point it at the QR code above. Tap the link that pops up to start the download.',
                  },
                  {
                    step: 'Allow downloads from this source',
                    desc: 'Your browser may show a warning since this isn\u2019t from the Play Store. Tap "Download anyway" or "OK" to continue.',
                  },
                  {
                    step: 'Enable "Install unknown apps"',
                    desc: 'If prompted, go to Settings > Apps > Special access > Install unknown apps, select your browser, and turn the toggle on. This is required for any APK not from the Play Store.',
                  },
                  {
                    step: 'Open the downloaded file',
                    desc: 'Go to your Downloads folder or notification tray, tap the HealthQueue+ APK file you just downloaded.',
                  },
                  {
                    step: 'Tap "Install"',
                    desc: 'Confirm the install prompt. This may take a few seconds depending on your device.',
                  },
                  {
                    step: 'Open the app and sign in',
                    desc: 'Once installed, tap "Open." You can sign in with your mobile number \u2014 you\u2019ll receive an SMS one-time passcode to verify your account.',
                  },
                ].map((item, i) => (
                  <li key={item.step} className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: '#1a6fa8' }}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold mb-0.5" style={{ color: '#0c2d4e' }}>
                        {item.step}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: '#3d6e96' }}>
                        {item.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <button
              onClick={() => setQrOpen(false)}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #1a6fa8, #174e7d)' }}
            >
              Close
            </button>
          </div>
        </div>
       )}

      {policyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(12,45,78,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setPolicyModal(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#e4f1fb' }}>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: '#174e7d', fontSize: '1rem' }}>
                HealthQueue<span style={{ color: '#45c245' }}>+</span>
              </span>
              <button
                onClick={() => setPolicyModal(null)}
                aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                style={{ color: '#3d6e96' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto">
              {policyModal === 'privacy' && <PrivacyPolicy />}
              {policyModal === 'terms' && <TermsAndAgreements />}
            </div>

            <div className="px-6 py-4 border-t" style={{ borderColor: '#e4f1fb' }}>
              <button
                onClick={() => setPolicyModal(null)}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #1a6fa8, #174e7d)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
