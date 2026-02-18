import { AppSettings } from '../models/appSettings.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js';
import mongoose from 'mongoose';
// ==========================
// GET / CREATE / UPDATE
// ==========================

// Only added comments, nothing changed

export const upsertAppSettings = async (req, res) => {
  try {
    const updatePayload = {};

    // Only add fields that are actually sent
    if (req.body.supportEmail !== undefined)
      updatePayload.supportEmail = req.body.supportEmail;
    if (req.body.supportPhone !== undefined)
      updatePayload.supportPhone = req.body.supportPhone;
    if (req.body.newUserBonus !== undefined)
      updatePayload.newUserBonus = Number(req.body.newUserBonus);
    if (req.body.minWalletBalance !== undefined)
      updatePayload.minWalletBalance = Number(req.body.minWalletBalance);
    if (req.body.maxWalletBalance !== undefined)
      updatePayload.maxWalletBalance = Number(req.body.maxWalletBalance);
    if (req.body.maintenanceMode !== undefined) {
      updatePayload.maintenanceMode =
        req.body.maintenanceMode === 'true' ||
        req.body.maintenanceMode === true;
    }

    if (req.user?._id) {
      updatePayload.updatedBy = req.user._id;
    }

    // ── Files ───────────────────────────────────────
    if (req.files?.homefirstpageBanner?.[0]) {
      const upload = await uploadOnCloudinary(
        req.files.homefirstpageBanner[0].path,
        'app_settings/banners',
        {
          public_id: 'homefirstpageBanner', // ← fixed name → always overwrites the same asset
          overwrite: true,
          invalidate: true,
        }
      );
      updatePayload.homefirstpageBanner = upload.url;
    }

    if (req.files?.homesecondpageBanner?.[0]) {
      const upload = await uploadOnCloudinary(
        req.files.homesecondpageBanner[0].path,
        'app_settings/banners',
        {
          public_id: 'homesecondpageBanner', // ← fixed name → always overwrites the same asset
          overwrite: true,
          invalidate: true,
        }
      );
      updatePayload.homesecondpageBanner = upload.url;
    }

    // Only update if we have something to update
    if (Object.keys(updatePayload).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes provided',
        data: (await AppSettings.findOne()) || {},
      });
    }

    const settings = await AppSettings.findOneAndUpdate(
      {},
      { $set: updatePayload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'App settings updated successfully',
      data: settings,
    });
  } catch (error) {
    console.error('Error updating app settings:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during update',
    });
  }
};
// ==========================
// GET SETTINGS
// ==========================
export const getAppSettings = async (req, res) => {
  try {
    const settings = await AppSettings.findOneAndUpdate(
      {}, // find the only document
      {
        $setOnInsert: {
          homefirstpageBanner: '',
          homesecondpageBanner: '',
          // ... other default values you want on first creation
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        lean: true,
      }
    );

    // Force string type for image fields (prevents null/undefined)
    const responseData = {
      ...settings,
      homefirstpageBanner: String(settings.homefirstpageBanner || ''),
      homesecondpageBanner: String(settings.homesecondpageBanner || ''),
    };

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Get app settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching settings',
    });
  }
};
