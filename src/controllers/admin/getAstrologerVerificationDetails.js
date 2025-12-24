import mongoose from "mongoose";
import { Astrologer } from "../../models/astrologer.js";
import { User } from "../../models/user.js";
import {
    sendEmail, approvalEmailTemplate,
    rejectionEmailTemplate,
} from "../../config/email.service.js";


export const getAstrologerVerificationDetails = async (req, res) => {
    try {
        const { astrologerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(astrologerId)) {
            return res.status(400).json({ success: false, message: "Invalid astrologer ID" });
        }

        const astrologer = await Astrologer.findOne({ userId: astrologerId })
            .populate("userId", "fullName phone email")
            .lean();

        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        return res.json({
            success: true,
            data: {
                astrologerId: astrologer._id,
                user: astrologer.userId,
                kyc: astrologer.kyc,
                bankDetails: astrologer.bankDetails,
                accountStatus: astrologer.accountStatus,
                astrologerApproved: astrologer.astrologerApproved,
                createdAt: astrologer.createdAt,
            },
        });
    } catch (error) {
        console.error("Admin get verification error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};



export const updateAstrologerKYC = async (req, res) => {
    try {
        const { astrologerId } = req.params;
        const kycPayload = req.body;

        const astrologer = await Astrologer.findById(astrologerId);
        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        astrologer.kyc = {
            ...astrologer.kyc,
            ...kycPayload,
            verifiedByAdmin: true,
            verifiedAt: new Date(),
        };

        await astrologer.save();

        return res.json({
            success: true,
            message: "KYC details updated successfully",
            kyc: astrologer.kyc,
        });
    } catch (error) {
        console.error("Admin update KYC error:", error);
        res.status(500).json({ success: false, message: "Failed to update KYC" });
    }
};


export const updateAstrologerBankDetails = async (req, res) => {
    try {
        const { astrologerId } = req.params;
        const { bankDetails } = req.body; // full array replacement (enterprise safe)

        if (!Array.isArray(bankDetails)) {
            return res.status(400).json({
                success: false,
                message: "bankDetails must be an array",
            });
        }

        const astrologer = await Astrologer.findById(astrologerId);
        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        astrologer.bankDetails = bankDetails;
        await astrologer.save();

        return res.json({
            success: true,
            message: "Bank details updated successfully",
            bankDetails: astrologer.bankDetails,
        });
    } catch (error) {
        console.error("Admin update bank error:", error);
        res.status(500).json({ success: false, message: "Failed to update bank details" });
    }
};



export const approveOrRejectAstrologer = async (req, res) => {
    try {
        const { astrologerId } = req.params;
        const { action, rejectionReason } = req.body;

        const astrologer = await Astrologer.findById(astrologerId);
        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        const user = await User.findById(astrologer.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        /* ===================== STATUS UPDATE ===================== */

        let pushTitle = "";
        let pushBody = "";
        let emailSubject = "";
        let emailHtml = "";

        if (action === "approve") {
            astrologer.accountStatus = "approved";
            astrologer.astrologerApproved = true;
            astrologer.isProfilecomplet = true;

            pushTitle = "Profile Approved";
            pushBody = "Your astrologer profile has been approved.";
            emailSubject = "Astrologer Profile Approved";
            emailHtml = approvalEmailTemplate(user.fullName);
        }

        if (action === "reject") {
            astrologer.accountStatus = "rejected";
            astrologer.astrologerApproved = false;
            astrologer.rejectionReason = rejectionReason || "Not specified";

            pushTitle = "Profile Rejected";
            pushBody = "Your astrologer profile was rejected. Please review.";
            emailSubject = "Astrologer Profile Rejected";
            emailHtml = rejectionEmailTemplate(user.fullName, astrologer.rejectionReason);
        }

        if (action === "suspend") {
            astrologer.accountStatus = "suspended";
            astrologer.astrologerApproved = false;

            pushTitle = "Profile Suspended";
            pushBody = "Your astrologer profile has been suspended.";
        }

        await astrologer.save();

        /* ===================== NOTIFICATIONS ===================== */

        // 🔔 Firebase Push
        await sendPushNotification({
            token: user.deviceToken,
            title: pushTitle,
            body: pushBody,
            data: {
                type: "ASTROLOGER_STATUS",
                status: astrologer.accountStatus,
            },
        });

        // 📧 Email
        await sendEmail({
            to: user.email,
            subject: emailSubject,
            html: emailHtml,
        });

        return res.json({
            success: true,
            message: `Astrologer ${action} successfully`,
            status: astrologer.accountStatus,
        });
    } catch (error) {
        console.error("Admin approval error:", error);
        res.status(500).json({ success: false, message: "Approval failed" });
    }
};

