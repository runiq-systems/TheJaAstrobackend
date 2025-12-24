import { AppSettings } from "../../models/appSettings.js";
import { CommissionRule } from "../../models/Wallet/AstroWallet.js";

const ALLOWED_FIELDS = [
  'supportEmail',
  'supportPhone',
  'minWalletBalance',
  'maxWalletBalance',
  'maintenanceMode',
];

export const getAppSettings = async (req, res) => {
  try {
    let settings = await AppSettings.findOne({});

    // Create default settings if none exist
    if (!settings) {
      settings = await AppSettings.create({
        updatedBy: req.user._id, // from auth middleware
      });
    }

    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Error fetching app settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching settings',
      error: error.message,
    });
  }
};

export const updateAppSettings = async (req, res) => {
  try {
    // Filter only allowed fields from request body
    const updates = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // If no valid fields were sent
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update',
      });
    }

    // Update or create settings document (no updatedBy field)
    const settings = await AppSettings.findOneAndUpdate(
      {}, // find the first (and only) document
      {
        ...updates,
        updatedAt: new Date(), // still keep timestamp
      },
      {
        new: true,           // return updated document
        upsert: true,        // create if doesn't exist
        runValidators: true, // enforce schema validators
      }
    );

    return res.status(200).json({
      success: true,
      message: 'App settings updated successfully',
      data: settings,
    });
  } catch (error) {
    console.error('Error updating app settings:', error);

    // Handle mongoose validation errors nicely
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.values(error.errors).map((err) => err.message),
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error while updating settings',
      error: error.message,
    });
  }
};





const GLOBAL_RULE_NAME = 'Global Commission Override';
const GLOBAL_RULE_PRIORITY = 999;

const SYSTEM_USER_ID = "69208a47006c5632ab884d71"

export const getGlobalCommission = async (req, res) => {
  try {
    let globalRule = await CommissionRule.findOne({
      name: GLOBAL_RULE_NAME,
      isActive: true,
      priority: GLOBAL_RULE_PRIORITY,
    }).lean();

    if (!globalRule) {
      globalRule = await CommissionRule.create({
        name: GLOBAL_RULE_NAME,
        description: 'Global commission applied to ALL sessions (overrides other rules)',
        conditions: {
          astrologerTier: [],
          sessionType: [],
          userType: [],
          timeRange: { from: null, to: null },
          daysOfWeek: [],
          minSessionDuration: 0,
          maxSessionDuration: null,
        },
        calculationType: 'PERCENTAGE',
        commissionValue: 20,
        slabs: [],
        fixedAmount: 0,
        minCommission: 0,
        maxCommission: null,
        priority: GLOBAL_RULE_PRIORITY,
        isActive: true,
        effectiveFrom: new Date(),
        effectiveTo: null,
        allowAdminOverride: true,
        maxOverrideLimit: 15,
        createdBy: SYSTEM_USER_ID,  // Use fixed system ID
        updatedBy: SYSTEM_USER_ID,  // or req.user?._id if available
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        commissionPercent: globalRule.commissionValue,
      },
    });
  } catch (error) {
    console.error('Error fetching global commission:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch global commission settings',
      error: error.message,
    });
  }
};
 
export const updateGlobalCommission = async (req, res) => {
  try {
    const { commissionPercent } = req.body;

    if (commissionPercent === undefined) {
      return res.status(400).json({
        success: false,
        message: 'commissionPercent is required',
      });
    }

    if (typeof commissionPercent !== 'number' || commissionPercent < 0 || commissionPercent > 100) {
      return res.status(400).json({
        success: false,
        message: 'Commission percent must be a number between 0 and 100',
      });
    }

    // Find or create the global rule
    let globalRule = await CommissionRule.findOne({
      name: GLOBAL_RULE_NAME,
      isActive: true,
    });

    if (!globalRule) {
      // Create new global rule
      globalRule = await CommissionRule.create({
        name: GLOBAL_RULE_NAME,
        description: 'Global commission applied to all sessions',
        calculationType: 'PERCENTAGE',
        commissionValue: commissionPercent,
        priority: GLOBAL_RULE_PRIORITY,
        isActive: true,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
        conditions: {
          astrologerTier: [],
          sessionType: [],
          userType: [],
          timeRange: { from: null, to: null },
          daysOfWeek: [],
          minSessionDuration: 0,
          maxSessionDuration: null,
        },
      });
    } else {
      // Update existing
      globalRule.commissionValue = commissionPercent;
      globalRule.updatedBy = req.user?._id || null;
      await globalRule.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Global commission updated successfully',
      data: {
        commissionPercent: globalRule.commissionValue,
      },
    });
  } catch (error) {
    console.error('Error updating global commission:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating global commission',
    });
  }
};
 