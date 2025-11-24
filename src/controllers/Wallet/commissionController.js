// controllers/commissionController.js
import { CommissionRule, CommissionOverride, CommissionAudit, CommissionBatchUpdate } from '../../models/Wallet/AstroWallet.js';

export const createCommissionRule = async (req, res) => {
    try {
        const {
            name, description, conditions, calculationType, commissionValue,
            slabs, fixedAmount, minCommission, maxCommission, priority,
            effectiveFrom, effectiveTo, allowAdminOverride, maxOverrideLimit
        } = req.body;

        const createdBy = req.user.userId;

        const commissionRule = new CommissionRule({
            name,
            description,
            conditions: conditions || {},
            calculationType,
            commissionValue,
            slabs: slabs || [],
            fixedAmount: fixedAmount || 0,
            minCommission: minCommission || 0,
            maxCommission,
            priority: priority || 1,
            effectiveFrom: effectiveFrom || new Date(),
            effectiveTo,
            allowAdminOverride: allowAdminOverride !== false,
            maxOverrideLimit: maxOverrideLimit || 10,
            createdBy,
            isActive: true
        });

        await commissionRule.save();

        // Create audit log
        const auditLog = new CommissionAudit({
            action: 'RULE_CREATE',
            targetType: 'COMMISSION_RULE',
            targetId: commissionRule._id,
            changes: [
                { field: 'rule_created', oldValue: null, newValue: commissionRule._id }
            ],
            performedBy: createdBy,
            reason: 'New commission rule created',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        await auditLog.save();

        res.status(201).json({
            success: true,
            message: 'Commission rule created successfully',
            data: commissionRule
        });
    } catch (error) {
        console.error('Create commission rule error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getCommissionRules = async (req, res) => {
    try {
        const { page = 1, limit = 20, isActive, calculationType } = req.query;

        const filter = {};
        if (isActive !== undefined) filter.isActive = isActive === 'true';
        if (calculationType) filter.calculationType = calculationType;

        const rules = await CommissionRule.find(filter)
            .sort({ priority: 1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email')
            .lean();

        const total = await CommissionRule.countDocuments(filter);

        res.json({
            success: true,
            data: {
                rules,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get commission rules error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const createCommissionOverride = async (req, res) => {
    try {
        const {
            targetType, targetId, targetTier, targetSessionType,
            baseRule, overrideType, overrideValue, reason
        } = req.body;

        const approvedBy = req.user.userId;

        // Validate base rule
        const commissionRule = await CommissionRule.findById(baseRule);
        if (!commissionRule) {
            return res.status(404).json({
                success: false,
                message: 'Base commission rule not found'
            });
        }

        if (!commissionRule.allowAdminOverride) {
            return res.status(400).json({
                success: false,
                message: 'This rule does not allow overrides'
            });
        }

        // Calculate final commission
        let finalCommissionPercent;
        let finalFixedAmount = 0;

        if (overrideType === 'PERCENTAGE_CHANGE') {
            finalCommissionPercent = commissionRule.commissionValue + overrideValue;
        } else if (overrideType === 'ABSOLUTE_PERCENTAGE') {
            finalCommissionPercent = overrideValue;
        } else if (overrideType === 'FIXED_AMOUNT') {
            finalCommissionPercent = commissionRule.commissionValue;
            finalFixedAmount = overrideValue;
        }

        // Validate override limits
        if (commissionRule.maxOverrideLimit &&
            Math.abs(overrideValue) > commissionRule.maxOverrideLimit) {
            return res.status(400).json({
                success: false,
                message: `Override value exceeds maximum limit of ${commissionRule.maxOverrideLimit}`
            });
        }

        const commissionOverride = new CommissionOverride({
            targetType,
            targetId,
            targetTier,
            targetSessionType,
            baseRule,
            overrideType,
            overrideValue,
            finalCommissionPercent,
            finalFixedAmount,
            reason,
            approvedBy,
            isActive: true,
            effectiveFrom: new Date()
        });

        await commissionOverride.save();

        // Create audit log
        const auditLog = new CommissionAudit({
            action: 'OVERRIDE_CREATE',
            targetType: 'COMMISSION_OVERRIDE',
            targetId: commissionOverride._id,
            changes: [
                { field: 'override_created', oldValue: null, newValue: commissionOverride._id }
            ],
            performedBy: approvedBy,
            reason: `Commission override created: ${reason}`,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        await auditLog.save();

        res.status(201).json({
            success: true,
            message: 'Commission override created successfully',
            data: commissionOverride
        });
    } catch (error) {
        console.error('Create commission override error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getCommissionOverrides = async (req, res) => {
    try {
        const { page = 1, limit = 20, targetType, isActive } = req.query;

        const filter = {};
        if (targetType) filter.targetType = targetType;
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const overrides = await CommissionOverride.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('baseRule', 'name commissionValue')
            .populate('approvedBy', 'name email')
            .lean();

        const total = await CommissionOverride.countDocuments(filter);

        res.json({
            success: true,
            data: {
                overrides,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get commission overrides error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const batchUpdateCommission = async (req, res) => {
    try {
        const {
            name, description, criteria, updateType, updateValue
        } = req.body;

        const initiatedBy = req.user.userId;
        const batchId = generateTxId('BATCH');

        // Create batch update record
        const batchUpdate = new CommissionBatchUpdate({
            batchId,
            name,
            description,
            criteria: criteria || {},
            updateType,
            updateValue,
            status: 'PENDING',
            initiatedBy,
            initiatedAt: new Date()
        });

        await batchUpdate.save();

        // Process batch update asynchronously
        processBatchUpdate(batchUpdate._id);

        res.json({
            success: true,
            message: 'Batch commission update initiated',
            data: {
                batchId: batchUpdate.batchId,
                name: batchUpdate.name,
                status: batchUpdate.status
            }
        });
    } catch (error) {
        console.error('Batch update commission error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Async batch processing function
const processBatchUpdate = async (batchId) => {
    try {
        const batchUpdate = await CommissionBatchUpdate.findById(batchId);
        if (!batchUpdate) return;

        batchUpdate.status = 'PROCESSING';
        await batchUpdate.save();

        // Implementation would query affected astrologers based on criteria
        // and create overrides for each

        // This is a simplified implementation
        const affectedCount = 0; // Would be calculated based on criteria
        const successfulCount = 0; // Would track successful overrides

        batchUpdate.status = 'COMPLETED';
        batchUpdate.processedCount = affectedCount;
        batchUpdate.successfulCount = successfulCount;
        batchUpdate.completedAt = new Date();

        await batchUpdate.save();

    } catch (error) {
        console.error('Process batch update error:', error);
        const batchUpdate = await CommissionBatchUpdate.findById(batchId);
        if (batchUpdate) {
            batchUpdate.status = 'FAILED';
            batchUpdate.errors.push({ error: error.message });
            await batchUpdate.save();
        }
    }
};