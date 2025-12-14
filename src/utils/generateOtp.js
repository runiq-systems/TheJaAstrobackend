import crypto from "crypto"
import sendEmail from "./sendEmail.js"
import axios from "axios";

export async function sendOtpMSG91(phone, otp) {
  try {
    const url = process.env.MSG91_URL

    const data = {
      "template_id": process.env.MSG91_TEMPLATE_ID,
      "short_url": "1",
      "short_url_expiry": "Seconds",
      "realTimeResponse": "1",
      "recipients": [
       {
          "mobiles": `91${phone}`,
          "OTP": otp    
       }]
    };

    const headers = {
      "Content-Type": "application/json",
      authkey: process.env.MSG91_AUTH_KEY,
    };

    const response = await axios.post(url, data, {
      headers,
      timeout: 5000,
    });

    // ✅ Success check remains the same
    if (response.data?.type !== "success") {
      console.error("MSG91 rejected OTP:", response.data);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "❌ MSG91 OTP Error:",
      error.response?.data || error.message
    );
    return false;
  }
}

export function generateOtp() {
  return crypto.randomInt(1000, 10000).toString();
}

export const sendOtpEmail = async (email, otp) => {
    const subject = "Your OTP is"
    const message = `Your OTP code is ${otp}. It will expire in 10 minutes.`

    await sendEmail(email, subject, message)
}