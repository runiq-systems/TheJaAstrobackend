import axios from "axios";
import { getCoordinates, toRFC3340 } from "../../controllers/Astrologycontroller/astrologyController.js";
import { KundaliMatching } from "../../models/kundaliMatching.js";
import { getAccessToken } from "./prokeralaToken.services.js";

function createMatchHash(person1, person2) {
  const normalize = (str) =>
    (str || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')     // collapse multiple spaces to single
      .replace(/[^a-z0-9-]/g, ''); // remove all special chars except letters/numbers/hyphen

  const hash1 = `${normalize(person1.name)}-${normalize(person1.dob)}-${normalize(person1.tob)}-${normalize(person1.place)}`;
  const hash2 = `${normalize(person2.name)}-${normalize(person2.dob)}-${normalize(person2.tob)}-${normalize(person2.place)}`;

  const sorted = [hash1, hash2].sort();
  return sorted.join('_');
}

async function fetchKundliMatching(girlData, boyData, ayanamsa = 1, language = 'en') {
  try {
    // Get coordinates if not provided
    const girlCoords = girlData.coordinates || (await getCoordinates(girlData.place));
    const boyCoords = boyData.coordinates || (await getCoordinates(boyData.place));
    const token = await getAccessToken()


    const params = {
      ayanamsa,
      la: language,
      girl_dob: toRFC3340(girlData.dob, girlData.tob),
      girl_coordinates: `${girlCoords.latitude},${girlCoords.longitude}`,
      boy_dob: toRFC3340(boyData.dob, boyData.tob),
      boy_coordinates: `${boyCoords.latitude},${boyCoords.longitude}`,
    };

    const response = await axios.get('https://api.prokerala.com/v2/astrology/kundli-matching/advanced', {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000, // 10s timeout
    });

    return response.data; // { status: "ok", data: {...} }
  } catch (error) {
    console.error('Prokerala API Error:', error.response?.data || error.message);
    throw new Error(`Failed to fetch kundli matching: ${error.message}`);
  }
}

// Main function: Get or create matching report (cached in DB)
export async function getOrCreateKundliMatch(userId, person1, person2, ayanamsa = 1, language = 'en') {
  // Create unique hash for this pair
  const matchHash = createMatchHash(person1, person2);

  // 1. Check if already exists in DB
  const existing = await KundaliMatching.findOne({ match_hash: matchHash });
  if (existing) {
    return {
      source: 'database',
      data: existing,
    };
  }

  // 2. Fetch fresh from API
  const apiData = await fetchKundliMatching(person1, person2, ayanamsa, language);

  // 3. Store in DB
  const savedReport = await new KundaliMatching({
    userId,
    person1: {
      name: person1.name,
      dob: person1.dob,
      tob: person1.tob,
      place: person1.place,
      coordinates: person1.coordinates || (await getCoordinates(person1.place)),
    },
    person2: {
      name: person2.name,
      dob: person2.dob,
      tob: person2.tob,
      place: person2.place,
      coordinates: person2.coordinates || (await getCoordinates(person2.place)),
    },
    matchingReport: apiData.data, // store the inner "data" object
    ayanamsa,
    language,
    match_hash: matchHash,
    source: 'api',
    generatedAt: new Date(),
  }).save();

  return {
    source: 'api',
    data: savedReport,
  };
}

// Get all matches for a user
export async function getUserMatches(userId, limit, skip) {
  return KundaliMatching.find({ userId })
    .sort({ generatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

export async function getUserMatchesCount(userId) {
  return KundaliMatching.countDocuments({ userId });
}



export async function getMatchById(matchId, userId) {
  if (!mongoose.Types.ObjectId.isValid(matchId)) {
    return null;
  }

  return KundaliMatching.findOne({
    _id: matchId,
    userId, // 🔒 security: user sirf apna data dekh sake
  }).lean();
}

// Search matches by name
export async function searchMatches(userId, searchTerm) {
  return await KundaliMatching.find({
    userId,
    $or: [
      { 'person1.name': new RegExp(searchTerm, 'i') },
      { 'person2.name': new RegExp(searchTerm, 'i') },
    ],
  })
    .sort({ generatedAt: -1 })
    .limit(10)
    .lean();
}
