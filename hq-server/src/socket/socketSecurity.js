/**
 * Socket.IO authentication + room authorization.
 *
 * Before this, any client could connect, then emit `join_clinic <id>` or
 * `join_user <id>` for ANY id and receive that clinic's queue payloads
 * (patient names/phones) and chat messages, or another patient's private
 * staff replies. Now:
 *
 *   - The handshake JWT (auth.token or "Authorization: Bearer" header) is
 *     verified and the user is loaded. A connection without a valid token is
 *     still allowed (the public network panel only needs the anonymous
 *     `global_queue_change` ping, which carries no personal data) but it can
 *     never join a room.
 *   - join_user  -> only your own `user_<id>` room.
 *   - join_clinic:
 *       staff / facility_admin -> `clinic_<id>` ONLY for their own clinic
 *       super_admin            -> `clinic_<id>` for any clinic
 *       patient                -> `clinicpub_<id>` (sanitized refresh pings,
 *                                  never other patients' data or chat text)
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/config');

const STAFF_ROLES = ['staff', 'facility_admin'];

const extractToken = (socket) => {
  const fromAuth = socket.handshake?.auth?.token;
  if (fromAuth) return String(fromAuth).replace(/^Bearer\s+/i, '');
  const header = socket.handshake?.headers?.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
};

const registerSocketSecurity = (io) => {
  io.use(async (socket, next) => {
    socket.user = null;
    try {
      const token = extractToken(socket);
      if (token && JWT_SECRET) {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id || decoded._id).select('role clinicId isActive');
        if (user && user.isActive) socket.user = user;
      }
    } catch (_) {
      // Bad/expired token — treated as anonymous, never as an error that
      // would reveal why the token was rejected.
    }
    next();
  });

  io.on('connection', (socket) => {
    socket.on('join_clinic', (clinicId) => {
      const user = socket.user;
      if (!user || !clinicId) return;
      const id = String(clinicId);

      if (user.role === 'super_admin') {
        socket.join(`clinic_${id}`);
      } else if (STAFF_ROLES.includes(user.role)) {
        if (user.clinicId && String(user.clinicId) === id) socket.join(`clinic_${id}`);
      } else if (user.role === 'patient') {
        socket.join(`clinicpub_${id}`);
      }
    });

    socket.on('join_user', (userId) => {
      const user = socket.user;
      if (!user || !userId) return;
      if (String(user._id) === String(userId)) socket.join(`user_${userId}`);
    });
  });
};

module.exports = { registerSocketSecurity };
