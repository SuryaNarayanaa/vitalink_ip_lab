import { Router } from "express";
import { validate } from "@alias/middlewares/ValidateResource";
import { authenticate } from "@alias/middlewares/authProvider.middleware";
import { changePasswordSchema, loginSchema, resendLoginOtpSchema, verifyLoginOtpSchema } from "@alias/validators/user.validator";
import {
  changePasswordController,
  resendLoginOtpController,
  loginController,
  logoutController,
  getMeController,
  verifyLoginOtpController,
} from "@alias/controllers/auth.controller";

const router = Router();

router.post("/login", validate(loginSchema), loginController);

router.post("/login/otp/verify", validate(verifyLoginOtpSchema), verifyLoginOtpController);

router.post("/login/otp/resend", validate(resendLoginOtpSchema), resendLoginOtpController);

router.post("/logout", authenticate, logoutController);

router.get("/me", authenticate, getMeController);

router.post("/change-password", authenticate, validate(changePasswordSchema), changePasswordController);

export default router
