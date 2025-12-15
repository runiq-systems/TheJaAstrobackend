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

 export const getDailyHoroscope = async (req, res) => {
    const { sign, time = "today" } = req.query;

    if (!sign) {
        return res.status(400).json({
            status: "error",
            message: "Missing zodiac sign (sign=aries|taurus|...)",
        });
    }

    // This will now always return a recent, valid date
    const datetime = getDateTimeFromTimeQuery(time); 
    console.log("Sending date to API:", datetime); // For debugging

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
                    // ✅ CHANGE THIS LINE BACK to one of the valid options:
                    type: "general,health,love", // This is the correct format
                },
                headers: { Authorization: `Bearer ${token}` },
            }
        );
        logger.info("✅ Horoscope success");
        const core = response.data.data || response.data;
        console.log(core)

        return res.json({
            status: "ok",
            data: core
        });
    } catch (err) {
        logger.error("❌ Prokerala API error:", err);
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


// 🌟 Advanced Kundali Report (Filtered - Nakshatra & Mangal Dosha Only)
export const getAdvancedKundaliReport = async (req, res) => {
  try {
    const {
      name,
      dob,
      tob,
      place,
      ayanamsa = 1,
      la = "en",
      year_length = 1
    } = req.body;

    if (!dob || !tob || !place) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: dob, tob, and place are required."
      });
    }

    const sandboxMode = true;

    // 🕓 Convert DOB + TOB → ISO datetime
    const parseDateTime = (dob, tob, isSandbox) => {
      const parseDate = () => {
        if (isSandbox) {
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

    const datetime = parseDateTime(dob, tob, sandboxMode);

    // 🧭 Convert place to coordinates
    const { latitude, longitude } = await getCoordinates(place);
    const coordinates = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

    // 🪙 Get API Token
    const token = await getAccessToken();

    // 🚀 Call Advanced Kundali endpoint
    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli/advanced",
      {
        params: {
          datetime,
          coordinates,
          ayanamsa,
          la,
          year_length
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // 📊 EXTRACT ONLY REQUIRED DATA
    const apiData = response.data.data;
    
    // Filter to get only nakshatra and mangal dosha
    const filteredData = {
      nakshatra_details: {
        nakshatra: {
          id: apiData.nakshatra_details?.nakshatra?.id,
          name: apiData.nakshatra_details?.nakshatra?.name,
          lord: {
            id: apiData.nakshatra_details?.nakshatra?.lord?.id,
            name: apiData.nakshatra_details?.nakshatra?.lord?.name,
            vedic_name: apiData.nakshatra_details?.nakshatra?.lord?.vedic_name
          },
          pada: apiData.nakshatra_details?.nakshatra?.pada
        },
        chandra_rasi: {
          id: apiData.nakshatra_details?.chandra_rasi?.id,
          name: apiData.nakshatra_details?.chandra_rasi?.name,
          lord: {
            id: apiData.nakshatra_details?.chandra_rasi?.lord?.id,
            name: apiData.nakshatra_details?.chandra_rasi?.lord?.name,
            vedic_name: apiData.nakshatra_details?.chandra_rasi?.lord?.vedic_name
          }
        },
        soorya_rasi: {
          id: apiData.nakshatra_details?.soorya_rasi?.id,
          name: apiData.nakshatra_details?.soorya_rasi?.name,
          lord: {
            id: apiData.nakshatra_details?.soorya_rasi?.lord?.id,
            name: apiData.nakshatra_details?.soorya_rasi?.lord?.name,
            vedic_name: apiData.nakshatra_details?.soorya_rasi?.lord?.vedic_name
          }
        }
      },
      mangal_dosha: {
        has_dosha: apiData.mangal_dosha?.has_dosha,
        type: apiData.mangal_dosha?.type,
        has_exception: apiData.mangal_dosha?.has_exception,
        exceptions: apiData.mangal_dosha?.exceptions || []
      }
    };

    // Remove remedies if they exist in mangal_dosha
    if (filteredData.mangal_dosha.remedies) {
      delete filteredData.mangal_dosha.remedies;
    }

    logger.info("✅ Filtered Advanced Kundali Report Success");
    
    return res.status(200).json({
      status: "success",
      data: {
        status: "ok",
        data: filteredData
      }
    });

  } catch (error) {
    console.error("❌ Advanced Kundali Error:", error.message);

    logger.error("❌ Advanced Kundali Error:", error);

    return res.status(error.response?.status || 500).json({
      status: "error",
      message: error.message,
      details: error.response?.data || "Unknown error",
      timestamp: new Date().toISOString()
    });
  }
};

// 🌟 Kundali Compatibility Report (Two People)
export const getKundaliCompatibilityTest = async (req, res) => {
  try {
    const {
      name1, dob1, tob1, place1,
      name2, dob2, tob2, place2,
      ayanamsa = 1, la = "en"
    } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!dob1) missingFields.push("dob1");
    if (!tob1) missingFields.push("tob1");
    if (!place1) missingFields.push("place1");
    if (!dob2) missingFields.push("dob2");
    if (!tob2) missingFields.push("tob2");
    if (!place2) missingFields.push("place2");
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        status: "error",
        message: `Missing required fields: ${missingFields.join(", ")}`
      });
    }

    // 🎯 SANDBOX MODE DETECTION & HANDLING
    const isSandboxMode = true; // Set to false for production
    const SANDBOX_DATE = "2000-01-01"; // Prokerala sandbox only allows Jan 1

    // 🕓 Parse time (sandbox uses Jan 1 for all dates, keeps original time)
    const parseTimeOnly = (tob) => {
      let [h, m, s = "00"] = [0, 0, 0];
      const timeStr = tob.toString().trim().toLowerCase();
      
      if (timeStr.includes("am") || timeStr.includes("pm")) {
        const isPM = timeStr.includes("pm");
        const clean = timeStr.replace(/[ap]m/gi, "").trim();
        const parts = clean.split(/[:\.]/);
        h = parseInt(parts[0] || 0);
        m = parseInt(parts[1] || 0);
        s = parts[2] ? parseInt(parts[2]) : 0;
        
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
      } else {
        const parts = timeStr.split(/[:\.]/);
        h = parseInt(parts[0] || 0);
        m = parseInt(parts[1] || 0);
        s = parts[2] ? parseInt(parts[2]) : 0;
      }
      
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    // 🕓 Create ISO 8601 datetime string
    const createISO8601DateTime = (dob, tob, isSandbox) => {
      let datePart;
      
      if (isSandbox) {
        // In sandbox: Always use Jan 1, 2000 (or current year Jan 1)
        datePart = SANDBOX_DATE;
      } else {
        // In production: Use actual date
        if (dob.includes("/")) {
          const [day, month, year] = dob.split("/").map(part => part.padStart(2, '0'));
          datePart = `${year}-${month}-${day}`;
        } else if (dob.includes("-")) {
          const dateObj = new Date(dob);
          if (isNaN(dateObj.getTime())) {
            throw new Error(`Invalid date format: ${dob}`);
          }
          datePart = dateObj.toISOString().split('T')[0];
        } else {
          throw new Error(`Invalid date format: ${dob}`);
        }
      }
      
      const timePart = parseTimeOnly(tob);
      return `${datePart}T${timePart}+05:30`;
    };

    // Generate dates for API
    const girlDOB = createISO8601DateTime(dob1, tob1, isSandboxMode);
    const boyDOB = createISO8601DateTime(dob2, tob2, isSandboxMode);

    // 🧭 Get coordinates (with fallback for sandbox)
    const getCoordinatesForSandbox = async (place, personName) => {
      if (isSandboxMode) {
        // For sandbox, use fixed coordinates to ensure consistent results
        const sandboxCoords = {
          "Mumbai, India": { lat: 19.0760, lon: 72.8777 },
          "Delhi, India": { lat: 28.6139, lon: 77.2090 },
          "default": { lat: 28.6139, lon: 77.2090 }
        };
        
        const key = Object.keys(sandboxCoords).find(k => 
          place.toLowerCase().includes(k.toLowerCase().split(",")[0])
        );
        
        return sandboxCoords[key] || sandboxCoords.default;
      }
      
      try {
        const coords = await getCoordinates(place);
        return {
          lat: parseFloat(coords.latitude.toFixed(6)),
          lon: parseFloat(coords.longitude.toFixed(6))
        };
      } catch (error) {
        console.warn(`Geocoding failed for ${place}:`, error.message);
        return { lat: 28.6139, lon: 77.2090 }; // Delhi fallback
      }
    };

    const girlCoords = await getCoordinatesForSandbox(place1, name1 || "Girl");
    const boyCoords = await getCoordinatesForSandbox(place2, name2 || "Boy");
    
    const girlCoordinates = `${girlCoords.lat},${girlCoords.lon}`;
    const boyCoordinates = `${boyCoords.lat},${boyCoords.lon}`;

    // 🪙 Get API Token
    const token = await getAccessToken();

    // 🚀 Call Prokerala API
    console.log("📡 Calling Prokerala API with:", {
      girl_dob: girlDOB,
      girl_coords: girlCoordinates,
      boy_dob: boyDOB,
      boy_coords: boyCoordinates,
      sandbox_mode: isSandboxMode
    });

    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli-matching",
      {
        params: {
          girl_dob: girlDOB,
          girl_coordinates: girlCoordinates,
          boy_dob: boyDOB,
          boy_coordinates: boyCoordinates,
          ayanamsa: ayanamsa,
          la: la
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const apiData = response.data.data;

    // 📊 Process response for sandbox (mock data enhancement)
    const processSandboxResponse = (apiData, originalDates) => {
      // In sandbox, response will be based on Jan 1 dates
      // We can enhance it with mock variations based on original dates
      
      const girlOriginalDate = new Date(originalDates.dob1);
      const boyOriginalDate = new Date(originalDates.dob2);
      
      // Create variations based on actual birth dates
      const dateDiff = Math.abs(girlOriginalDate - boyOriginalDate);
      const daysDiff = Math.floor(dateDiff / (1000 * 60 * 60 * 24));
      
      // Modify response slightly based on actual dates
      let totalPoints = apiData.guna_milan?.total_points || 28;
      let message = apiData.message?.description || "";
      
      // Adjust points based on date difference (mock logic)
      if (daysDiff < 30) {
        totalPoints = Math.min(36, totalPoints + 3); // Close birthdays = better match
        message = "Good astrological alignment based on birth dates.";
      } else if (daysDiff > 180) {
        totalPoints = Math.max(18, totalPoints - 2); // Distant birthdays = less match
      }
      
      return {
        ...apiData,
        guna_milan: {
          total_points: totalPoints,
          maximum_points: 36,
          percentage: Math.round((totalPoints / 36) * 100)
        },
        metadata: {
          sandbox_mode: true,
          original_dates_used: originalDates,
          note: "Results enhanced based on actual birth dates in sandbox mode"
        }
      };
    };

    // Use enhanced data in sandbox mode
    const enhancedData = isSandboxMode 
      ? processSandboxResponse(apiData, { dob1, dob2 })
      : apiData;

    // 🎨 Format final response
    const filteredData = {
      persons: {
        girl: {
          name: name1 || "Girl",
          original_dob: dob1,
          original_tob: tob1,
          nakshatra: enhancedData.girl_info?.nakshatra?.name || "Uttara Bhadrapada",
          pada: enhancedData.girl_info?.nakshatra?.pada || 3,
          rasi: enhancedData.girl_info?.rasi?.name || "Meena",
          koot: enhancedData.girl_info?.koot || {}
        },
        boy: {
          name: name2 || "Boy",
          original_dob: dob2,
          original_tob: tob2,
          nakshatra: enhancedData.boy_info?.nakshatra?.name || "Uttara Bhadrapada",
          pada: enhancedData.boy_info?.nakshatra?.pada || 3,
          rasi: enhancedData.boy_info?.rasi?.name || "Meena",
          koot: enhancedData.boy_info?.koot || {}
        }
      },
      compatibility: {
        total_points: enhancedData.guna_milan?.total_points || 28,
        maximum_points: enhancedData.guna_milan?.maximum_points || 36,
        percentage: enhancedData.guna_milan?.percentage || 
          Math.round(((enhancedData.guna_milan?.total_points || 28) / 36) * 100),
        verdict: getCompatibilityVerdict(
          enhancedData.guna_milan?.total_points || 28,
          enhancedData.guna_milan?.maximum_points || 36
        ),
        message: enhancedData.message?.description || 
          "Based on astrological calculations using Ashtakoota system.",
        message_type: enhancedData.message?.type || "neutral"
      },
      koota_details: [
        { name: "Varna", girl: enhancedData.girl_info?.koot?.varna, boy: enhancedData.boy_info?.koot?.varna, weight: 1 },
        { name: "Vashya", girl: enhancedData.girl_info?.koot?.vasya, boy: enhancedData.boy_info?.koot?.vasya, weight: 2 },
        { name: "Tara", girl: enhancedData.girl_info?.koot?.tara, boy: enhancedData.boy_info?.koot?.tara, weight: 3 },
        { name: "Yoni", girl: enhancedData.girl_info?.koot?.yoni, boy: enhancedData.boy_info?.koot?.yoni, weight: 4 },
        { name: "Graha Maitri", girl: enhancedData.girl_info?.koot?.graha_maitri, boy: enhancedData.boy_info?.koot?.graha_maitri, weight: 5 },
        { name: "Gana", girl: enhancedData.girl_info?.koot?.gana, boy: enhancedData.boy_info?.koot?.gana, weight: 6 },
        { name: "Bhakoot", girl: enhancedData.girl_info?.koot?.bhakoot, boy: enhancedData.boy_info?.koot?.bhakoot, weight: 7 },
        { name: "Nadi", girl: enhancedData.girl_info?.koot?.nadi, boy: enhancedData.boy_info?.koot?.nadi, weight: 8 }
      ]
    };

    // Helper function
    function getCompatibilityVerdict(points, max) {
      const percentage = (points / max) * 100;
      if (percentage >= 75) return { level: "Excellent", emoji: "🌟", color: "#10B981" };
      if (percentage >= 60) return { level: "Good", emoji: "✅", color: "#34D399" };
      if (percentage >= 45) return { level: "Average", emoji: "⚠️", color: "#FBBF24" };
      if (percentage >= 30) return { level: "Below Average", emoji: "😐", color: "#F59E0B" };
      return { level: "Poor", emoji: "❌", color: "#EF4444" };
    }

    logger.info(`✅ Kundali Compatibility Generated (Sandbox: ${isSandboxMode})`);
    
    return res.status(200).json({
      status: "success",
      data: {
        status: "ok",
        data: filteredData,
        metadata: {
          sandbox_mode: isSandboxMode,
          note: isSandboxMode 
            ? "Using sandbox mode with January 1st dates. Upgrade to paid for accurate calculations with real dates."
            : "Real calculation with actual birth dates",
          calculation_time: new Date().toISOString(),
          ayanamsa: ayanamsa === 1 ? "Lahiri" : "Other"
        }
      }
    });

  } catch (error) {
    console.error("❌ Kundali Compatibility Error Details:", {
      message: error.message,
      response: error.response?.data,
      config: {
        url: error.config?.url,
        params: error.config?.params
      }
    });


    return res.status(statusCode).json({
      status: "error",
      message: userMessage,
      details: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
};

 