import mongoose from "mongoose";

const { Schema } = mongoose;

const AppSettingsSchema = new Schema(
    {
        supportEmail: String,
        supportPhone: String,

        minWalletBalance: {
            type: Number,
            default: 0,
        },
        maxWalletBalance: {
            type: Number,
            default: 100000,
        },

        maintenanceMode: {
            type: Boolean,
            default: false,
        },

        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

export default mongoose.models.AppSettings ||
    mongoose.model("AppSettings", AppSettingsSchema);
