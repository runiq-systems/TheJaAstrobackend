import { AppSettings } from '../../models/appSettings.js';
import { CommissionRule } from '../../models/Wallet/AstroWallet.js';

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
    const updates = {};

    // ── Text/number/boolean fields ─────────────────────────────
    const allowedFields = [
      'supportEmail',
      'supportPhone',
      'newUserBonus',
      'minWalletBalance',
      'maxWalletBalance',
      'maintenanceMode',
    ];

    allowedFields.forEach((key) => {
      if (req.body[key] !== undefined) {
        if (
          ['newUserBonus', 'minWalletBalance', 'maxWalletBalance'].includes(key)
        ) {
          updates[key] = Number(req.body[key]);
        } else if (key === 'maintenanceMode') {
          updates[key] = req.body[key] === 'true' || req.body[key] === true;
        } else {
          updates[key] = req.body[key];
        }
      }
    });

    // ── Banner images ───────────────────────────────────────────
    if (req.files?.homefirstpageBanner?.[0]) {
      const file = req.files.homefirstpageBanner[0];
      const uploadResult = await uploadBufferToCloudinary(
        file.buffer,
        file.originalname,
        'app_settings/banners'
      );
      updates.homefirstpageBanner = uploadResult.url;
    }

    if (req.files?.homesecondpageBanner?.[0]) {
      const file = req.files.homesecondpageBanner[0];
      const uploadResult = await uploadBufferToCloudinary(
        file.buffer,
        file.originalname,
        'app_settings/banners'
      );
      updates.homesecondpageBanner = uploadResult.url;
    }

    // Nothing to update?
    if (Object.keys(updates).length === 0) {
      const current = (await AppSettings.findOne({})) || {};
      return res.status(200).json({
        success: true,
        message: 'No changes to apply',
        data: current,
      });
    }

    // Final update
    const updatedSettings = await AppSettings.findOneAndUpdate(
      {},
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'App settings updated successfully',
      data: updatedSettings,
    });
  } catch (error) {
    console.error('Update app settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: error.message,
    });
  }
};

const GLOBAL_RULE_NAME = 'Global Commission Override';
const GLOBAL_RULE_PRIORITY = 999;

const SYSTEM_USER_ID = '69208a47006c5632ab884d71';

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
        description:
          'Global commission applied to ALL sessions (overrides other rules)',
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
        createdBy: SYSTEM_USER_ID, // Use fixed system ID
        updatedBy: SYSTEM_USER_ID, // or req.user?._id if available
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

    if (
      typeof commissionPercent !== 'number' ||
      commissionPercent < 0 ||
      commissionPercent > 100
    ) {
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
