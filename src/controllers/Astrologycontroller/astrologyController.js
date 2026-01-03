
import DailyHoroscopeSign from "../../models/DailyHoroscopeSign.js";
import { getDailyHoroscopeBySign } from "../../services/prokerala/horoscopeCache.js";
import { getISTDayRange } from "../../utils/date.utils.js";
import { getCachedKundaliReport, storeKundaliReport, getExistingKundaliReportAll, getKundaliReportDetail } from "../../services/prokerala/kundaliReportCache.js";
import { getAccessToken } from "../../services/prokerala/prokeralaToken.services.js";
import { getOrCreateKundliMatch, getUserMatches, getUserMatchesCount, getMatchById } from "../../services/prokerala/kundaliMatchingCache.js";
import axios from "axios";
import logger from "../../utils/logger.js";


export const getCoordinates = async (place) => {
  if (!place || typeof place !== "string") {
    throw new Error("Place is required");
  }

  const res = await axios.get(
    "https://geocoding-api.open-meteo.com/v1/search",
    {
      params: {
        name: place.trim(),
        count: 1,
        language: "en",
        format: "json",
      },
      timeout: 8000,
    }
  );

  // ✅ LOG ONLY DATA
  logger.info("Geocoding response:", res.data);

  // ✅ CORRECT CHECK
  if (!res.data?.results || res.data.results.length === 0) {
    throw new Error("Location not found");
  }

  const loc = res.data.results[0];

  return {
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    displayName: `${loc.name}, ${loc.admin1}, ${loc.country}`,
  };
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
// utils/dateFormatter.js
export const toRFC3340 = (dob, tob, timezoneOffset = '+05:30') => {
  try {
    // Clean inputs
    const cleanDob = dob.trim();
    const cleanTob = tob.trim();

    // Parse date
    const [year, month, day] = cleanDob.split('-').map(num => parseInt(num, 10));

    // Parse time - handle various formats
    let hour = 0, minute = 0, second = 0;

    if (cleanTob.includes(':')) {
      const timeParts = cleanTob.split(':').map(num => parseInt(num, 10));
      hour = timeParts[0] || 0;
      minute = timeParts[1] || 0;
      second = timeParts[2] || 0;
    } else if (cleanTob.length === 4) {
      // Handle "HHMM" format
      hour = parseInt(cleanTob.substring(0, 2), 10) || 0;
      minute = parseInt(cleanTob.substring(2, 4), 10) || 0;
    }

    // Validate ranges
    if (hour < 0 || hour > 23) hour = 0;
    if (minute < 0 || minute > 59) minute = 0;
    if (second < 0 || second > 59) second = 0;

    // Create ISO string with timezone
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

    // Format manually to ensure correct format
    const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
    const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const min = date.getUTCMinutes().toString().padStart(2, '0');
    const ss = date.getUTCSeconds().toString().padStart(2, '0');

    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${timezoneOffset}`;
  } catch (error) {
    console.error('Date formatting error:', error);
    // Fallback to simple format
    return `${dob}T${tob.includes(':') ? tob : '00:00'}${timezoneOffset}`;
  }
};

// export const getAdvancedKundaliReport = async (req, res) => {
//   try {
//     const userId = req.user.id || req.user._id;
//     console.log(userId)
//     const { name, dob, tob, latitude, longitude, ayanamsa = 1, la = "en" } = req.body;

//     if (!name || !dob || !tob || !place) {
//       return res.status(400).json({ success: false, message: "Missing required fields" });
//     }

//     // 1. Check cache
//     let cached = userId ? await getCachedKundaliReport(userId, dob, tob, place) : null;
//     if (cached) {
//       return res.json({ success: true, source: "db", data: cached.report, saved: true });
//     }

//     // 2. Fetch from Prokerala
//     const datetime = toRFC3339(dob, tob);


//     const token = await getAccessToken();
//     const response = await axios.get("https://api.prokerala.com/v2/astrology/kundli/advanced", {
//       params: {
//         datetime,
//         coordinates: `${latitude},${longitude}`,
//         ayanamsa,
//         language: la
//       },
//       headers: { Authorization: `Bearer ${token}` },
//       timeout: 8000
//     });

//     const reportData = response.data.data;

//     // 3. Store in DB
//     if (userId) {
//       await storeKundaliReport(userId, {
//         name, dob, tob, place, coordinates: geo, ayanamsa, language: la
//       }, reportData);
//     }

//     return res.json({ success: true, source: "api_cached", data: reportData });
//   } catch (err) {
//     console.error("Kundali error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to generate Kundali",
//       details: err.response?.data || err.message
//     });
//   }
// };



export const getAdvancedKundaliReport = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    const {
      name,
      dob,
      tob,
      latitude,
      longitude,
      place,
      ayanamsa = 1,
      la = "en",
    } = req.body;

    // -------------------------
    // VALIDATION
    // -------------------------
    if (!name || !dob || !tob || latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        message: "name, dob, tob, latitude, longitude are required",
      });
    }

    const coordinates = {
      latitude: Number(latitude),
      longitude: Number(longitude),
    };

    // -------------------------
    // CACHE CHECK
    // -------------------------
    let cached = null;
    if (userId) {
      cached = await getCachedKundaliReport(
        userId,
        dob,
        tob,
        place,
        coordinates
      );
    }

    if (cached) {
      return res.json({
        success: true,
        source: "db",
        saved: true,
        data: cached.report,
      });
    }

    // -------------------------
    // API CALL
    // -------------------------
    const datetime = toRFC3339(dob, tob);
    const token = await getAccessToken();

    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli/advanced",
      {
        params: {
          datetime,
          coordinates: `${coordinates.latitude},${coordinates.longitude}`,
          ayanamsa,
          language: la,
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      }
    );

    const reportData = response.data.data;

    // -------------------------
    // STORE CACHE
    // -------------------------
    if (userId) {
      await storeKundaliReport(userId, {
        name,
        dob,
        tob,
        place,
        coordinates,
        ayanamsa,
        language: la,
      }, reportData);
    }

    return res.json({
      success: true,
      source: "api",
      saved: false,
      data: reportData,
    });

  } catch (err) {
    console.error("Kundali error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate Kundali",
      details: err.response?.data || err.message,
    });
  }
};

export const getKundliMatch = async (req, res) => {
  try {
    const {
      person1_name, person1_dob, person1_tob, person1_latitude, person1_longitude, person1_places,
      person2_name, person2_dob, person2_tob, person2_latitude, person2_longitude, person2_places,
      ayanamsa = 1, language = 'en'
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    const errors = [];
    if (!person1_name || !person1_dob || !person1_tob || !person1_latitude || !person1_longitude) {
      errors.push('Person 1 details incomplete');
    }
    if (!person2_name || !person2_dob || !person2_tob || !person2_latitude || !person2_longitude) {
      errors.push('Person 2 details incomplete');
    }

    // Validate date formats
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (person1_dob && !dateRegex.test(person1_dob)) {
      errors.push('Person 1 date of birth must be in YYYY-MM-DD format');
    }
    if (person2_dob && !dateRegex.test(person2_dob)) {
      errors.push('Person 2 date of birth must be in YYYY-MM-DD format');
    }

    // Validate time formats
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (person1_tob && !timeRegex.test(person1_tob)) {
      errors.push('Person 1 time of birth must be in HH:MM or HH:MM:SS format (24-hour)');
    }
    if (person2_tob && !timeRegex.test(person2_tob)) {
      errors.push('Person 2 time of birth must be in HH:MM or HH:MM:SS format (24-hour)');
    }

    // Validate coordinates
    const coordRegex = /^-?\d+(\.\d+)?$/;
    if (person1_latitude && !coordRegex.test(person1_latitude)) {
      errors.push('Person 1 latitude must be a valid number');
    }
    if (person1_longitude && !coordRegex.test(person1_longitude)) {
      errors.push('Person 1 longitude must be a valid number');
    }
    if (person2_latitude && !coordRegex.test(person2_latitude)) {
      errors.push('Person 2 latitude must be a valid number');
    }
    if (person2_longitude && !coordRegex.test(person2_longitude)) {
      errors.push('Person 2 longitude must be a valid number');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        errors
      });
    }

    // Prepare person objects with validation
    const person1 = {
      name: person1_name.trim(),
      dob: person1_dob.trim(),
      tob: person1_tob.trim(),
      place: person1_places?.trim() || '',
      coordinates: {
        latitude: parseFloat(Number(person1_latitude).toFixed(6)),
        longitude: parseFloat(Number(person1_longitude).toFixed(6)),
      },
    };

    const person2 = {
      name: person2_name.trim(),
      dob: person2_dob.trim(),
      tob: person2_tob.trim(),
      place: person2_places?.trim() || '',
      coordinates: {
        latitude: parseFloat(Number(person2_latitude).toFixed(6)),
        longitude: parseFloat(Number(person2_longitude).toFixed(6)),
      },
    };

    // Get match report
    const result = await getOrCreateKundliMatch(
      userId,
      person1,
      person2,
      parseInt(ayanamsa),
      language
    );

    return res.json({
      success: true,
      source: result.source,
      data: result.data
    });

  } catch (error) {
    console.error('Kundli Matching Controller Error:', {
      message: error.message,
      stack: error.stack
    });

    // Handle specific error types
    let statusCode = 500;
    let errorMessage = 'Internal server error';

    if (error.message.includes('API Error') || error.message.includes('Prokerala')) {
      statusCode = 400;
      errorMessage = error.message.replace('Prokerala API Error: ', '');
    } else if (error.message.includes('timeout')) {
      statusCode = 408;
      errorMessage = 'Request timeout. Please try again.';
    } else if (error.message.includes('validation') || error.message.includes('Invalid')) {
      statusCode = 400;
      errorMessage = error.message;
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage
    });
  }
};

// Get user's match history
export const getMatchHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    let limit = parseInt(req.query.limit) || 20;
    let page = parseInt(req.query.page) || 1;

    // Safety checks
    limit = Math.min(limit, 50); // max limit protection
    page = Math.max(page, 1);

    const skip = (page - 1) * limit;

    const [matches, total] = await Promise.all([
      getUserMatches(userId, limit, skip),
      getUserMatchesCount(userId),
    ]);

    return res.status(200).json({
      success: true,
      data: matches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + matches.length < total,
      },
    });
  } catch (error) {
    console.error("Match History Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch match history",
    });
  }
};



export const getMatchDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required",
      });
    }

    const match = await getMatchById(matchId, userId);

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: match,
    });
  } catch (error) {
    console.error("Get Match Details Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch match details",
    });
  }
};



export const getUserKundaliReports = async (req, res) => {
  try {
    const { dob, tob, place, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const result = await getExistingKundaliReportAll({
      userId,
      dob,
      tob,
      place,
      page: Number(page),
      limit: Number(limit),
    });

    return res.status(200).json({
      ok: true,
      message: "User kundali reports fetched successfully",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message,
    });
  }
};


export const getKundaliReportDetailController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const data = await getKundaliReportDetail({
      reportId: id,
      userId,
    });

    return res.status(200).json({
      ok: true,
      message: "Kundali report detail fetched successfully",
      data,
    });
  } catch (error) {
    return res.status(404).json({
      ok: false,
      message: error.message,
    });
  }
};
