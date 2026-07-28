import { Router } from "express";
import { validate } from "@alias/middlewares/ValidateResource";
import { authenticate } from "@alias/middlewares/authProvider.middleware";
import {
  activateAdminTotpSchema,
  changePasswordSchema,
  enrollAdminTotpActivateSchema,
  enrollAdminTotpSetupSchema,
  loginSchema,
  refreshTokenSchema,
  resendLoginOtpSchema,
  revokeTokenSchema,
  verifyLoginOtpSchema,
  verifyLoginTotpSchema,
} from "@alias/validators/user.validator";
import {
  changePasswordController,
  activateAdminTotpController,
  activateAdminTotpEnrollmentController,
  getAdminTotpStatusController,
  setupAdminTotpController,
  setupAdminTotpEnrollmentController,
  resendLoginOtpController,
  loginController,
  logoutController,
  getMeController,
  refreshTokenController,
  revokeTokenController,
  verifyLoginTotpController,
  verifyLoginOtpController,
} from "@alias/controllers/auth.controller";

const router = Router();

router.post("/login", validate(loginSchema), loginController);

router.post("/login/otp/verify", validate(verifyLoginOtpSchema), verifyLoginOtpController);

router.post("/login/otp/resend", validate(resendLoginOtpSchema), resendLoginOtpController);

router.post("/login/totp/verify", validate(verifyLoginTotpSchema), verifyLoginTotpController);

// Password-bound MFA enrollment for production/staging unenrolled admins (no session yet).
router.post("/login/totp/enroll/setup", validate(enrollAdminTotpSetupSchema), setupAdminTotpEnrollmentController);

router.post("/login/totp/enroll/activate", validate(enrollAdminTotpActivateSchema), activateAdminTotpEnrollmentController);

router.post("/refresh", validate(refreshTokenSchema), refreshTokenController);

router.post("/revoke", validate(revokeTokenSchema), revokeTokenController);

router.post("/logout", authenticate, logoutController);

router.get("/me", authenticate, getMeController);

router.post("/change-password", authenticate, validate(changePasswordSchema), changePasswordController);

router.post("/admin/mfa/totp/setup", authenticate, setupAdminTotpController);

router.get("/admin/mfa/totp/status", authenticate, getAdminTotpStatusController);

router.post("/admin/mfa/totp/activate", authenticate, validate(activateAdminTotpSchema), activateAdminTotpController);

export default router
