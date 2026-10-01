-- Research runs execute on the `research` BullMQ queue instead of in the browser tab.
-- `paused` is the state a run rests in between an operator's Pause and Resume; the worker sets it
-- after finishing the batch in flight, prompted by `pauseRequestedAt`.

-- AlterEnum
ALTER TYPE "ResearchRunStatus" ADD VALUE 'paused';

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN "pauseRequestedAt" TIMESTAMP(3);
