import { Router } from 'express'
import { authenticate } from '@alias/middlewares/authProvider.middleware'
import { validate } from '@alias/middlewares/ValidateResource'
import { registerDevice, deregisterDevice } from '@alias/controllers/device.controller'
import { deregisterDeviceSchema, registerDeviceSchema } from '@alias/validators/device.validator'

const deviceRouter = Router()

deviceRouter.post('/register', authenticate, validate(registerDeviceSchema), registerDevice)
deviceRouter.delete('/:tokenId', authenticate, validate(deregisterDeviceSchema), deregisterDevice)

export default deviceRouter
