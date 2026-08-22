/**
 * Semaphore SMS Service — Sends OTPs and Real-Time Notifications
 */
const axios = require('axios');
const { SEMAPHORE_API_KEY, SEMAPHORE_SENDER_NAME } = require('../config/config');

/**
 * Normalizes a PH mobile number to the local "09XXXXXXXXX" format Semaphore
 * expects. Accepts 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX, or numbers with
 * spaces/dashes. Semaphore rejects the leading "+", so it must be stripped —
 * this was previously passed straight through unmodified.
 */
const normalizePhForSemaphore = (raw) => {
  let n = String(raw || '').replace(/[^0-9+]/g, '');
  if (n.startsWith('+63')) n = '0' + n.slice(3);
  else if (n.startsWith('63') && n.length === 12) n = '0' + n.slice(2);
  return n;
};

/**
 * Sends an SMS message using Semaphore API
 */
const sendSMS = async (phoneNumber, message) => {
  if (!SEMAPHORE_API_KEY) {
    console.warn(`[SMS MOCK] To: ${phoneNumber} | Message: "${message}"`);
    return { success: true, mock: true };
  }

  const number = normalizePhForSemaphore(phoneNumber);

  try {
    const response = await axios.post('https://api.semaphore.co/api/v4/messages', {
      apikey: SEMAPHORE_API_KEY,
      number: number,
      message: message,
      sendername: SEMAPHORE_SENDER_NAME,
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error('Semaphore SMS Error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.message || error.message };
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