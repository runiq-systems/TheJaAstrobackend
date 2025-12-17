import mongoose from "mongoose";
const { Schema } = mongoose;

/* ===================== COMMON SCHEMAS ===================== */

const PlanetSchema = new Schema(
    {
        id: Number,
        name: String,
    },
    { _id: false }
);

const ZodiacSchema = new Schema(
    {
        id: Number,
        name: String,
        lord: PlanetSchema,
    },
    { _id: false }
);

const PredictionSchema = new Schema(
    {
        type: {
            type: String,
            enum: ["General", "Health", "Career", "Love"],
            required: true,
        },
        prediction: String,
        seek: String,
        challenge: String,
        insight: String,
    },
    { _id: false }
);

const AspectSchema = new Schema(
    {
        planet_one: PlanetSchema,
        planet_Two: PlanetSchema,
        aspect: {
            id: Number,
            name: String,
        },
        effect: String,
    },
    { _id: false }
);

const TransitSchema = new Schema(
    {
        id: Number,
        name: String,
        zodiac: ZodiacSchema,
        house_number: Number,
        is_retrograde: Boolean,
    },
    { _id: false }
);

/* ===================== MAIN DOCUMENT ===================== */

const DailyHoroscopeSignSchema = new Schema(
    {
        // from API: data.datetime
        date: {
            type: Date,
            required: true,
            index: true,
        },

        // from daily_predictions.sign
        sign: {
            id: Number,
            name: {
                type: String,
                required: true,
                index: true,
            },
            lord: PlanetSchema,
        },

        // from daily_predictions.sign_info
        sign_info: {
            modality: String,
            triplicity: String,
            quadruplicity: String,
            unicode_symbol: String,
            icon: String,
        },

        // from daily_predictions.predictions
        predictions: {
            type: [PredictionSchema],
            required: true,
        },

        // from daily_predictions.aspects
        aspects: {
            type: [AspectSchema],
            default: [],
        },

        // from daily_predictions.transits
        transits: {
            type: [TransitSchema],
            default: [],
        },

        // metadata
        source: {
            type: String,
            default: "external_api",
        },
    },
    {
        timestamps: true,
    }
);

/* ===================== UNIQUE RULE ===================== */
// ONE sign per ONE day
DailyHoroscopeSignSchema.index(
    { date: 1, "sign.name": 1 },
    { unique: true }
);

export default mongoose.model(
    "DailyHoroscopeSign",
    DailyHoroscopeSignSchema
);
