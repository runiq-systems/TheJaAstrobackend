import express from "express";
import {
    createSupport,
    getSupportById,
    updateSupport,
    deleteSupport,
    getAllSupports,
    getSupportsByUser
} from "../../controllers/support/Support.js";


const router = express.Router();

router.post("/", createSupport);
router.get("/", getAllSupports);
router.get("/:id", getSupportById);
router.put("/:id", updateSupport);
router.delete("/:id", deleteSupport);
router.get("/user/:userId", getSupportsByUser);

export default router;
