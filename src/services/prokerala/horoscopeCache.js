import { storeDailyHoroscope } from "../../controllers/Astrologycontroller/astrologyController.js";
import DailyHoroscopeSign from "../../models/DailyHoroscopeSign.js";
import { getStartOfISTDay } from "../../utils/date.utils.js";
import { fetchDailyHoroscopeFromAPI } from "./prokeralaHoroscope.services.js";

export const getDailyHoroscopeBySign = async (sign) => {
  const today = getStartOfISTDay();

  let horoscope = await DailyHoroscopeSign.findOne({
    date: today,
    "sign.name": sign.toLowerCase(),
  });

  if (horoscope) {
    return { data: horoscope, source: "db" };
  }

  // ❗ API HIT ONLY ONCE PER DAY
  const apiData = await fetchDailyHoroscopeFromAPI();
  await storeDailyHoroscope(apiData);

  horoscope = await DailyHoroscopeSign.findOne({
    date: today,
    "sign.name": sign.toLowerCase(),
  });

  return { data: horoscope, source: "api_cached" };
};
