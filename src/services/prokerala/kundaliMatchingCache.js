import { KundaliMatching } from "../../models/kundaliMatching.js";

export const getCachedMatching = async (userId, person1ReportId, person2ReportId) => {
  return await KundaliMatching.findOne({
    userId,
    "person1.reportId": person1ReportId,
    "person2.reportId": person2ReportId
  });
};

export const storeKundaliMatching = async (userId, person1, person2, matchingData) => {
  const totalGuna = matchingData.guna?.total || 0;
  const result = totalGuna >= 28 ? "Excellent" : totalGuna >= 24 ? "Very Good" : totalGuna >= 18 ? "Good" : "Average";

  return await KundaliMatching.findOneAndUpdate(
    {
      userId,
      "person1.reportId": person1.reportId,
      "person2.reportId": person2.reportId
    },
    {
      userId,
      person1,
      person2,
      matchingReport: matchingData,
      totalGuna,
      result,
      generatedAt: new Date()
    },
    { upsert: true, new: true }
  );
};