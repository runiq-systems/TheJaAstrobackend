import axios from "axios";
import logger from "../../utils/logger.js";

// 🔐 Your Prokerala credentials
const PROKERALA_CLIENT_ID = "4efb8861-0d81-4a2c-83ad-313ce201c93e";
const PROKERALA_CLIENT_SECRET = "QIKLC96km3XzRYX3l3117LjJJlTjI8RfUy1hvOvP";

let accessToken = null;
let tokenExpiry = 0;

// 🔐 Generate or Refresh Token
const getAccessToken = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (accessToken && now < tokenExpiry) return accessToken;

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
    logger.info("✅ Access token refreshed");
    return accessToken;
};

// 🔮 Daily Horoscope Controller
export const getDailyHoroscope = async (req, res) => {
    try {
        const { sign } = req.query;
        if (!sign) return res.status(400).json({ error: "Missing zodiac sign" });

        logger.info("♈ Requested sign:", sign);
        const token = await getAccessToken();

        const today = new Date().toISOString(); // e.g. 2025-12-14T15:35:00Z

        const response = await axios.get(
            "https://api.prokerala.com/v2/horoscope/daily/advanced",
            {
                params: {
                    sign,
                    datetime: today,
                    timezone: "Asia/Kolkata",
                    type: "all", // 👈 ADD THIS PARAMETER (fixes your error)

                },
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        logger.info("✅ Horoscope data received");
        res.json(response.data);
    } catch (error) {
        logger.error("❌ Horoscope API Error:", error.response?.data || error.message);
        res.status(500).json({
            error: error.response?.data || error.message,
        });
    }
};


// 💑 2️⃣ Kundali Matching
export const getKundaliMatching = async (req, res) => {
    try {
        const {
            boy_name,
            boy_dob,
            boy_tob,
            boy_place,
            girl_name,
            girl_dob,
            girl_tob,
            girl_place,
        } = req.body;

        const boyCoords = await getCoordinates(boy_place);
        const girlCoords = await getCoordinates(girl_place);
        const token = await getAccessToken();

        const response = await axios.get(
            `https://api.prokerala.com/v2/astrology/kundli-matching/advanced`,
            {
                params: {
                    m_day: new Date(boy_dob).getDate(),
                    m_month: new Date(boy_dob).getMonth() + 1,
                    m_year: new Date(boy_dob).getFullYear(),
                    m_hour: parseInt(boy_tob.split(":")[0]),
                    m_min: parseInt(boy_tob.split(":")[1]),
                    m_lat: boyCoords.latitude,
                    m_lng: boyCoords.longitude,

                    f_day: new Date(girl_dob).getDate(),
                    f_month: new Date(girl_dob).getMonth() + 1,
                    f_year: new Date(girl_dob).getFullYear(),
                    f_hour: parseInt(girl_tob.split(":")[0]),
                    f_min: parseInt(girl_tob.split(":")[1]),
                    f_lat: girlCoords.latitude,
                    f_lng: girlCoords.longitude,
                },
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 🧘 3️⃣ Kundali Report
export const getKundaliReport = async (req, res) => {
    try {
        const { name, dob, tob, place } = req.body;
        const { latitude, longitude } = await getCoordinates(place);
        const token = await getAccessToken();

        const response = await axios.get(
            `https://api.prokerala.com/v2/astrology/kundli/advanced`,
            {
                params: {
                    name,
                    day: new Date(dob).getDate(),
                    month: new Date(dob).getMonth() + 1,
                    year: new Date(dob).getFullYear(),
                    hour: parseInt(tob.split(":")[0]),
                    min: parseInt(tob.split(":")[1]),
                    lat: latitude,
                    lng: longitude,
                },
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
