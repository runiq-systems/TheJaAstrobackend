import axios from "axios";
import NodeGeocoder from "node-geocoder";
import logger from "../../utils/logger.js";
import DailyHoroscopeSign from "../../models/DailyHoroscopeSign.js";
import { getDailyHoroscopeBySign } from "../../services/prokerala/horoscopeCache.js";
import { getISTDayRange } from "../../utils/date.utils.js";
import { getCachedKundaliReport, storeKundaliReport } from "../../services/prokerala/kundaliReportCache.js";
import { getAccessToken } from "../../services/prokerala/prokeralaToken.services.js";
import { getCachedMatching, storeKundaliMatching } from "../../services/prokerala/kundaliMatchingCache.js";


// 🌍 Geocoder
const geocoder = NodeGeocoder({ provider: "openstreetmap" });

// ✅ Convert location name → coordinates
export const getCoordinates = async (place) => {
  const res = await geocoder.geocode(place);
  console.log(res);
  if (!res.length) throw new Error("Invalid location");
  return { latitude: res[0].latitude, longitude: res[0].longitude };
};


export const storeDailyHoroscope = async (apiData) => {
  const { datetime, daily_predictions } = apiData;

  if (!datetime || !Array.isArray(daily_predictions)) {
    throw new Error("Invalid API payload");
  }

  const { dayUTC } = getISTDayRange();

  const bulkOps = daily_predictions.map((item) => ({
    updateOne: {
      filter: {
        date: dayUTC,
        "sign.name": item.sign.name.toLowerCase(),
      },
      update: {
        $set: {
          date: dayUTC,  // Single Date value

          sign: {
            id: item.sign.id,
            name: item.sign.name.toLowerCase(),
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
      upsert: true,
    },
  }));

  const result = await DailyHoroscopeSign.bulkWrite(bulkOps);

  return {
    upsertedCount: result.upsertedCount,
    modifiedCount: result.modifiedCount,
  };
};

export const getDailyHoroscope = async (req, res) => {
  try {
    const { sign } = req.query;

    if (!sign) {
      return res.status(400).json({
        success: false,
        message: "Zodiac sign is required",
      });
    }

    const result = await getDailyHoroscopeBySign(sign);

    return res.json({
      success: true,
      source: result.source,
      data: result.data,
    });
  } catch (error) {
    console.error("Daily Horoscope Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch daily horoscope",
    });
  }
};




function toRFC3339(dob, tob) {
  if (!dob || !tob) {
    throw new Error("DOB and TOB required");
  }

  let yyyy, mm, dd;

  // ✅ Handle DD/MM/YYYY
  if (typeof dob === "string" && dob.includes("/")) {
    const parts = dob.split("/");
    if (parts.length !== 3) throw new Error("Invalid DOB format");
    [dd, mm, yyyy] = parts;
  }
  // ✅ Handle YYYY-MM-DD
  else if (typeof dob === "string" && dob.includes("-")) {
    const parts = dob.split("-");
    if (parts.length !== 3) throw new Error("Invalid DOB format");
    [yyyy, mm, dd] = parts;
  }
  // ❌ Anything else
  else {
    throw new Error("DOB must be string in DD/MM/YYYY or YYYY-MM-DD");
  }

  // Normalize date
  yyyy = String(yyyy);
  mm = String(mm).padStart(2, "0");
  dd = String(dd).padStart(2, "0");

  // ---- Time ----
  let h = 0, m = 0;
  const t = String(tob).toLowerCase().trim();

  if (t.includes("am") || t.includes("pm")) {
    const isPM = t.includes("pm");
    const clean = t.replace(/am|pm/gi, "").trim();
    const timeParts = clean.split(":");
    h = Number(timeParts[0] ?? 0);
    m = Number(timeParts[1] ?? 0);

    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  } else {
    const timeParts = t.split(":");
    h = Number(timeParts[0] ?? 0);
    m = Number(timeParts[1] ?? 0);
  }

  h = String(h).padStart(2, "0");
  m = String(m).padStart(2, "0");

  // ✅ REQUIRED by Prokerala
  return `${yyyy}-${mm}-${dd}T${h}:${m}:00+05:30`;
}




export const getAdvancedKundaliReport = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { name, dob, tob, place, ayanamsa = 1, language = "en" } = req.body;

    if (!name || !dob || !tob || !place) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // 1. Check cache
    let cached = userId ? await getCachedKundaliReport(userId, dob, tob, place) : null;
    if (cached) {
      return res.json({ success: true, source: "db", data: cached.report, saved: true });
    }

    // 2. Fetch from Prokerala
    const datetime = toRFC3339(dob, tob);
    const geo = await getCoordinates(place);
    if (!geo) return res.status(400).json({ success: false, message: "Invalid place" });

    const token = await getAccessToken();
    const response = await axios.get("https://api.prokerala.com/v2/astrology/kundli/advanced", {
      params: {
        datetime,
        coordinates: `${geo.latitude},${geo.longitude}`,
        ayanamsa,
        language: "en"
      },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    });

    const reportData = response.data.data;

    // 3. Store in DB
    if (userId) {
      await storeKundaliReport(userId, {
        name, dob, tob, place, coordinates: geo, ayanamsa, language: la
      }, reportData);
    }

    return res.json({ success: true, source: "api_cached", data: reportData });
  } catch (err) {
    console.error("Kundali error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate Kundali",
      details: err.response?.data || err.message
    });
  }
};

// Kundali Compatibility
export const getKundaliCompatibility = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const {
      person1, person2, ayanamsa = 1, la = "en"
    } = req.body;

    const p1 = person1; const p2 = person2;

    // 1. Get or create individual reports
    const report1 = await getOrCreateKundali(userId, p1, ayanamsa, la);
    const report2 = await getOrCreateKundali(userId, p2, ayanamsa, la);

    // 2. Check cached matching
    let cachedMatching = userId ? await getCachedMatching(userId, report1._id, report2._id) : null;
    if (cachedMatching) {
      return res.json({ success: true, source: "db", data: cachedMatching.matchingReport });
    }

    // 3. Call Prokerala matching API
    const token = await getAccessToken();
    const response = await axios.get("https://api.prokerala.com/v2/astrology/kundli-matching", {
      params: {
        girl_dob: toRFC3339(p1.dob, p1.tob),
        girl_coordinates: `${p1.coordinates.lat},${p1.coordinates.lon}`,
        boy_dob: toRFC3339(p2.dob, p2.tob),
        boy_coordinates: `${p2.coordinates.lat},${p2.coordinates.lon}`,
        ayanamsa, la
      },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    });

    const matchingData = response.data.data;

    // 4. Store matching result
    if (userId) {
      await storeKundaliMatching(userId, {
        name: p1.name, dob: p1.dob, tob: p1.tob, place: p1.place, reportId: report1._id
      }, {
        name: p2.name, dob: p2.dob, tob: p2.tob, place: p2.place, reportId: report2._id
      }, matchingData);
    }

    return res.json({ success: true, source: "api_cached", data: matchingData });
  } catch (err) {
    console.error("Matching error:", err);
    return res.status(500).json({ success: false, message: "Matching failed" });
  }
};

// Helper
const getOrCreateKundali = async (userId, person, ayanamsa, la) => {
  const cached = userId ? await getCachedKundaliReport(userId, person.dob, person.tob, person.place) : null;
  if (cached) return cached;

  const geo = await getCoordinates(person.place);
  const datetime = toRFC3339(person.dob, person.tob);
  const token = await getAccessToken();
  const res = await axios.get("https://api.prokerala.com/v2/astrology/kundli/advanced", {
    params: { datetime, coordinates: `${geo.latitude},${geo.longitude}`, ayanamsa, la },
    headers: { Authorization: `Bearer ${token}` }
  });

  return await storeKundaliReport(userId, { ...person, coordinates: geo, ayanamsa, language: la }, res.data.data);
};