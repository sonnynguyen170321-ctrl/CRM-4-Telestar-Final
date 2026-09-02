import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const events = read("lib/v2/notifications/events.ts");
const client = read("components/v2/notifications/notificationClient.ts");
const bell = read("components/v2/notifications/NotificationBell.tsx");
const topBar = read("components/shared/TopBar.tsx");
const progress = read("components/v2/research/RunProgressPanel.tsx");
const grid = read("components/v2/research/ProspectGrid.tsx");

for (const eventName of [
  "research.run.started",
  "research.stage.completed",
  "research.stage.failed",
  "research.candidate.ready",
  "research.promoted",
  "enrichment.completed",
  "lead.created",
]) {
  assert.match(events, new RegExp(eventName.replaceAll(".", "\\.")), `event contract includes ${eventName}`);
}

assert.match(client, /toast\.success|toast\.error|toast\.warning|toast\(/, "client notification bridge calls Sonner toast");
assert.match(client, /window\.dispatchEvent\(new CustomEvent<V2Notification>\(V2_NOTIFICATION_EVENT_NAME/, "client notification bridge emits the global event");
assert.match(client, /window\.location\.href/, "toast action can navigate to the relevant workspace");

assert.match(bell, /window\.addEventListener\(V2_NOTIFICATION_EVENT_NAME/, "Bell listens for global notifications");
assert.match(bell, /localStorage/, "Bell keeps recent background notifications locally");
assert.match(bell, /No background notifications yet/, "Bell empty state is explicit");
assert.match(topBar, /NotificationBell/, "top bar renders the live notification Bell");
assert.doesNotMatch(topBar, /aria-label="Notifications"[\s\S]*<Bell/, "top bar no longer renders a static Bell button");

assert.match(progress, /notifyV2/, "research progress emits notifications");
assert.match(progress, /research\.run\.started/, "research progress emits run-started events");
assert.match(progress, /research\.stage\.completed/, "research progress emits stage-completed events");
assert.match(progress, /research\.stage\.failed/, "research progress emits failure events");
assert.match(progress, /lead\.created/, "research progress can direct users to leads when promoted leads are ready");
assert.match(progress, /router\.refresh\(\)/, "research progress refreshes the workspace when terminal state is reached");

assert.match(grid, /notifyV2/, "research review actions emit toast/Bell notifications");
assert.match(grid, /research\.promoted/, "promotion action emits promoted event");
assert.match(grid, /Open lead/, "promotion toast exposes the resulting lead link action");

for (const source of [events, client, bell, topBar, progress, grid]) {
  assert.doesNotMatch(source, /Outreach[A-Z]/, "notification layer must stay neutral");
  assert.doesNotMatch(source, /V2IngestionRow|V2IngestionJob/, "notification layer must not depend on ingestion rows");
}

console.log("PASS V2 notification/Bell/auto-nav guards");

function read(path) {
  return readFileSync(path, "utf8");
}