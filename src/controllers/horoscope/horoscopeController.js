// src/controllers/horoscopeController.js
import horoscope from "horoscope"; // Daily horoscope npm
import NodeGeocoder from "node-geocoder";

import { calculateKundali,matchKundali } from "../../utils/kundali.js";
const geocoder = NodeGeocoder({ provider: "openstreetmap" });

/**
 * Helper function to generate random percentage for Love/Career/Overall
 */
function randomPercent(min = 40, max = 100) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Get Zodiac Sign from DOB
 */
export function getZodiacSign(dob) {
    const date = new Date(dob);
    const day = date.getDate();
    const month = date.getMonth() + 1;

    if ((month == 3 && day >= 21) || (month == 4 && day <= 19)) return "aries";
    if ((month == 4 && day >= 20) || (month == 5 && day <= 20)) return "taurus";
    if ((month == 5 && day >= 21) || (month == 6 && day <= 20)) return "gemini";
    if ((month == 6 && day >= 21) || (month == 7 && day <= 22)) return "cancer";
    if ((month == 7 && day >= 23) || (month == 8 && day <= 22)) return "leo";
    if ((month == 8 && day >= 23) || (month == 9 && day <= 22)) return "virgo";
    if ((month == 9 && day >= 23) || (month == 10 && day <= 22)) return "libra";
    if ((month == 10 && day >= 23) || (month == 11 && day <= 21)) return "scorpio";
    if ((month == 11 && day >= 22) || (month == 12 && day <= 21)) return "sagittarius";
    if ((month == 12 && day >= 22) || (month == 1 && day <= 19)) return "capricorn";
    if ((month == 1 && day >= 20) || (month == 2 && day <= 18)) return "aquarius";
    if ((month == 2 && day >= 19) || (month == 3 && day <= 20)) return "pisces";

    return "unknown";
}

/**
 * Controller: Get daily horoscope with percentages
 */
export const getDailyHoroscope = async (req, res) => {
    try {
        const { name, dob, place } = req.body;

        if (!dob && !place) {
            return res.status(400).json({ ok: false, message: "DOB or place required" });
        }

        // Zodiac sign from DOB
        let sign = getZodiacSign(dob);

        // If sign missing, try to get from address (optional, can use latitude calculation)
        if (!sign && place) {
            const geo = await geocoder.geocode(place);
            if (geo.length > 0) {
                // TODO: Can implement advanced astrological logic using geo coordinates
                sign = "taurus"; // fallback example
            }
        }

        // Daily horoscope text using horoscope npm
        const dailyText = horoscope.getHoroscope(sign, "today");

        // Random percentages for UI
        const overall = randomPercent(40, 100);
        const love = randomPercent(40, 100);
        const career = randomPercent(40, 100);

        res.json({
            ok: true,
            data: {
                name,
                sign,
                dailyText,
                percentages: {
                    overall,
                    love,
                    career,
                },
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Server error", error: err.message });
    }
};

/**
 * Controller: Get Kundali report
 */
export const getKundaliReport = async (req, res) => {
    try {
        const { dob, time, place, gender } = req.body;

        if (!dob || !time || !place || !gender) {
            return res.status(400).json({ ok: false, message: "Missing required fields" });
        }

        const kundali = await calculateKundali({ dob, time, place, gender });

        res.json({
            ok: true,
            data: kundali,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Server error", error: err.message });
    }
};

/**
 * Controller: Kundali Matchmaking
 */
export const getKundaliMatch = async (req, res) => {
    try {
        const { groom, bride } = req.body; // groom/bride = { dob, time, place, gender }

        if (!groom || !bride) {
            return res.status(400).json({ ok: false, message: "Missing groom or bride data" });
        }

        const matchResult = await matchKundali(groom, bride);

        res.json({
            ok: true,
            data: matchResult,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Server error", error: err.message });
    }
};
