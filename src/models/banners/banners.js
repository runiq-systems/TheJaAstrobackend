import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema({
   
    image: {
        url: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        },
        altText: {
            type: String,
            default: ''
        }
    },
    position: {
        type: String,
        enum: ['top', 'bottom', 'middle', 'sidebar'],
        default: 'top',
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'scheduled'],
        default: 'active',
        required: true
    },
    
    targetAudience: {
        type: String,
        enum: ['all', 'mobile', 'desktop', 'tablet'],
        default: 'all'
    },
   
    impressions: {
        type: Number,
        default: 0,
        min: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    versionKey: false
});

// Index for faster queries
bannerSchema.index({ status: 1, position: 1, order: 1 });
bannerSchema.index({ startDate: 1, endDate: 1 });
bannerSchema.index({ status: 1, targetAudience: 1 });

// Static method to get active banners
bannerSchema.statics.getActiveBanners = async function (position = null) {
    const now = new Date();
    const query = {
        status: 'active',
        startDate: { $lte: now }
    };

    if (position) {
        query.position = position;
    }

    // Check if banner has an end date and if it's still valid
    query.$or = [
        { endDate: null },
        { endDate: { $gte: now } }
    ];

    return this.find(query)
        .sort({ order: 1, createdAt: -1 })
        .select('-__v')
        .lean();
};

// Instance method to increment clicks
bannerSchema.methods.incrementClicks = async function () {
    this.clicks += 1;
    return this.save();
};

// Instance method to increment impressions
bannerSchema.methods.incrementImpressions = async function () {
    this.impressions += 1;
    return this.save();
};

// Pre-save middleware to update order if not provided
bannerSchema.pre('save', async function (next) {
    if (this.isNew && !this.order) {
        const maxOrder = await this.constructor
            .findOne({ position: this.position })
            .sort({ order: -1 })
            .select('order');

        this.order = maxOrder ? maxOrder.order + 1 : 1;
    }
    next();
});

const Banner = mongoose.model('Banner', bannerSchema);

export default Banner;