import axios from "axios";
import NodeGeocoder from "node-geocoder";
import logger from "../../utils/logger.js";
import DailyHoroscopeSign from "../../models/DailyHoroscopeSign.js";
// 🌍 Geocoder
const geocoder = NodeGeocoder({ provider: "openstreetmap" });

// ✅ Convert location name → coordinates
export const getCoordinates = async (place) => {
  const res = await geocoder.geocode(place);
  if (!res.length) throw new Error("Invalid location");
  return { latitude: res[0].latitude, longitude: res[0].longitude };
};

// 🔐 Prokerala credentials (replace with .env in production)
const PROKERALA_CLIENT_ID = process.env.PROKERALA_CLIENT_ID
const PROKERALA_CLIENT_SECRET = process.env.PROKERALA_CLIENT_SECRET

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

export const storeDailyHoroscope = async (apiData) => {
  const { datetime, daily_predictions } = apiData;

  if (!datetime || !Array.isArray(daily_predictions)) {
    throw new Error("Invalid API payload");
  }

  const date = new Date(datetime); // same date for all signs

  const bulkOps = daily_predictions.map((item) => ({
    updateOne: {
      filter: {
        date,
        "sign.name": item.sign.name,
      },
      update: {
        $set: {
          date,

          sign: {
            id: item.sign.id,
            name: item.sign.name,
            lord: item.sign.lord,
          },

          sign_info: item.sign_info,

          predictions: item.predictions.map((p) => ({
            type: p.type,
            prediction: p.prediction,
            seek: p.seek,
            challenge: p.challenge,
            insight: p.insight,
          })),

          aspects: item.aspects || [],
          transits: item.transits || [],
          source: "prokerala",
        },
      },
      upsert: true, // prevents duplicates
    },
  }));

  await DailyHoroscopeSign.bulkWrite(bulkOps);

  return {
    upserted: bulkOps.length,
    date,
  };
};

// ♈ Horoscope
// 🕒 Updated Date utility for horoscope (removes sandbox restriction)
const getDateTimeFromTimeQuery = (time = "today") => {
  const date = new Date();

  // Adjust for yesterday if needed
  if (time === "yesterday") {
    date.setDate(date.getDate() - 1);
  }

  // Format to YYYY-MM-DD
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  // ✅ Correct format for Prokerala: Date at midnight in IST
  // This format is crucial for the API to return predictions[citation:9]
  return `${year}-${month}-${day}T00:00:00+05:30`;
};
export const getDailyHoroscope = async ({
  sign = "all",
  time = "today",
} = {}) => {


  if (!sign) {
    return res.status(400).json({
      status: "error",
      message: "Missing zodiac sign",
    });
  }

  let datetime;
  try {
    datetime = getDateTimeFromTimeQuery(time);
  } catch {
    return res.status(400).json({
      status: "error",
      message: "Invalid time parameter",
    });
  }

  try {
    const token = await getAccessToken();

    const response = await axios.get(
      "https://api.prokerala.com/v2/horoscope/daily/advanced",
      {
        params: {
          datetime, // ISO 8601 encoded
          sign,
          type: "general"
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },

      }
    );
    const result = await storeDailyHoroscope(response.data.data);



    return res.json({
      status: "ok",
      data: {
        result,
      },
      meta: {
        source: "prokerala",
        tier: "basic",
      },
    });

  } catch (err) {
    logger.error("Daily horoscope failed", err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({
      status: "error",
      message: "Failed to fetch daily horoscope",
    });
  }
};



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
      la = "en", // default: English
    } = req.body;

    // 🧭 Convert places to coordinates
    const boyCoords = await getCoordinates(boy_place);
    const girlCoords = await getCoordinates(girl_place);

    // 🕓 Convert DOB + TOB → ISO datetime
    const parseDateTime = (dob, tob, isSandbox) => {
      const parseDate = () => {
        if (isSandbox) {
          // 🧪 Sandbox restriction — use January 1
          return "2000-01-01";
        }

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

    // 🧪 Toggle sandboxMode here
    const sandboxMode = true; // set false when using live credentials

    const boy_dob_iso = parseDateTime(boy_dob, boy_tob, sandboxMode);
    const girl_dob_iso = parseDateTime(girl_dob, girl_tob, sandboxMode);

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


// 🌟 Birth Details (Nakshatra and Zodiac Details)
export const getBirthDetails = async (req, res) => {
  try {
    const { name, dob, tob, place, ayanamsa = 1, la = 'en' } = req.body;

    // Validate required fields
    if (!dob || !tob || !place) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: dob (date of birth), tob (time of birth), and place are required."
      });
    }

    // 🧪 Optional: Sandbox mode date handling (if needed for testing)
    const sandboxMode = true; // Set to false for live/production use
    const parseDate = () => {
      if (sandboxMode) {
        // Sandbox restriction — use a fixed date like January 1
        return "2000-01-01";
      }

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
      const tobLower = tob.toLowerCase();
      if (tobLower.includes("am") || tobLower.includes("pm")) {
        const isPM = tobLower.includes("pm");
        const clean = tobLower.replace("am", "").replace("pm", "").trim();
        [h, m] = clean.split(":").map(Number);
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
      } else {
        [h, m] = tob.split(":").map(Number);
      }
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`;
    };

    // Combine date and time into ISO 8601 format with IST timezone
    const datePart = parseDate();
    const timePart = parseTime();
    const datetime = `${datePart}T${timePart}+05:30`;

    // 🧭 Convert place to coordinates (reuse your existing function)
    const { latitude, longitude } = await getCoordinates(place);
    const coordinates = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

    // 🪙 Get API Access Token
    const token = await getAccessToken();

    // 🚀 Call the Prokerala Birth Details API
    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/birth-details",
      {
        params: {
          datetime,
          coordinates,
          ayanamsa,
          la
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    logger.info("✅ Birth Details fetched successfully");
    return res.json(response.data);

    //postman Test

    // {
    //     "name": "Rajesh Kumar",
    //     "dob": "15/08/1990",
    //     "tob": "10:30 AM",
    //     "place": "Delhi, India",
    //     "ayanamsa": 1,
    //     "la": "en"
    // }

  } catch (error) {
    logger.error("❌ Birth Details API Error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      status: "error",
      message: error.response?.data || error.message,
    });
  }
};

function toRFC3339(dob, tob) {
  if (!dob || !tob) throw new Error("DOB and TOB required");

  let datePart;
  if (dob.includes("/")) {
    const [dd, mm, yyyy] = dob.split("/").map(x => x.padStart(2, "0"));
    datePart = `${yyyy}-${mm}-${dd}`;
  } else {
    const d = new Date(dob);
    if (isNaN(d)) throw new Error("Invalid DOB format");
    datePart = d.toISOString().split("T")[0];
  }

  let h = 0, m = 0, s = 0;
  const t = tob.toLowerCase().trim();

  if (t.includes("am") || t.includes("pm")) {
    const isPM = t.includes("pm");
    const clean = t.replace(/am|pm/g, "").trim();
    [h, m, s = 0] = clean.split(":").map(Number);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  } else {
    [h, m, s = 0] = t.split(":").map(Number);
  }

  return `${datePart}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}+05:30`;
}

// 🌟 Advanced Kundali Report (Filtered - Nakshatra & Mangal Dosha Only)
export const getAdvancedKundaliReport = async (req, res) => {
  try {
    const { dob, tob, place, ayanamsa = 1, la = "en", year_length = 1 } = req.body;

    if (!dob || !tob || !place) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    const datetime = toRFC3339(dob, tob);
    const geo = await getCoordinates(place);

    if (!geo) {
      return res.status(400).json({ status: "error", message: "Invalid place" });
    }

    const token = await getAccessToken();

    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli/advanced",
      {
        params: {
          datetime,
          coordinates: `${geo.latitude},${geo.longitude}`,
          ayanamsa,
          la,
          year_length
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000
      }
    );

    return res.json({
      status: "ok",
      data: response.data.data
    });

  } catch (err) {
    return res.status(err.response?.status || 500).json({
      status: "error",
      message: "Advanced kundali failed",
      details: err.response?.data || err.message
    });
  }
};

// 🌟 Kundali Compatibility Report (Two People)
export const getKundaliCompatibility = async (req, res) => {
  try {
    const {
      name1, dob1, tob1, place1,
      name2, dob2, tob2, place2,
      ayanamsa = 1,
      la = "en"
    } = req.body;

    if (![dob1, tob1, place1, dob2, tob2, place2].every(Boolean)) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    const girlDOB = toRFC3339(dob1, tob1);
    const boyDOB = toRFC3339(dob2, tob2);

    const girlGeo = await getCoordinates(place1);
    const boyGeo = await getCoordinates(place2);

    if (!girlGeo || !boyGeo) {
      return res.status(400).json({ status: "error", message: "Invalid place coordinates" });
    }

    const token = await getAccessToken();

    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli-matching",
      {
        params: {
          girl_dob: girlDOB,
          girl_coordinates: `${girlGeo.latitude},${girlGeo.longitude}`,
          boy_dob: boyDOB,
          boy_coordinates: `${boyGeo.latitude},${boyGeo.longitude}`,
          ayanamsa,
          la
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000
      }
    );

    return res.json({
      status: "ok",
      data: response.data.data
    });

  } catch (err) {
    return res.status(err.response?.status || 500).json({
      status: "error",
      message: "Kundali compatibility failed",
      details: err.response?.data || err.message
    });
  }
};






// ⏰ Runs every day at 12:05 AM
cron.schedule("5 0 * * *", async () => {
  try {
    logger.info("🟢 Daily Horoscope Cron Started");

    await getDailyHoroscope({
      sign: "all",
      time: "today",
      type: "general",
    });

    logger.info("✅ Daily Horoscope Cron Completed");
  } catch (error) {
    logger.error("❌ Daily Horoscope Cron Failed", error.message);
  }
});
