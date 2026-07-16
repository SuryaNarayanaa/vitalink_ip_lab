import { Schema } from "mongoose";
import { HealthLog } from "@alias/validators";

export const DosageScheduleSchema = new Schema({
  monday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  tuesday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  wednesday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  thursday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  friday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  saturday: { type: Number, default: 0, min: 0, validate: Number.isFinite },
  sunday: { type: Number, default: 0, min: 0, validate: Number.isFinite }
}, { _id: false });

export const InrLogSchema = new Schema({
  test_date: { type: Date, required: true },
  uploaded_at: { type: Date, default: Date.now },
  inr_value: { type: Number, required: true, min: Number.MIN_VALUE, max: 20, validate: Number.isFinite },
  is_critical: { type: Boolean, default: false },
  file_url: { type: String },
  file_asset_id: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
  notes: { type: String, maxlength: 4000 }
});

export const HealthLogSchema = new Schema({
  date: { type: Date, default: Date.now },
  type: {
    type: String,
    enum: Object.values(HealthLog),
    required: true
  },
  description: { type: String, required: true, maxlength: 2000 },
  feedback: { type: String }
});

// Now import models
import User from './user.model'
import DoctorProfile from './doctorprofile.model'
import PatientProfile from './patientprofile.model'
import AdminProfile from './adminprofile.model'
import AuditLog from './auditlog.model'
import SystemConfig from './systemconfig.model'
import Notification from './notification.model'
import Hospital from './hospital.model'
import Invoice from './invoice.model'
import OtpChallenge from './otpchallenge.model'
import AdminMfaChallenge from './adminmfachallenge.model'
import AuthSession from './authsession.model'
import FileAsset from './fileasset.model'
import DeviceToken from './DeviceToken.model'
import NotificationDelivery from './notificationdelivery.model'
import RoleDefinition from './roledefinition.model'

export {
  User,
  DoctorProfile,
  PatientProfile,
  AdminProfile,
  AuditLog,
  SystemConfig,
  Notification,
  Hospital,
  Invoice,
  OtpChallenge,
  AdminMfaChallenge,
  AuthSession,
  FileAsset,
  DeviceToken,
  NotificationDelivery,
  RoleDefinition,
}
// Aliases for backward compatibility
export const Doctor = DoctorProfile
export const Patient = PatientProfile
