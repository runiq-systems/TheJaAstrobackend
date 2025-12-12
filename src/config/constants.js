import dotenv from "dotenv"
dotenv.config({quiet: true})

export const MONGO_URI = process.env.MONGO_URI
export const PORT = process.env.PORT || 5001
export const CLIENT_URL = process.env.CLIENT_URL
export const SERVER_URL = process.env.SERVER_URL
export const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY
export const MAIL_PASS = process.env.MAIL_PASS
export const MAIL_USER = process.env.MAIL_USER

export const MSG91_AUTH_KEY=your_auth_key_here
export const MSG91_SENDER_ID=process.env.MSG91_SENDER_ID
export const MSG91_TEMPLATE_ID=process.env.MSG91_TEMPLATE_ID
export const MSG91_URL=process.env.MSG91_URL