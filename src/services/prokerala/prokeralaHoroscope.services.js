import axios from "axios";
import { getProkeralaDateTime } from "../../utils/date.utils.js";
import { getAccessToken } from "./prokeralaToken.services.js";

export const fetchDailyHoroscopeFromAPI = async () => {
  const token = await getAccessToken();
  const datetime = getProkeralaDateTime();

  const response = await axios.get(
    "https://api.prokerala.com/v2/horoscope/daily/advanced",
    {
      params: {
        datetime,
        sign: "all",
        type: "general",
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data.data;
};
