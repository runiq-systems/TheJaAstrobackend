import axios from "axios";
import NodeGeocoder from "node-geocoder";
import logger from "../../utils/logger.js";
import DailyHoroscopeSign from "../../models/DailyHoroscopeSign.js";
import { getDailyHoroscopeBySign } from "../../services/prokerala/horoscopeCache.js";
import { getISTDayRange } from "../../utils/date.utils.js";
import { getCachedKundaliReport, storeKundaliReport } from "../../services/prokerala/kundaliReportCache.js";
import { getAccessToken } from "../../services/prokerala/prokeralaToken.services.js";
import { getOrCreateKundliMatch } from "../../services/prokerala/kundaliMatchingCache.js";

// 🌍 Geocoder
const geocoder = NodeGeocoder({ provider: "openstreetmap" });

// ✅ Convert location name → coordinates
export const getCoordinates = async (place) => {
  const res = await geocoder.geocode(place);
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

// function toRFC3339(dob, tob) {
//   if (!dob || !tob) {
//     throw new Error("DOB and TOB required");
//   }

//   let yyyy, mm, dd;

//   // ✅ Handle DD/MM/YYYY
//   if (typeof dob === "string" && dob.includes("/")) {
//     const parts = dob.split("/");
//     if (parts.length !== 3) throw new Error("Invalid DOB format");
//     [dd, mm, yyyy] = parts;
//   }
//   // ✅ Handle YYYY-MM-DD
//   else if (typeof dob === "string" && dob.includes("-")) {
//     const parts = dob.split("-");
//     if (parts.length !== 3) throw new Error("Invalid DOB format");
//     [yyyy, mm, dd] = parts;
//   }
//   // ❌ Anything else
//   else {
//     throw new Error("DOB must be string in DD/MM/YYYY or YYYY-MM-DD");
//   }

//   // Normalize date
//   yyyy = String(yyyy);
//   mm = String(mm).padStart(2, "0");
//   dd = String(dd).padStart(2, "0");

//   // ---- Time ----
//   let h = 0, m = 0;
//   const t = String(tob).toLowerCase().trim();

//   if (t.includes("am") || t.includes("pm")) {
//     const isPM = t.includes("pm");
//     const clean = t.replace(/am|pm/gi, "").trim();
//     const timeParts = clean.split(":");
//     h = Number(timeParts[0] ?? 0);
//     m = Number(timeParts[1] ?? 0);

//     if (isPM && h < 12) h += 12;
//     if (!isPM && h === 12) h = 0;
//   } else {
//     const timeParts = t.split(":");
//     h = Number(timeParts[0] ?? 0);
//     m = Number(timeParts[1] ?? 0);
//   }

//   h = String(h).padStart(2, "0");
//   m = String(m).padStart(2, "0");

//   // ✅ REQUIRED by Prokerala
//   return `${yyyy}-${mm}-${dd}T${h}:${m}:00+05:30`;
// }


// export const toRFC3340 = (dob, tob) => {
//   // dob: "YYYY-MM-DD"
//   // tob: "HH:MM" (24-hour)
//   const [year, month, day] = dob.split('-').map(Number);
//   const [hour, minute] = tob.split(':').map(Number);

//   const date = new Date(Date.UTC(year, month - 1, day, hour, minute));

//   // Prokerala expects ISO with +05:30 offset for India
//   return date.toISOString().replace('Z', '+05:30');
// };
function toRFC3339(dob, tob) {
  if (!dob || !tob) throw new Error("DOB and TOB required");

  let yyyy, mm, dd;
  if (dob.includes("/")) {
    [dd, mm, yyyy] = dob.split("/");
  } else if (dob.includes("-")) {
    [yyyy, mm, dd] = dob.split("-");
  } else {
    throw new Error("Invalid DOB format");
  }

  yyyy = yyyy.padStart(4, "0");
  mm = mm.padStart(2, "0");
  dd = dd.padStart(2, "0");

  let h = 0, m = 0;
  const t = String(tob).trim().toLowerCase();

  if (t.includes("am") || t.includes("pm")) {
    const isPM = t.includes("pm");
    const clean = t.replace(/am|pm/gi, "").trim();
    [h, m] = clean.split(":").map(Number);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  } else {
    [h, m] = t.split(":").map(Number);
  }

  const hh = String(h).padStart(2, "0");
  const mmTime = String(m).padStart(2, "0");

  // ✅ This format works 99% of the time with Prokerala
  return `${yyyy}-${mm}-${dd}T${hh}:${mmTime}:00+05:30`;
}
export const toRFC3340 = (dob, tob) => {
  // dob: "YYYY-MM-DD"
  // tob: "HH:MM" (24-hour format)
  const [year, month, day] = dob.split('-').map(Number);
  let [hour, minute, second = 0] = tob.includes(':') ? tob.split(':').map(Number) : [0, 0];

  // Ensure always HH:MM:SS
  const yyyy = year.toString().padStart(4, '0');
  const mm = month.toString().padStart(2, '0');
  const dd = day.toString().padStart(2, '0');
  const hh = hour.toString().padStart(2, '0');
  const min = minute.toString().padStart(2, '0');
  const sec = second.toString().padStart(2, '0');

  // Exact format: YYYY-MM-DDTHH:MM:SS+05:30 (no milliseconds, no space)
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:30`;
};

export const getAdvancedKundaliReport = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    console.log(userId)
    const { name, dob, tob, place, ayanamsa = 1, la = "en" } = req.body;

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
        language: la
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

export const getKundliMatch = async (req, res) => {
  try {
    const { 
      person1_name, person1_dob, person1_tob, person1_place,
      person2_name, person2_dob, person2_tob, person2_place,
      ayanamsa = 1, language = 'en'
    } = req.body;

    const userId = req.user.id;

    // Validate
    const errors = [];
    if (!person1_name || !person1_dob || !person1_tob || !person1_place ) {
      errors.push('Person 1 details incomplete');
    }
    if (!person2_name || !person2_dob || !person2_tob || !person2_place ) {
      errors.push('Person 2 details incomplete');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        errors
      });
    }

    // Prepare person objects
    const person1 = {
      name: person1_name,
      dob: person1_dob,
      tob: person1_tob,
      place: person1_place
    };

    const person2 = {
      name: person2_name,
      dob: person2_dob,
      tob: person2_tob,
      place: person2_place
    };

    // Get match report
    const result = await getOrCreateKundliMatch(
      userId,
      person1,
      person2,
      parseInt(ayanamsa),
      language
    );

    console.log(result.data)

    return res.json({
      success: true,
      source: result.source,
      data: result.data
    });

  } catch (error) {
    console.error('Kundli Matching Error:', error);
    
    return res.status(500).json({
      success: false,
      message: error.message.includes('API') 
        ? 'Failed to fetch from astrology service. Please try again later.'
        : 'Internal server error'
    });
  }
};

// Get user's match history
const getMatchHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    const matches = await kundliMatchingService.getUserMatches(userId, parseInt(limit), parseInt(skip));
    
    return res.json({
      success: true,
      data: matches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: matches.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Match History Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch match history'
    });
  }
};
 