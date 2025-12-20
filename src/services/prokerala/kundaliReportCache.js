import { KundaliReport } from "../../models/kunadliReport.js";

export const getCachedKundaliReport = async (userId, dob, tob, place) => {
   return await KundaliReport.findOne({
    userId,
    dob,
    tob,
    place,
    // generatedAt: { $gte: dayUTC }
  });
};

export const storeKundaliReport = async (userId, input, reportData) => {
  const { name, dob, tob, place, coordinates, ayanamsa = 1, language = 'en' } = input;

  return await KundaliReport.findOneAndUpdate(
    { userId, dob, tob, place },
    {
      userId,
      name,
      dob,
      tob,
      place,
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude
      },
      report: reportData,
      ayanamsa,
      language,
      generatedAt: new Date()
    },
    { upsert: true, new: true }
  );
};
