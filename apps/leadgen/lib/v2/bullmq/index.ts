// Public surface of the BullMQ layer. Only the pure config + registry are re-exported
// here so importing the index never loads Redis; server-only pieces (connection,
// queues, health, noop) are imported directly where needed.

export { isBullEnabled, bullPrefix, bullWorkerId } from "./config";
export { V2_QUEUE_NAMES, ALL_V2_QUEUE_NAMES, type V2QueueName } from "./queueNames";
export { defaultJobOptions, type V2JobOptions } from "./jobOptions";
