import { setup as scenarioSetup, runProfile } from '../../scenarios/clinical/runner.js'
import { capacityOptions, executeCapacityIteration, capacityHandleSummary } from './common.js'

export const options = capacityOptions
export const setup = scenarioSetup
export const handleSummary = capacityHandleSummary
export default function capacityClinical(context) {
  executeCapacityIteration(runProfile, context)
}
