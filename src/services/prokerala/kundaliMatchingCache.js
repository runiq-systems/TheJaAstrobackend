// services/prokerala/kundaliMatchingCache.js
import axios from "axios";
import mongoose from "mongoose";
import { toRFC3340 } from "../../utils/dateFormatter.js";
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
    `${normalize(p.name)}-${p.dob}-${p.tob}-${normalize(p.coordinates.latitude.toFixed(6))}-${normalize(p.coordinates.longitude.toFixed(6))}`;

  return [p(person1), p(person2)].sort().join("_");
}

async function fetchKundliMatching(girlData, boyData, ayanamsa = 1, language = "en") {
  try {
    const token = await getAccessToken();

    // Format dates properly
    const girlDob = toRFC3340(girlData.dob, girlData.tob);
    const boyDob = toRFC3340(boyData.dob, boyData.tob);

    // Format coordinates with proper precision
    const girlCoords = `${Number(girlData.coordinates.latitude).toFixed(6)},${Number(girlData.coordinates.longitude).toFixed(6)}`;
    const boyCoords = `${Number(boyData.coordinates.latitude).toFixed(6)},${Number(boyData.coordinates.longitude).toFixed(6)}`;

    console.log('API Request params:', {
      girl_dob: girlDob,
      girl_coordinates: girlCoords,
      boy_dob: boyDob,
      boy_coordinates: boyCoords
    });

    const params = {
      ayanamsa,
      la: language,
      girl_dob: girlDob,
      girl_coordinates: girlCoords,
      boy_dob: boyDob,
      boy_coordinates: boyCoords,
    };

    const response = await axios.get(
      "https://api.prokerala.com/v2/astrology/kundli-matching/advanced",
      {
        params,
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 15000, // Increased timeout
        validateStatus: (status) => status >= 200 && status < 500
      }
    );

    console.log('API Response status:', response.status);

    if (response.status !== 200) {
      console.error('API Error response:', response.data);
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(response.data?.errors || 'Unknown error')}`);
    }

    return response.data;
  } catch (error) {
    console.error('fetchKundliMatching error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    // Check for specific API errors
    if (error.response?.data?.errors) {
      const apiErrors = error.response.data.errors.map(err =>
        `${err.title || 'Error'}: ${err.detail || 'Unknown detail'}`
      ).join(', ');
      throw new Error(`Prokerala API Error: ${apiErrors}`);
    }

    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout. Please try again.');
    }

    throw error;
  }
}

// Main function: Get or create matching report (cached in DB)
export async function getOrCreateKundliMatch(
  userId,
  person1,
  person2,
  ayanamsa = 1,
  language = "en"
) {
  try {
    const matchHash = createMatchHash(person1, person2);
    console.log('Match hash:', matchHash);

    // Check cache first
    const existing = await KundaliMatching.findOne({ match_hash: matchHash }).lean();
    if (existing) {
      console.log('Returning cached result');
      return { source: "database", data: existing };
    }

    console.log('Fetching from API...');
    const apiData = await fetchKundliMatching(person1, person2, ayanamsa, language);

    // Validate API response
    if (!apiData || apiData.status === 'error') {
      throw new Error(apiData?.errors?.[0]?.detail || 'Invalid response from astrology service');
    }

    // Save to database
    const saved = await KundaliMatching.create({
      userId,
      person1,
      person2,
      matchingReport: apiData.data || apiData,
      ayanamsa,
      language,
      match_hash: matchHash,
      source: "api",
      generatedAt: new Date(),
    });

    console.log('Saved to database');
    return { source: "api", data: saved };
  } catch (error) {
    console.error('getOrCreateKundliMatch error:', error);
    throw error;
  }
}

// Get all matches for a user
export async function getUserMatches(userId, limit = 10, skip = 0) {
  try {
    return await KundaliMatching.find({ userId })
      .sort({ generatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  } catch (error) {
    console.error('getUserMatches error:', error);
    throw error;
  }
}

export async function getUserMatchesCount(userId) {
  try {
    return await KundaliMatching.countDocuments({ userId });
  } catch (error) {
    console.error('getUserMatchesCount error:', error);
    throw error;
  }
}

export async function getMatchById(matchId, userId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      throw new Error('Invalid match ID');
    }

    return await KundaliMatching.findOne({
      _id: matchId,
      userId,
    }).lean();
  } catch (error) {
    console.error('getMatchById error:', error);
    throw error;
  }
}

// Search matches by name
export async function searchMatches(userId, searchTerm) {
  try {
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
  } catch (error) {
    console.error('searchMatches error:', error);
    throw error;
  }
}