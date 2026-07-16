import mongoose from 'mongoose'

const RoleDefinitionSchema = new mongoose.Schema({
  role_key: { type: String, required: true, unique: true, index: true },
  label: { type: String, required: true },
  color: { type: String, required: true },
  permissions: { type: Map, of: Boolean, required: true },
}, { timestamps: true })

export interface RoleDefinitionDocument extends mongoose.InferSchemaType<typeof RoleDefinitionSchema> {}

export default mongoose.model<RoleDefinitionDocument>('RoleDefinition', RoleDefinitionSchema)
