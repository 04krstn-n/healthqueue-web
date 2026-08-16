/**
 * Notification Controller
 */
const Notification = require('../models/Notification');
const { HttpStatus } = require('../config/config');

// GET /api/notifications — get current user's notifications
const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(HttpStatus.OK).json({ success: true, data: notifications });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to get notifications.' });
  }
};

// PUT /api/notifications/:id/read — mark as read
const markRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notif) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Notification not found.' });
    return res.status(HttpStatus.OK).json({ success: true, message: 'Marked as read.', data: notif });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to mark notification.' });
  }
};

// PUT /api/notifications/read-all — mark all as read
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    return res.status(HttpStatus.OK).json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to mark all notifications.' });
  }
};

module.exports = { getMyNotifications, markRead, markAllRead };