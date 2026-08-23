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
const { notFound, errorHandler } = require('./middleware/errorHandler');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes');
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
const auditLogRoutes     = require('./routes/auditLogRoutes');

// ─── Connect Database ─────────────────────────────────────────────────────────
connectDB();

const app = express();
const server = http.createServer(app);

// ─── Socket.io Setup for Real-Time Synchronization ────────────────────────────
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// Attach socket instance to express app so controllers can trigger real-time queue events
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`Client connected to Socket.io: ${socket.id}`);

  // Room subscriptions for targeted broadcasts (e.g., specific clinic queue updates)
  socket.on('join_clinic', (clinicId) => {
    socket.join(`clinic_${clinicId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ─── Security & Utilities ─────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(cors({
  origin: FRONTEND_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting — 200 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    status: HttpStatus.BAD_REQUEST,
    message: 'Too many requests. Please slow down and try again later.' 
  },
});
app.use('/api', limiter);

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
app.use('/api/audit-logs',    auditLogRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`HealthQueue+ API running on port ${PORT} [${NODE_ENV}]`);
   console.log(`Server running with WebSockets on port ${PORT}`);
});

module.exports = { app, server };