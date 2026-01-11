import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const SupportSchema = new Schema(
    {
        userId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        issue: {
            type: String,
            required: true,
            trim: true,
            minlength: 5,
            maxlength: 500
        },

        comment: {
            type: String,
            trim: true,
            maxlength: 2000
        },

        status: {
            type: String,
            enum: ["open", "in_progress", "resolved", "closed"],
            default: "open",
            index: true
        },

        priority: {
            type: String,
            enum: ["low", "medium", "high", "critical"],
            default: "medium"
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        }
    },
    {
        timestamps: true,          // createdAt, updatedAt
        versionKey: false
    }
);

/* Compound indexes for production workloads */
SupportSchema.index({ userId: 1, status: 1 });
SupportSchema.index({ createdAt: -1 });

export const Support = model("Support", SupportSchema);
