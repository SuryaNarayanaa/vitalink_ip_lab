import mongoose from "mongoose";
import { DosageScheduleSchema, InrLogSchema, HealthLogSchema } from "./index";

const PatientProfileSchema = new mongoose.Schema({
  assigned_doctor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  /** Fence generation of the doctor assignment currently stored above. */
  assigned_doctor_fence: { type: Number, default: 0, min: 0 },
  hospital_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    index: true
  },
  demographics: {
    name: { type: String, required: [true, "Name is required"], maxlength: 200 },
    age: { type: Number, min: 1, max: 120, validate: Number.isInteger },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"]
    },
    phone: { type: String },
    phone_verification: {
      status: {
        type: String,
        enum: ['PENDING', 'VERIFIED'],
        default: 'PENDING',
      },
      verified_at: { type: Date },
    },
    next_of_kin: {
      name: { type: String },
      relation: { type: String },
      phone: { type: String }
    }
  },
  medical_config: {
    diagnosis: { type: String },
    therapy_drug: { type: String },
    therapy_start_date: { type: Date },
    target_inr: {
      min: { type: Number, default: 2.0, min: Number.MIN_VALUE, validate: Number.isFinite },
      max: { type: Number, default: 3.0, min: Number.MIN_VALUE, validate: Number.isFinite }
    },
    next_review_date: { type: Date },
    instructions: {
      type: [{ type: String, maxlength: 500 }],
      validate: [(value: string[]) => value.length <= 50, 'No more than 50 instructions are allowed'],
    },
    taken_doses: { type: [Date] }
  },
  medical_history: [{
    diagnosis: { type: String, maxlength: 500 },
    duration_value: { type: Number, min: Number.MIN_VALUE, validate: Number.isFinite },
    duration_unit: { type: String, enum: ['Days', 'Weeks', 'Months', 'Years'] },
  }],
  weekly_dosage: DosageScheduleSchema,
  inr_history: [InrLogSchema],
  health_logs: [HealthLogSchema],
  account_status: {
    type: String,
    enum: ['Active', 'Discharged', 'Deceased', 'AssignmentConflict'],
    default: 'Active'
  },
  /**
   * Durable fail-closed state used only when a concurrent lifecycle transition
   * makes both sides of a reassignment unsafe. This is not a clinical
   * discharge and requires explicit operator reconciliation.
   */
  assignment_conflict: {
    detected_at: { type: Date },
    attempted_doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    previous_doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, maxlength: 200 },
  },
  profile_picture_url: { type: String },
  profile_picture_file_asset_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FileAsset' },
}, { timestamps: true });

export interface PatientProfileDocument extends mongoose.Document, mongoose.InferSchemaType<typeof PatientProfileSchema> { }

export default mongoose.model<PatientProfileDocument>("PatientProfile", PatientProfileSchema)
