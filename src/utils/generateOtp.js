import crypto from "crypto"
import sendEmail from "./sendEmail.js"

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