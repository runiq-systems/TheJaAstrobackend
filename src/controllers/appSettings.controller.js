import AppSettings from "../models/AppSettings.model.js";

// ==========================
// GET / CREATE / UPDATE
// ==========================
export const upsertAppSettings = async (req, res) => {
    try {
        const {
            supportEmail,
            supportPhone,
            minWalletBalance,
            maxWalletBalance,
            maintenanceMode,
        } = req.body;

        const adminId = req.user?._id; // if admin auth middleware exists

        const settings = await AppSettings.findOneAndUpdate(
            {}, // no condition = singleton
            {
                supportEmail,
                supportPhone,
                minWalletBalance,
                maxWalletBalance,
                maintenanceMode,
                updatedBy: adminId,
            },
            {
                new: true,
                upsert: true, // 🔥 CREATE if not exists
            }
        );

        return res.status(200).json({
            success: true,
            message: "App settings updated successfully",
            data: settings,
        });
    } catch (error) {
        console.error("App settings update error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update app settings",
        });
    }
};

// ==========================
// GET SETTINGS
// ==========================
export const getAppSettings = async (req, res) => {
    try {
        const settings = await AppSettings.findOne();

        return res.status(200).json({
            success: true,
            data: settings || {},
        });
    } catch (error) {
        console.error("Get app settings error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch app settings",
        });
    }
};
