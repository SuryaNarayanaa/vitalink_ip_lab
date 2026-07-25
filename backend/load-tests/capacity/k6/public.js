import { setup as scenarioSetup, runProfile } from '../../scenarios/public-auth-devices/scenario.js'
import { capacityOptions, executeCapacityIteration, capacityHandleSummary } from './common.js'

export const options = capacityOptions
export const setup = scenarioSetup
export const handleSummary = capacityHandleSummary
export default function capacityPublic(context) {
  executeCapacityIteration(runProfile, context)
}
