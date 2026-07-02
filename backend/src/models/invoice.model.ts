import mongoose from 'mongoose'

export enum InvoiceStatus {
  PENDING = 'Pending',
  PAID = 'Paid',
  OVERDUE = 'Overdue',
}

const InvoiceSchema = new mongoose.Schema({
  invoice_number: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  hospital_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    required: true,
    index: true,
  },
  plan: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.PENDING,
  },
  issued_date: {
    type: Date,
    default: Date.now,
  },
  due_date: {
    type: Date,
    required: true,
  },
  payment_metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true })

InvoiceSchema.index({ status: 1, due_date: 1 })

export interface InvoiceDocument extends mongoose.InferSchemaType<typeof InvoiceSchema> {}

export default mongoose.model<InvoiceDocument>('Invoice', InvoiceSchema)
