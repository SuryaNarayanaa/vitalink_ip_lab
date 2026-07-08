import { Schema } from "mongoose";
import { HealthLog } from "@alias/validators";

export const DosageScheduleSchema = new Schema({
  monday: { type: Number, default: 0 },
  tuesday: { type: Number, default: 0 },
  wednesday: { type: Number, default: 0 },
  thursday: { type: Number, default: 0 },
  friday: { type: Number, default: 0 },
  saturday: { type: Number, default: 0 },
  sunday: { type: Number, default: 0 }
}, { _id: false });

export const InrLogSchema = new Schema({
  test_date: { type: Date, required: true },
  uploaded_at: { type: Date, default: Date.now },
  inr_value: { type: Number, required: true },
  is_critical: { type: Boolean, default: false },
  file_url: { type: String },
  notes: { type: String }
});

export const HealthLogSchema = new Schema({
  date: { type: Date, default: Date.now },
  type: {
    type: String,
    enum: Object.values(HealthLog),
    required: true
  },
  description: { type: String, required: true },
  feedback: { type: String, default: false }
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


export { User, DoctorProfile, PatientProfile, AdminProfile, AuditLog, SystemConfig, Notification, Hospital, Invoice, OtpChallenge, AdminMfaChallenge, AuthSession }

// Aliases for backward compatibility
export const Doctor = DoctorProfile
export const Patient = PatientProfile
