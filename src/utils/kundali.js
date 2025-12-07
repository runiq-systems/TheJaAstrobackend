// src/utils/kundali.js
import moment from "moment";
import {
    julian,
    solar,
    lunar,
    planetposition,
    data as planetData
} from "astronomia";

// Helper: Convert DOB + Time → Julian Day
function getJulianDay(dob, time) {
    const dt = moment(`${dob} ${time}`, "YYYY-MM-DD HH:mm");
    const year = dt.year();
    const month = dt.month() + 1;
    const day = dt.date();
    const hour = dt.hour() + dt.minute() / 60;

    return julian.CalendarToJD(year, month, day + hour / 24);
}

// Get planet longitude (astronomia gives ecliptic longitudes easily)
function getPlanetLongitude(jd, planet) {
    switch (planet) {
        case "Sun":
            return solar.apparentLongitude(jd);
        case "Moon":
            return lunar.longitude(jd);
        case "Mercury":
            return planetposition.position(planetData.mercury, jd).lon;
        case "Venus":
            return planetposition.position(planetData.venus, jd).lon;
        case "Mars":
            return planetposition.position(planetData.mars, jd).lon;
        case "Jupiter":
            return planetposition.position(planetData.jupiter, jd).lon;
        case "Saturn":
            return planetposition.position(planetData.saturn, jd).lon;

        // Rahu/Ketu approx (True Node)
        case "Rahu":
            return (lunar.longitude(jd) + 180) % 360;
        case "Ketu":
            return lunar.longitude(jd);
    }
}

// House from longitude
function getHouse(longitude) {
    return Math.floor(longitude / 30) + 1;
}

/**
 * ===============================
 *        CALCULATE KUNDALI
 * ===============================
 */
export async function calculateKundali({ dob, time, place, gender }) {
    try {
        const jd = getJulianDay(dob, time);
        const { lat, lon } = place;

        const planetNames = [
            "Sun",
            "Moon",
            "Mercury",
            "Venus",
            "Mars",
            "Jupiter",
            "Saturn",
            "Rahu",
            "Ketu",
        ];

        const chart = {};

        planetNames.forEach((planet) => {
            const lon = getPlanetLongitude(jd, planet);

            chart[planet] = {
                longitude: parseFloat(lon.toFixed(4)),
                house: getHouse(lon),
            };
        });

        return {
            dob,
            time,
            gender,
            place,
            chart,
            message: "Kundali calculated successfully (astronomia)",
        };
    } catch (err) {
        console.error(err);
        throw new Error("Error calculating kundali: " + err.message);
    }
}

/**
 * ===============================
 *        MATCH MAKING
 * ===============================
 */
export async function matchKundali(groom, bride) {
    try {
        const g = await calculateKundali(groom);
        const b = await calculateKundali(bride);

        const sunDiff = Math.abs(g.chart.Sun.longitude - b.chart.Sun.longitude);
        const moonDiff = Math.abs(g.chart.Moon.longitude - b.chart.Moon.longitude);

        const score = Math.max(
            0,
            100 - Math.floor(sunDiff / 3) - Math.floor(moonDiff / 3)
        );

        return {
            groom: { dob: groom.dob, sun: g.chart.Sun.longitude },
            bride: { dob: bride.dob, sun: b.chart.Sun.longitude },
            matchScore: score,
            message: "Matchmaking calculated using astronomia",
        };
    } catch (err) {
        console.error(err);
        throw new Error("Error in kundali matchmaking: " + err.message);
    }
}
