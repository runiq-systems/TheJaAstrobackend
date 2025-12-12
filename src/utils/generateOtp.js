import crypto from "crypto"
import sendEmail from "./sendEmail.js"
import axios from "axios";
import { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_URL } from "../config/constants.js";

export async function sendOtpMSG91(phone, otp) {
  try {
    const url = MSG91_URL

    const payload = {
      template_id: MSG91_TEMPLATE_ID,
      mobile: "91" + phone,
      authkey: MSG91_AUTH_KEY,
      otp: otp,
      otp_length: 4,
      otp_expiry: 15 // minutes
    };

    const headers = {
      "Content-Type": "application/json",
      "authkey": MSG91_AUTH_KEY
    };

    const response = await axios.post(url, payload, { headers });


    if (response.data.type !== "success") {
      throw new Error("MSG91 failed to send OTP");
    }

    return true;
  } catch (error) {
    console.error("❌ MSG91 OTP Error:", error.response?.data || error.message);
    return false;
  }
}


export const generateOtp = () => {
    const otp = crypto.randomBytes(3).toString("hex")
    const numericOtp = parseInt(otp, 16).toString().slice(0,4)

    if(numericOtp.length < 4) {
        return generateOtp()
    }

    return numericOtp
}

export const sendOtpEmail = async (email, otp) => {
    const subject = "Your OTP is"
    const message = `Your OTP code is ${otp}. It will expire in 10 minutes.`

    await sendEmail(email, subject, message)
}