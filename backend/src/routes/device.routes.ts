import { Router } from 'express'
import { authenticate } from '@alias/middlewares/authProvider.middleware'
import { registerDevice, deregisterDevice } from '@alias/controllers/device.controller'

const deviceRouter = Router()

deviceRouter.post('/register',   authenticate, registerDevice)
deviceRouter.delete('/:tokenId', authenticate, deregisterDevice)

export default deviceRouter