import axios from "axios";
import NodeGeocoder from "node-geocoder";
import logger from "../../utils/logger.js";

// 🌍 Geocoder
const geocoder = NodeGeocoder({ provider: "openstreetmap" });

// ✅ Convert location name → coordinates
export const getCoordinates = async (place) => {
    const res = await geocoder.geocode(place);
    if (!res.length) throw new Error("Invalid location");
    return { latitude: res[0].latitude, longitude: res[0].longitude };
};

// 🔐 Prokerala credentials (replace with .env in production)
const PROKERALA_CLIENT_ID = "6f767885-1fb9-4bf8-8b35-39ae16296b8a";
const PROKERALA_CLIENT_SECRET = "XuCZXeXOm5grEOIXfcjvIbsvfJaOJywYZxp4N38X";

// 🔁 Token cache
let accessToken = null;
let tokenExpiry = 0;

// 🔐 Generate or reuse token
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

// 🕒 Date utility for horoscope
const getDateTimeFromTimeQuery = (time = "today") => {
    const date = new Date();
    if (time === "yesterday") date.setDate(date.getDate() - 1);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}T00:00:00+05:30`;
};

// ♈ Horoscope
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
        logger.info("♈ Fetching horoscope:", { sign, time, datetime });

        const response = await axios.get(
            "https://api.prokerala.com/v2/horoscope/daily/advanced",
            {
                params: {
                    sign,
                    datetime,
                    timezone: "Asia/Kolkata",
                    type: "general,health,love",
                },
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        logger.info("✅ Horoscope success");
        const core = response.data.data || response.data;

        return res.json({
            status: "ok",
            data: {
                datetime: core.datetime || datetime,
                daily_predictions: [
                    {
                        sign: core.sign,
                        sign_info: core.sign_info,
                        predictions: core.predictions || [],
                        aspects: core.aspects || [],
                        transits: core.transits || [],
                    },
                ],
            },
        });
    } catch (err) {
        logger.error("❌ Prokerala API error:", err.response?.data || err.message);
        return res.status(err.response?.status || 500).json({
            status: "error",
            message: err.response?.data || err.message,
        });
    }
};

// 💑 Kundali Matching
// 💑 Detailed Kundli Matching (v2 format)
export const getKundaliMatching = async (req, res) => {
    try {
        const {
            boy_name,
            boy_dob, // e.g. "12/02/2000" or "2000-02-12"
            boy_tob, // e.g. "3:15 PM" or "15:15"
            boy_place,
            girl_name,
            girl_dob,
            girl_tob,
            girl_place,
            ayanamsa = 1, // default: Lahiri
            la = "en",    // default: English
        } = req.body;

        // 🧭 Convert places to coordinates
        const boyCoords = await getCoordinates(boy_place);
        const girlCoords = await getCoordinates(girl_place);

        // 🕓 Convert DOB + TOB → ISO datetime
        const parseDateTime = (dob, tob) => {
            const parseDate = () => {
                if (dob.includes("/")) {
                    const [day, month, year] = dob.split("/").map((x) => x.padStart(2, "0"));
                    return `${year}-${month}-${day}`;
                } else {
                    const d = new Date(dob);
                    return d.toISOString().split("T")[0];
                }
            };

            const parseTime = () => {
                let [h, m] = [0, 0];
                if (tob.toLowerCase().includes("am") || tob.toLowerCase().includes("pm")) {
                    const isPM = tob.toLowerCase().includes("pm");
                    const clean = tob.toLowerCase().replace("am", "").replace("pm", "").trim();
                    [h, m] = clean.split(":").map(Number);
                    if (isPM && h < 12) h += 12;
                    if (!isPM && h === 12) h = 0;
                } else {
                    [h, m] = tob.split(":").map(Number);
                }
                return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`;
            };

            return `${parseDate()}T${parseTime()}+05:30`;
        };

        const boy_dob_iso = parseDateTime(boy_dob, boy_tob);
        const girl_dob_iso = parseDateTime(girl_dob, girl_tob);
        const boy_coordinates = `${boyCoords.latitude.toFixed(6)},${boyCoords.longitude.toFixed(6)}`;
        const girl_coordinates = `${girlCoords.latitude.toFixed(6)},${girlCoords.longitude.toFixed(6)}`;

        // 🪙 Get API Token
        const token = await getAccessToken();

        // 🚀 Call the Detailed Kundli Matching endpoint
        const response = await axios.get(
            "https://api.prokerala.com/v2/astrology/kundli-matching/detailed",
            {
                params: {
                    boy_dob: boy_dob_iso,
                    boy_coordinates,
                    girl_dob: girl_dob_iso,
                    girl_coordinates,
                    ayanamsa,
                    la,
                },
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        logger.info("✅ Detailed Kundli Matching Success");
        return res.json(response.data);
    } catch (error) {
        logger.error("❌ Kundali Matching Error:", error.response?.data || error.message);
        res.status(500).json({
            error: error.response?.data || error.message,
        });
    }
};


// 🧘 Kundali Report
export const getKundaliReport = async (req, res) => {
    try {
        const { name, dob, tob, place } = req.body;
        if (!dob || !tob || !place)
            return res.status(400).json({ error: "Missing required fields (dob, tob, place)" });

        const parseDate = () => {
            if (dob.includes("/")) {
                const [day, month, year] = dob.split("/").map((x) => x.padStart(2, "0"));
                return `${year}-${month}-${day}`;
            } else {
                const d = new Date(dob);
                return d.toISOString().split("T")[0];
            }
        };

        const parseTime = () => {
            let [h, m] = [0, 0];
            if (tob.toLowerCase().includes("am") || tob.toLowerCase().includes("pm")) {
                const isPM = tob.toLowerCase().includes("pm");
                const clean = tob.toLowerCase().replace("am", "").replace("pm", "").trim();
                [h, m] = clean.split(":").map(Number);
                if (isPM && h < 12) h += 12;
                if (!isPM && h === 12) h = 0;
            } else {
                [h, m] = tob.split(":").map(Number);
            }
            return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`;
        };

        // 🧪 Sandbox fix (use January 1)
        const sandboxMode = true; // change to false for live
        const datePart = sandboxMode ? "2000-01-01" : parseDate();
        const isoDate = `${datePart}T${parseTime()}+05:30`;

        const { latitude, longitude } = await getCoordinates(place);
        const coordinates = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;

        const token = await getAccessToken();
        const response = await axios.get(
            "https://api.prokerala.com/v2/astrology/kundli/advanced",
            {
                params: { datetime: isoDate, coordinates, ayanamsa: 1 },
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        res.json(response.data);
    } catch (error) {
        logger.error("❌ Kundali Report Error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};
