/**
 * Semaphore SMS Service — Sends OTPs and Real-Time Notifications
 */
const axios = require('axios');
const { SEMAPHORE_API_KEY, SEMAPHORE_SENDER_NAME } = require('../config/config');

/**
 * Sends an SMS message using Semaphore API
 */
const sendSMS = async (phoneNumber, message) => {
  if (!SEMAPHORE_API_KEY) {
    console.warn(`[SMS MOCK] To: ${phoneNumber} | Message: "${message}"`);
    return { success: true, mock: true };
  }

  try {
    const response = await axios.post('https://api.semaphore.co/api/v4/messages', {
      apikey: SEMAPHORE_API_KEY,
      number: phoneNumber,
      message: message,
      sendername: SEMAPHORE_SENDER_NAME,
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error('Semaphore SMS Error:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sends OTP Verification Code
 */
const sendOTP = async (phoneNumber, otpCode) => {
  const message = `[HealthQueue+] Your verification code is ${otpCode}. It will expire in 5 minutes. Do not share this code.`;
  return await sendSMS(phoneNumber, message);
};

module.exports = { sendSMS, sendOTP };