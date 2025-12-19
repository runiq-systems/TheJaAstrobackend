import axios from "axios";
import logger from "../../utils/logger.js";

const PROKERALA_CLIENT_ID = process.env.PROKERALA_CLIENT_ID
const PROKERALA_CLIENT_SECRET = process.env.PROKERALA_CLIENT_SECRET

// 🔁 Token cache
let accessToken = null;
let tokenExpiry = 0;

// 🔐 Generate or reuse token
export const getAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && now < tokenExpiry) return accessToken;

  try {
    const res = await axios.post(
      "https://api.prokerala.com/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: PROKERALA_CLIENT_ID,
        client_secret: PROKERALA_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    accessToken = res.data.access_token;
    tokenExpiry = now + res.data.expires_in - 60;
    logger.info("✅ Prokerala access token generated");
    return accessToken;
  } catch (err) {
    logger.error("❌ Error generating token:", err.response?.data || err.message);
    throw new Error("Failed to generate Prokerala access token");
  }
};
