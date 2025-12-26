import { AppSettings } from "../models/appSettings.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import mongoose from "mongoose";
// ==========================
// GET / CREATE / UPDATE
// ==========================
export const upsertAppSettings = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const adminId = req.user?._id;

        const updatePayload = {
            supportEmail: req.body.supportEmail,
            supportPhone: req.body.supportPhone,
            newUserBonus: req.body.newUserBonus,
            minWalletBalance: req.body.minWalletBalance,
            maxWalletBalance: req.body.maxWalletBalance,
            maintenanceMode: req.body.maintenanceMode === 'true' || req.body.maintenanceMode === true,
            updatedBy: adminId,
        };

        // Banner uploads (optional)
        if (req.files?.homefirstpageBanner?.[0]) {
            const upload = await uploadOnCloudinary(
                req.files.homefirstpageBanner[0].path,
                "app_settings/banners"
            );
            updatePayload.homefirstpageBanner = upload.url;
        }

        if (req.files?.homesecondpageBanner?.[0]) {
            const upload = await uploadOnCloudinary(
                req.files.homesecondpageBanner[0].path,
                "app_settings/banners"
            );
            updatePayload.homesecondpageBanner = upload.url;
        }

        // Convert string numbers to actual numbers
        updatePayload.newUserBonus = Number(updatePayload.newUserBonus);
        updatePayload.minWalletBalance = Number(updatePayload.minWalletBalance);
        updatePayload.maxWalletBalance = Number(updatePayload.maxWalletBalance);

        const settings = await AppSettings.findOneAndUpdate(
            {},
            { $set: updatePayload },
            {
                new: true,
                upsert: true,
                session,
                setDefaultsOnInsert: true,
            }
        );

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "App settings updated",
            data: settings,
        });
    } catch (error) {
        await session.abortTransaction();
        console.error("Error updating app settings:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to update app settings",
        });
    } finally {
        session.endSession();
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
