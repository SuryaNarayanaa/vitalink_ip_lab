import mongoose from "mongoose";

const DoctorProfileSchema = new mongoose.Schema({
  name: { type: String, required: [true, "Doctor Name is required"] },
  department: { type: String, default: 'Cardiology' },
  contact_number: { type: String },
  phone_verification: {
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED'],
      default: 'PENDING',
    },
    verified_at: { type: Date },
  },
  profile_picture_url: { type: String },
  profile_picture_file_asset_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FileAsset' },
  hospital_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    index: true,
  },
}, {timestamps: true});

export interface DoctorProfileDocument extends mongoose.Document, mongoose.InferSchemaType<typeof DoctorProfileSchema>{}

export default mongoose.model<DoctorProfileDocument>("DoctorProfile", DoctorProfileSchema)
