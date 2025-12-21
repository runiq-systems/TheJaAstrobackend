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

export const getExistingKundaliReportAll = async ({
  userId,
  dob,
  tob,
  place,
  page = 1,
  limit = 10,
}) => {
  const skip = (page - 1) * limit;

  // ✅ Only userId is mandatory
  const query = {
    userId,
  };

  // ✅ Optional filters
  if (dob) query.dob = dob;
  if (tob) query.tob = tob;
  if (place) query.place = place;

  const [data, total] = await Promise.all([
    KundaliReport.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    KundaliReport.countDocuments(query),
  ]);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
  };
};


export const getKundaliReportDetail = async ({ reportId, userId }) => {
  if (!reportId) {
    throw new Error("Report ID is required");
  }

  const report = await KundaliReport.findOne({
    _id: reportId,
    userId, // 🔐 user ownership check
  }).lean();

  if (!report) {
    throw new Error("Kundali report not found");
  }

  return report;
};

