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
  billing_period: {
    type: String,
    required: true,
    match: /^\d{4}-(0[1-9]|1[0-2])$/,
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
// Prevent duplicate generation for a tenant/month even when two requests race.
// Legacy invoices have no billing period; exclude them so their null values do
// not prevent this index from being created on an existing deployment.
InvoiceSchema.index(
  { hospital_id: 1, billing_period: 1 },
  {
    unique: true,
    partialFilterExpression: { billing_period: { $type: 'string' } },
  },
)

export interface InvoiceDocument extends mongoose.InferSchemaType<typeof InvoiceSchema> {}

export default mongoose.model<InvoiceDocument>('Invoice', InvoiceSchema)
