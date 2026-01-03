import axios from "axios";
import { getCoordinates, toRFC3340 } from "../../controllers/Astrologycontroller/astrologyController.js";
import { KundaliMatching } from "../../models/kundaliMatching.js";
import { getAccessToken } from "./prokeralaToken.services.js";

function createMatchHash(person1, person2) {
  const normalize = (v) =>
    String(v ?? "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9.-]/g, "");

  const p = (p) =>
    `${normalize(p.name)}-${p.dob}-${p.tob}-${normalize(p.coordinates.latitude)}-${normalize(p.coordinates.longitude)}`;

  return [p(person1), p(person2)].sort().join("_");
}

async function fetchKundliMatching(girlData, boyData, ayanamsa = 1, language = "en") {
  const token = await getAccessToken();

  const params = {
    ayanamsa,
    la: language,
    girl_dob: toRFC3340(girlData.dob, girlData.tob),
    girl_coordinates: `${girlData.coordinates.latitude},${girlData.coordinates.longitude}`,
    boy_dob: toRFC3340(boyData.dob, boyData.tob),
    boy_coordinates: `${boyData.coordinates.latitude},${boyData.coordinates.longitude}`,
  };

  const response = await axios.get(
    "https://api.prokerala.com/v2/astrology/kundli-matching/advanced",
    {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    }
  );

  return response.data;
}


// Main function: Get or create matching report (cached in DB)
export async function getOrCreateKundliMatch(
  userId,
  person1,
  person2,
  ayanamsa = 1,
  language = "en"
) {
  const matchHash = createMatchHash(person1, person2);

  const existing = await KundaliMatching.findOne({ match_hash: matchHash }).lean();
  if (existing) {
    return { source: "database", data: existing };
  }

  const apiData = await fetchKundliMatching(person1, person2, ayanamsa, language);

  const saved = await KundaliMatching.create({
    userId,
    person1,
    person2,
    matchingReport: apiData.data,
    ayanamsa,
    language,
    match_hash: matchHash,
    source: "api",
    generatedAt: new Date(),
  });

  return { source: "api", data: saved };
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
