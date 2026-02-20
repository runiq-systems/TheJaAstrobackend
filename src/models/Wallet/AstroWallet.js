import mongoose from "mongoose";
import logger from "../../utils/logger.js";
const { Schema } = mongoose;

// ==================== MODEL REGISTRATION HELPER ====================
const getModel = (modelName, schema) => {
  return mongoose.models[modelName] || mongoose.model(modelName, schema);
};

// ==================== CONFIGURATION SCHEMAS ====================

const PlatformConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    type: {
      type: String,
      enum: ["NUMBER", "STRING", "BOOLEAN", "OBJECT", "ARRAY"],
      required: true,
    },
    description: { type: String, default: null },
    category: {
      type: String,
      enum: ["COMMISSION", "TAX", "WALLET", "SESSION", "PAYMENT", "GENERAL"],
      default: "GENERAL",
    },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const TaxConfigSchema = new Schema(
  {
    country: { type: String, default: "IN", required: true },
    state: { type: String, default: null },
    taxType: {
      type: String,
      enum: ["GST", "VAT", "IGST", "SGST", "CGST", "TDS"],
      required: true,
    },
    rate: { type: Number, required: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const CurrencyConfigSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    decimalPlaces: { type: Number, default: 2 },
    conversionRate: { type: Number, default: 1 },
    isBaseCurrency: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ==================== COMMISSION MANAGEMENT SCHEMAS ====================

const CommissionRuleSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    conditions: {
      astrologerTier: [
        { type: String, enum: ["BASIC", "SILVER", "GOLD", "PLATINUM"] },
      ],
      sessionType: [{ type: String, enum: ["CALL", "CHAT", "LIVE"] }],
      userType: [{ type: String, enum: ["NEW", "REGULAR", "VIP"] }],
      timeRange: {
        from: { type: String, default: null },
        to: { type: String, default: null },
      },
      daysOfWeek: [{ type: Number, min: 0, max: 6 }],
      minSessionDuration: { type: Number, default: 0 },
      maxSessionDuration: { type: Number, default: null },
    },
    calculationType: {
      type: String,
      enum: ["PERCENTAGE", "FIXED_AMOUNT", "SLAB_BASED", "HYBRID"],
      default: "PERCENTAGE",
    },
    commissionValue: { type: Number, required: true },
    slabs: [
      {
        minAmount: { type: Number, default: 0 },
        maxAmount: { type: Number, default: null },
        commissionPercent: { type: Number, required: true },
      },
    ],
    fixedAmount: { type: Number, default: 0 },
    minCommission: { type: Number, default: 0 },
    maxCommission: { type: Number, default: null },
    priority: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    allowAdminOverride: { type: Boolean, default: true },
    maxOverrideLimit: { type: Number, default: 10 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const CommissionOverrideSchema = new Schema(
  {
    targetType: {
      type: String,
      enum: ["ASTROLOGER", "ASTROLOGER_TIER", "SESSION_TYPE", "GLOBAL"],
      required: true,
    },
    targetId: { type: Schema.Types.ObjectId, default: null },
    targetTier: {
      type: String,
      enum: ["BASIC", "SILVER", "GOLD", "PLATINUM"],
      default: null,
    },
    targetSessionType: {
      type: String,
      enum: ["CALL", "CHAT", "LIVE"],
      default: null,
    },
    baseRule: {
      type: Schema.Types.ObjectId,
      ref: "CommissionRule",
      required: true,
    },
    overrideType: {
      type: String,
      enum: ["PERCENTAGE_CHANGE", "FIXED_AMOUNT", "ABSOLUTE_PERCENTAGE"],
      required: true,
    },
    overrideValue: { type: Number, required: true },
    finalCommissionPercent: { type: Number, required: true },
    finalFixedAmount: { type: Number, default: 0 },
    reason: { type: String, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    approvedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const CommissionAuditSchema = new Schema(
  {
    action: {
      type: String,
      enum: [
        "RULE_CREATE",
        "RULE_UPDATE",
        "RULE_DELETE",
        "OVERRIDE_CREATE",
        "OVERRIDE_UPDATE",
        "OVERRIDE_DELETE",
        "BULK_UPDATE",
        "COMMISSION_CALCULATION",
        "ADJUSTMENT",
      ],
      required: true,
    },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    changes: [
      {
        field: { type: String, required: true },
        oldValue: { type: Schema.Types.Mixed, default: null },
        newValue: { type: Schema.Types.Mixed, default: null },
      },
    ],
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedAt: { type: Date, default: Date.now },
    reason: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const CommissionBatchUpdateSchema = new Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    criteria: {
      astrologerTiers: [
        { type: String, enum: ["BASIC", "SILVER", "GOLD", "PLATINUM"] },
      ],
      sessionTypes: [{ type: String, enum: ["CALL", "CHAT", "LIVE"] }],
      specificAstrologers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      minRating: { type: Number, default: 0 },
      minSessions: { type: Number, default: 0 },
    },
    updateType: {
      type: String,
      enum: ["PERCENTAGE_CHANGE", "ABSOLUTE_PERCENTAGE", "FIXED_AMOUNT"],
      required: true,
    },
    updateValue: { type: Number, required: true },
    expectedAffectedCount: { type: Number, default: 0 },
    estimatedCommissionChange: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "PARTIALLY_COMPLETED",
      ],
      default: "PENDING",
    },
    processedCount: { type: Number, default: 0 },
    successfulCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    errors: [
      {
        astrologerId: { type: Schema.Types.ObjectId, ref: 'User' },
        error: { type: String, required: true },
      },
    ],
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    initiatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== CORE WALLET SCHEMAS ====================

const WalletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balances: [
      {
        currency: { type: String, default: "INR" },
        available: { type: Number, default: 0 },
        bonus: { type: Number, default: 0 },
        locked: { type: Number, default: 0 },
        pendingIncoming: { type: Number, default: 0 },
      },
    ],
    primaryCurrency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["ACTIVE", "BLOCKED", "SUSPENDED", "CLOSED"],
      default: "ACTIVE",
      index: true,
    },
    tier: {
      type: String,
      enum: ["REGULAR", "PREMIUM", "VIP"],
      default: "REGULAR",
    },
    kycStatus: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED", "NOT_REQUIRED"],
      default: "NOT_REQUIRED",
    },
    lastBalanceUpdate: { type: Date, default: Date.now },
    version: { type: Number, default: 1 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const TransactionSchema = new Schema(
  {
    txId: { type: String, required: true, unique: true, index: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ["USER", "ASTROLOGER", "PLATFORM", "ADMIN"],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
    category: {
      type: String,
      enum: [
        "RECHARGE",
        "SESSION_DEDUCTION",
        "CALL_SESSION",
        "CHAT_SESSION",
        "RESERVE",
        "UNRESERVE",
        "EARNINGS",
        "REFUND",
        "BONUS",
        "ADMIN_ADJUSTMENT",
        "COMMISSION",
        "PAYOUT",
        "REVERSAL",
        "TAX",
        "CHARGEBACK",
        "SETTLEMENT",
      ],
      required: true,
      index: true,
    },
    subcategory: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR", index: true },
    baseCurrencyAmount: { type: Number, default: null },
    taxAmount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    taxType: { type: String, default: null },
    commissionAmount: { type: Number, default: 0 },
    commissionRate: { type: Number, default: 0 },
    balanceBefore: { type: Number, default: null },
    balanceAfter: { type: Number, default: null },
    bonusBalanceBefore: { type: Number, default: null },
    bonusBalanceAfter: { type: Number, default: null },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "REVERSED",
      ],
      default: "PENDING",
      index: true,
    },
    relatedTx: [{ type: String }],
    reservationId: {
      type: Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
    },
    payoutId: { type: Schema.Types.ObjectId, ref: "Payout", default: null },
    description: { type: String, default: null },
    gatewayRef: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    processedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== SESSION BILLING SCHEMAS ====================

const SessionRateConfigSchema = new Schema(
  {
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sessionType: {
      type: String,
      enum: ["CALL", "CHAT", "LIVE"],
      required: true,
    },
    ratePerMinute: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const ReservationSchema = new Schema(
  {
    reservationId: { type: String, required: true, unique: true, index: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: ["CALL", "CHAT", "LIVE"],
      required: true,
    },
    rateConfigId: {
      type: Schema.Types.ObjectId,
      ref: "SessionRateConfig",
      default: null, // Changed from required: true to default: null
    },
    ratePerMinute: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    commissionPercent: { type: Number, default: 20 },
    taxPercent: { type: Number, default: 18 },
    commissionDetails: {
      baseCommissionPercent: { type: Number, required: true },
      appliedOverrideId: {
        type: Schema.Types.ObjectId,
        ref: "CommissionOverride",
        default: null,
      },
      finalCommissionPercent: { type: Number, required: true },
      commissionRuleId: {
        type: Schema.Types.ObjectId,
        ref: "CommissionRule",
        default: null, // Changed from required: true to default: null
      },
      adminAdjustedCommission: { type: Number, default: null },
      adjustmentReason: { type: String, default: null },
      adjustedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      adjustedAt: { type: Date, default: null },
      commissionAmount: { type: Number, required: true },
      platformAmount: { type: Number, required: true },
      astrologerAmount: { type: Number, required: true },
    },
    lockedAmount: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    platformEarnings: { type: Number, default: 0 },
    astrologerEarnings: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    totalDurationSec: { type: Number, default: 0 },
    billedMinutes: { type: Number, default: 0 },
    freeMinutesUsed: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "INITIATED",
        "RESERVED",
        "ONGOING",
        "PAUSED",
        "SETTLING",
        "SETTLED",
        "CANCELLED",
        "FAILED",
        "EXPIRED",
      ],
      default: "INITIATED",
      index: true,
    },
    startAt: { type: Date, default: null, index: true },
    endAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    settledAt: { type: Date, default: null },
    billingIntervals: [
      {
        startTime: { type: Date, required: true },
        endTime: { type: Date, required: true },
        durationSec: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
    txRefs: [{ type: String }],
    promoCode: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const BillingTickSchema = new Schema(
  {
    reservationId: {
      type: Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      index: true,
    },
    tickId: { type: String, required: true, unique: true },
    tickAt: { type: Date, default: Date.now, index: true },
    minuteIndex: { type: Number, required: true },
    amount: { type: Number, required: true },
    taxAmount: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    txId: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED", "ROLLED_BACK"],
      default: "PENDING",
    },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== PROMOTION SCHEMAS ====================

const CouponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    discountType: {
      type: String,
      enum: [
        "PERCENTAGE",
        "FLAT_AMOUNT",
        "BONUS_PERCENTAGE",
        "CASHBACK",
        "FREE_MINUTES",
        "FIXED_PRICE",
      ],
      required: true,
    },
    value: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    categories: [{ type: String }],
    sessionTypes: [{ type: String }],
    astrologerTiers: [{ type: String }],
    minCartValue: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: null },
    usageLimit: { type: Number, default: null },
    perUserLimit: { type: Number, default: 1 },
    userSegments: [{ type: String }],
    firstTimeOnly: { type: Boolean, default: false },
    specificUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    startAt: { type: Date, default: Date.now },
    endAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    combinable: { type: Boolean, default: false },
    autoApply: { type: Boolean, default: false },
    priority: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const CouponUsageSchema = new Schema(
  {
    couponId: {
      type: Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reservationId: {
      type: Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
    },
    rechargeId: {
      type: Schema.Types.ObjectId,
      ref: "RechargeHistory",
      default: null,
    },
    usedAt: { type: Date, default: Date.now, index: true },
    discountAmount: { type: Number, default: 0 },
    cartValue: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["APPLIED", "USED", "REVOKED", "EXPIRED"],
      default: "APPLIED",
    },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== PAYMENT & SETTLEMENT SCHEMAS ====================

const RechargeHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requestedAmount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    bonusAmount: { type: Number, default: 0 },

    totalPayable: { type: Number }, // Amount user pays including GST
    gstAmount: { type: Number }, // GST amount
    gstPercentage: { type: Number, default: 18 }, // GST 
    platformFee: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true },
    paymentGateway: { type: String, required: true, index: true },
    gatewayTxnId: { type: String, default: null },
    gatewayResponse: { type: Schema.Types.Mixed, default: {} },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    couponDiscount: { type: Number, default: 0 },
    transactionId: { type: String, default: null },
    status: {
      type: String,
      enum: [
        "INITIATED",
        "PENDING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      default: "INITIATED",
      index: true,
    },
    processedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PayoutSchema = new Schema(
  {
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    fee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    method: {
      type: String,
      enum: ["BANK_TRANSFER", "UPI", "PAYTM", "PAYPAL", "CARD"],
      required: true,
    },
    payoutAccount: {
      type: Schema.Types.ObjectId,
      ref: "PayoutAccount",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "APPROVED",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "CANCELLED",
        "ON_HOLD",
      ],
      default: "REQUESTED",
      index: true,
    },
    transactionIds: [{ type: String }],
    settlementBatchId: { type: String, default: null },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PayoutAccountSchema = new Schema(
  {
    astrologerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    accountType: {
      type: String,
      enum: ["BANK", "UPI", "PAYTM", "PAYPAL"],
      required: true,
    },
    isPrimary: { type: Boolean, default: false },
    bankName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    ifscCode: { type: String, default: null },
    accountHolder: { type: String, default: null },
    upiId: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== AUDIT & REPORTING SCHEMAS ====================

const WalletAuditSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "BALANCE_UPDATE",
        "STATUS_CHANGE",
        "KYC_UPDATE",
        "MANUAL_ADJUSTMENT",
        "BLOCK",
        "UNBLOCK",
      ],
      required: true,
    },
    txId: { type: String, required: true, index: true },
    changes: {
      available: { before: Number, after: Number },
      bonus: { before: Number, after: Number },
      locked: { before: Number, after: Number },
    },
    performedBy: {
      type: String,
      enum: ["SYSTEM", "USER", "ADMIN", "ASTROLOGER"],
      required: true,
    },
    performedById: { type: Schema.Types.ObjectId, required: true },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    note: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PlatformEarningsSchema = new Schema(
  {
    date: { type: Date, required: true, index: true },
    currency: { type: String, default: "INR", index: true },
    totalEarnings: { type: Number, default: 0 },
    sessionEarnings: { type: Number, default: 0 },
    rechargeEarnings: { type: Number, default: 0 },
    subscriptionEarnings: { type: Number, default: 0 },
    otherEarnings: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    totalPayouts: { type: Number, default: 0 },
    processingFees: { type: Number, default: 0 },
    totalSessions: { type: Number, default: 0 },
    totalRecharges: { type: Number, default: 0 },
    totalUsers: { type: Number, default: 0 },
    totalAstrologers: { type: Number, default: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const TaxInvoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    entityType: {
      type: String,
      enum: ["USER", "ASTROLOGER", "PLATFORM"],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    invoiceDate: { type: Date, default: Date.now },
    periodFrom: { type: Date, required: true },
    periodTo: { type: Date, required: true },
    taxableAmount: { type: Number, required: true },
    taxAmount: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    taxBreakdown: [
      {
        taxType: { type: String, required: true },
        taxRate: { type: Number, required: true },
        taxAmount: { type: Number, required: true },
      },
    ],
    gstin: { type: String, default: null },
    placeOfSupply: { type: String, default: null },
    status: {
      type: String,
      enum: ["DRAFT", "GENERATED", "SENT", "PAID", "CANCELLED"],
      default: "DRAFT",
    },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// ==================== ADDITIONAL SUPPORT SCHEMAS ====================

const LedgerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet", index: true },
    transactionId: { type: String, index: true },
    entryType: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true },
    beforeBalance: { type: Number },
    afterBalance: { type: Number },
    description: { type: String, default: null },
    immutable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const RefundSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    transactionId: { type: String, required: true },
    reason: { type: String, default: null },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["INITIATED", "SUCCESS", "FAILED"],
      default: "INITIATED",
    },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const WalletHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true },
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    totalDebit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ==================== MODEL EXPORTS ====================

// Configuration Models
export const PlatformConfig = getModel("PlatformConfig", PlatformConfigSchema);
export const TaxConfig = getModel("TaxConfig", TaxConfigSchema);
export const CurrencyConfig = getModel("CurrencyConfig", CurrencyConfigSchema);

// Commission Management Models
export const CommissionRule = getModel("CommissionRule", CommissionRuleSchema);
export const CommissionOverride = getModel(
  "CommissionOverride",
  CommissionOverrideSchema
);
export const CommissionAudit = getModel(
  "CommissionAudit",
  CommissionAuditSchema
);
export const CommissionBatchUpdate = getModel(
  "CommissionBatchUpdate",
  CommissionBatchUpdateSchema
);

// Core Wallet Models
export const Wallet = getModel("Wallet", WalletSchema);
export const Transaction = getModel("Transaction", TransactionSchema);

// Session Billing Models
export const SessionRateConfig = getModel(
  "SessionRateConfig",
  SessionRateConfigSchema
);
export const Reservation = getModel("Reservation", ReservationSchema);
export const BillingTick = getModel("BillingTick", BillingTickSchema);

// Promotion Models
export const Coupon = getModel("Coupon", CouponSchema);
export const CouponUsage = getModel("CouponUsage", CouponUsageSchema);

// Payment & Settlement Models
export const RechargeHistory = getModel(
  "RechargeHistory",
  RechargeHistorySchema
);
export const Payout = getModel("Payout", PayoutSchema);
export const PayoutAccount = getModel("PayoutAccount", PayoutAccountSchema);

// Audit & Reporting Models
export const WalletAudit = getModel("WalletAudit", WalletAuditSchema);
export const PlatformEarnings = getModel(
  "PlatformEarnings",
  PlatformEarningsSchema
);
export const TaxInvoice = getModel("TaxInvoice", TaxInvoiceSchema);

// Additional Models
export const Ledger = getModel("Ledger", LedgerSchema);
export const Refund = getModel("Refund", RefundSchema);
export const WalletHistory = getModel("WalletHistory", WalletHistorySchema);

// ==================== UTILITY FUNCTIONS ====================

export const generateTxId = (prefix = "TXN") => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
};

export const toBaseUnits = (amount, currency = "INR") => {
  return Math.round(amount * 100); // Convert to paise
};

export const fromBaseUnits = (baseUnits, currency = "INR") => {
  return baseUnits / 100; // Convert to rupees
};

export const calculateCommission = async (
  astrologerId,
  sessionType,
  sessionAmount,
  sessionDetails = {}
) => {
  try {
    const now = new Date();

    // 1. Find commission rule matching SESSION TYPE
    const commissionRule = await CommissionRule.findOne({
      isActive: true,
      'conditions.sessionType': sessionType,   // ✅ APPLY HERE
      effectiveFrom: { $lte: now },
      $or: [
        { effectiveTo: null },
        { effectiveTo: { $gte: now } }
      ],
    }).sort({ priority: 1 });
    logger.info('Commission Rule Found:', commissionRule);
    const baseCommission = commissionRule
      ? commissionRule.commissionValue
      : 20;

    // 2. Find override (priority: ASTROLOGER > SESSION_TYPE > GLOBAL)
    const override = await CommissionOverride.findOne({
      isActive: true,
      effectiveFrom: { $lte: now },
      $or: [
        {
          targetType: "ASTROLOGER",
          targetId: astrologerId
        },
        {
          targetType: "SESSION_TYPE",
          targetSessionType: sessionType
        },
        {
          targetType: "GLOBAL"
        }
      ],
      $or: [
        { effectiveTo: null },
        { effectiveTo: { $gte: now } }
      ]
    }).sort({
      targetType: 1 // ASTROLOGER first
    });

    const finalCommissionPercent = override
      ? override.finalCommissionPercent
      : baseCommission;

    const commissionAmount = Math.round(
      (sessionAmount * finalCommissionPercent) / 100
    );

    return {
      baseCommissionPercent: baseCommission,
      finalCommissionPercent,
      commissionAmount,
      astrologerAmount: sessionAmount - commissionAmount,
      platformAmount: commissionAmount,
      appliedRuleId: commissionRule?._id || null,
      overrideId: override?._id || null
    };

  } catch (error) {
    console.error('Error calculating commission:', error);

    // Safe fallback
    const fallbackCommission = 20;
    const commissionAmount = Math.round(
      (sessionAmount * fallbackCommission) / 100
    );

    return {
      baseCommissionPercent: fallbackCommission,
      finalCommissionPercent: fallbackCommission,
      commissionAmount,
      astrologerAmount: sessionAmount - commissionAmount,
      platformAmount: commissionAmount,
      appliedRuleId: null,
      overrideId: null
    };
  }
};

// ==================== DEFAULT EXPORT ====================

export default {
  // Configuration
  PlatformConfig,
  TaxConfig,
  CurrencyConfig,

  // Commission Management
  CommissionRule,
  CommissionOverride,
  CommissionAudit,
  CommissionBatchUpdate,

  // Core Wallet
  Wallet,
  Transaction,

  // Session Billing
  SessionRateConfig,
  Reservation,
  BillingTick,

  // Promotion
  Coupon,
  CouponUsage,

  // Payment & Settlement
  RechargeHistory,
  Payout,
  PayoutAccount,

  // Audit & Reporting
  WalletAudit,
  PlatformEarnings,
  TaxInvoice,

  // Additional Models
  Ledger,
  Refund,
  WalletHistory,

  // Utilities
  generateTxId,
  toBaseUnits,
  fromBaseUnits,
  calculateCommission,
};
