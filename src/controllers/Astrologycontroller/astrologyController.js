import axios from "axios";
import NodeGeocoder from "node-geocoder";

const geocoder = NodeGeocoder({ provider: "openstreetmap" });

let accessToken = null;

// 🔐 Fetch Access Token
const getAccessToken = async () => {
    if (!accessToken) {
        const res = await axios.post(
            "https://api.prokerala.com/token",
            new URLSearchParams({
                grant_type: "client_credentials",
                client_id: process.env.PROKERALA_CLIENT_ID,
                client_secret: process.env.PROKERALA_CLIENT_SECRET,
            })
        );
        accessToken = res.data.access_token;
    }
    return accessToken;
};

// 🌍 Convert location name to coordinates
export const getCoordinates = async (place) => {
    const res = await geocoder.geocode(place);
    if (res.length === 0) throw new Error("Invalid location");
    return { latitude: res[0].latitude, longitude: res[0].longitude };
};

// 🔮 1️⃣ Daily Horoscope
export const getDailyHoroscope = async (req, res) => {
    try {
        const { sign } = req.query;
        const token = await getAccessToken();

        const response = await axios.get(
            `https://api.prokerala.com/v2/astrology/daily-horoscope`,
            {
                params: { sign, timezone: "Asia/Kolkata" },
                headers: { Authorization: `Bearer ${token}` },
            }
        );
        console.log(response)

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
            `https://api.prokerala.com/v2/astrology/match-making`,
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
            `https://api.prokerala.com/v2/astrology/birth-details`,
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
