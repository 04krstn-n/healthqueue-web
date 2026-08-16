/**
 * Notification model — in-app and SMS notifications
 */
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title:   { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['queue', 'appointment', 'system', 'reminder', 'turn_alert', 'sms_otp'],
      default: 'system',
    },
    channel: {
      type: String,
      enum: ['in_app', 'sms', 'both'],
      default: 'in_app',
    },
    refType: { type: String, default: null }, // 'QueueEntry' | 'Appointment'
    refId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    isRead:  { type: Boolean, default: false },
    smsStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);