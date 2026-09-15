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
      // 'staff_reply' added: chatbotAdminController.replyToThread was
      // calling notifyUser(..., { type: 'staff_reply' }) with a value not
      // in this enum, so Notification.create() threw a ValidationError on
      // every single staff reply — AFTER the ChatLog row (the actual
      // reply) had already been created and socket-pushed to the patient.
      // The whole request still 500'd because of this, so staff always
      // saw "Failed to send reply." even when the message went through.
      enum: ['queue', 'appointment', 'system', 'reminder', 'turn_alert', 'sms_otp', 'staff_reply'],
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