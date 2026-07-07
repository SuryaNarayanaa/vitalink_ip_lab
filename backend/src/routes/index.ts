import { Router } from "express";
import device_router from "./device.routes"   
import doctor_router from "./doctor.routes";
import auth_router from "./auth.routes";
import patient_router from "./patient.routes";
import admin_router from "./admin.routes";
import statistics_router from "./statistics.routes";

const router = Router();

router.use("/devices", device_router)       
router.use("/doctors", doctor_router)
router.use("/auth", auth_router);
router.use("/patient", patient_router)
router.use("/admin", admin_router)
router.use("/statistics", statistics_router)

export default router;