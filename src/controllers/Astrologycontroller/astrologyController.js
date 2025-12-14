import axios from "axios";
import NodeGeocoder from "node-geocoder";
import logger from "../../utils/logger.js";

const geocoder = NodeGeocoder({ provider: "openstreetmap" });

// 🌍 Convert location name to coordinates
export const getCoordinates = async (place) => {
  const res = await geocoder.geocode(place);
  if (res.length === 0) throw new Error("Invalid location");
  return { latitude: res[0].latitude, longitude: res[0].longitude };
};


// 🔐 Your Prokerala credentials (direct, no .env)
const PROKERALA_CLIENT_ID = "4efb8861-0d81-4a2c-83ad-313ce201c93e";
const PROKERALA_CLIENT_SECRET = "QIKLC96km3XzRYX3l3117LjJJlTjI8RfUy1hvOvP";

let accessToken = null;
let tokenExpiry = 0;

// Get or refresh Prokerala access token
const getAccessToken = async () => {
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
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        accessToken = res.data.access_token;
        tokenExpiry = now + res.data.expires_in - 60; // refresh 1 min early
        logger.info("✅ Prokerala access token generated");
        return accessToken;
    } catch (err) {
        logger.error("❌ Error generating token:", err.response?.data || err.message);
        throw new Error("Failed to generate Prokerala access token");
    }
};

// Map ?time=yesterday|today|this_week to a datetime string
const getDateTimeFromTimeQuery = (time = "today") => {
    const date = new Date();

    if (time === "yesterday") {
        date.setDate(date.getDate() - 1);
    }

    // For 'this_week', we’ll still fetch for **today** (UI is same, just label).
    // If later you use real weekly endpoint, change this logic.

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");

    // Prokerala expects ISO-like datetime with timezone
    return `${year}-${month}-${day}T00:00:00+05:30`;
};

// ⭐ Main controller
export const getDailyHoroscope = async (req, res) => {
    const { sign, time = "today" } = req.query;

    if (!sign) {
        return res.status(400).json({
            status: "error",
            message: "Missing zodiac sign (sign=aries|taurus|...)",
        });
    }

    const datetime = getDateTimeFromTimeQuery(time);

    try {
        const token = await getAccessToken();

        logger.info("♈ Fetching horoscope for:", { sign, time, datetime });

        const response = await axios.get(
            "https://api.prokerala.com/v2/horoscope/daily/advanced",
            {
                params: {
                    sign,
                    datetime,
                    timezone: "Asia/Kolkata",
                    type: "general,health,love", // very important – fixes your `type` error
                },
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        logger.info("✅ Prokerala horoscope success");

        const raw = response.data;

        // Depending on their structure – we normalise into your FE format:
        // { status: 'ok', data: { datetime, daily_predictions: [ ... ] } }
        const core = raw.data || raw; // handle both cases

        const horoscope = {
            sign: core.sign,
            sign_info: core.sign_info,
            predictions: core.predictions || [],
            aspects: core.aspects || [],
            transits: core.transits || [],
        };

        return res.json({
            status: "ok",
            data: {
                datetime: core.datetime || datetime,
                daily_predictions: [horoscope],
            },
        });
    } catch (err) {
        logger.error(
            "❌ Prokerala API error:",
            err.response?.data || err.message
        );

        return res
            .status(err.response?.status || 500)
            .json({
                status: "error",
                message: err.response?.data || err.message,
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
