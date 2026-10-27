/**
 * HealthQueue+ API Server — Single Entry Point
 * All CommonJS — no ES module / require() mixing.
 */
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { HttpStatus, PORT, NODE_ENV, FRONTEND_ORIGINS } = require('./config/config');
const connectDB = require('./config/db');
const { registerSocketSecurity } = require('./socket/socketSecurity');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { sanitizeRequest } = require('./middleware/sanitize');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes');
const publicRoutes       = require('./routes/publicRoutes');
const userRoutes         = require('./routes/userRoutes');
const clinicRoutes       = require('./routes/clinicRoutes');
const queueRoutes        = require('./routes/queueRoutes');
const appointmentRoutes  = require('./routes/appointmentRoutes');
const dashboardRoutes    = require('./routes/dashboardRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const chatbotRoutes      = require('./routes/chatbotRoutes');
const staffRoutes        = require('./routes/staffRoutes');
const patientRoutes      = require('./routes/patientRoutes');
const servicesRoutes     = require('./routes/servicesRoutes');
const chatbotAdminRoutes = require('./routes/chatbotAdminRoutes');
const systemConfigRoutes = require('./routes/systemConfigRoutes');
const analyticsRoutes    = require('./routes/analyticsRoutes');
const prescriptiveRoutes = require('./routes/prescriptiveRoutes');
const patientTypeRequestRoutes = require('./routes/patientTypeRequestRoutes');
const auditLogRoutes     = require('./routes/auditLogRoutes');

// ─── Connect Database ─────────────────────────────────────────────────────────
connectDB();

const app = express();

// "simple" = Node's querystring parser: ?a[$gt]=1 stays a plain string key
// instead of becoming { a: { $gt: 1 } }, so query strings can never carry
// MongoDB operators (see middleware/sanitize.js for the body side).
app.set('query parser', 'simple');

// Heroku (and most hosts) put a reverse proxy in front of the app. Without
// this, req.ip is the PROXY's address for every visitor, so all the rate
// limiters below would share one bucket across all users (e.g. 10 login
// attempts per 15 minutes for the whole system). `1` = trust exactly one proxy hop.
app.set('trust proxy', 1);
const server = http.createServer(app);

// ─── Socket.io Setup for Real-Time Synchronization ────────────────────────────
const io = new Server(server, {
  cors: {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    origin: FRONTEND_ORIGINS, // Allow requests from the specified frontend origins
  },
});

// Attach socket instance to express app so controllers can trigger real-time queue events
app.set('io', io);

// Authenticated handshake + authorized room joins (join_clinic / join_user).
registerSocketSecurity(io);

io.on('connection', (socket) => {
  console.log(`Client connected to Socket.io: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ─── Security & Utilities ─────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(cors({
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  origin: FRONTEND_ORIGINS, // Allow requests from the specified frontend origins
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
// Strip MongoDB operator keys ($gt, $ne, ...) from every JSON body.
app.use(sanitizeRequest);

// Load testing (scripts/loadtest) sends hundreds of requests from ONE
// machine, which the per-IP limiters below would block. DISABLE_RATE_LIMIT
// turns them off, but ONLY outside production — it is ignored when
// NODE_ENV=production.
const rateLimitOff = process.env.DISABLE_RATE_LIMIT === 'true' && NODE_ENV !== 'production';
if (rateLimitOff) console.warn('[WARN] Rate limiting DISABLED for load testing (DISABLE_RATE_LIMIT=true).');
const skipLimits = () => rateLimitOff;

// Rate limiting — 200 requests per 15 min per IP
const limiter = rateLimit({
  skip: skipLimits,
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    status: HttpStatus.BAD_REQUEST,
    message: 'Too many requests. Please slow down and try again later.' 
  },
});
// Public waiting-room display (no login). Mounted BEFORE the general limiter
// with its own, more generous per-IP limit: a TV refreshing every few seconds
// (plus every clinic device sharing the clinic's one public IP) would
// otherwise burn through the 200-requests-per-15-minutes budget and lock
// staff out of the real API.
const publicLimiter = rateLimit({
  skip: skipLimits,
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});
app.use('/api/public', publicLimiter, publicRoutes);

app.use('/api', limiter);

// Stricter limiter for auth endpoints — the general /api limiter (200/15min)
// is too loose to meaningfully slow down password/OTP brute-forcing, since
// it's shared across every route. This applies on top of it, scoped only to
// login/OTP/password-reset.
const authLimiter = rateLimit({
  skip: skipLimits,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Too many attempts. Please wait a few minutes before trying again.',
  },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/resend-otp', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/verify-reset-otp', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(HttpStatus.OK).json({ 
    status: 'ok', 
    service: 'HealthQueue+ API', 
    version: '2.0.0', 
    timestamp: new Date().toISOString() 
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/clinics',       clinicRoutes);
app.use('/api/queues',        queueRoutes);
app.use('/api/appointments',  appointmentRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chatbot',       chatbotRoutes);
app.use('/api/staff',         staffRoutes);
app.use('/api/patients',      patientRoutes);
app.use('/api/services',      servicesRoutes);
app.use('/api/chatbot-admin', chatbotAdminRoutes);
app.use('/api/system-config',        systemConfigRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/prescriptive',  prescriptiveRoutes);
app.use('/api/audit-logs',    auditLogRoutes);
app.use('/api/patient-type-requests', patientTypeRequestRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Automatic 5-minute grace-period expiry ───────────────────────────────────
// Marks `called` tickets whose grace period has passed as no-show, which also
// frees the patient's other service lines. See services/graceSweeper.js.
const { startGraceSweeper } = require('./services/graceSweeper');
const { notifyPositionMilestones } = require('./controllers/queueController');
startGraceSweeper({ io, onChange: (clinicId) => notifyPositionMilestones(clinicId).catch(() => {}) });

// ─── Appointment reminders (24 h and 1 h before the slot) ─────────────────────
const { startAppointmentReminders } = require('./services/appointmentReminder');
startAppointmentReminders();

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`HealthQueue+ API running on port ${PORT} [${NODE_ENV}]`);
   console.log(`Server running with WebSockets on port ${PORT}`);
});

module.exports = { app, server };