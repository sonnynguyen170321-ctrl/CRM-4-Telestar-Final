import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const {
  computeSourceActivityHash,
  computeSourceRowHash,
  expandActivityRowsFromRawRow,
  normalizeActivityRow,
  parseTimestampQuality,
} = loadTsModule("lib/v2/activity-recaps/normalizeActivityRow.ts");
const {
  SAMPLE_ACTIVITY_EXPANSION_FIXTURES,
  SAMPLE_ACTIVITY_ROW_FIXTURES,
} = loadTsModule("lib/v2/activity-recaps/__fixtures__/sampleActivityRows.ts");

for (const fixture of SAMPLE_ACTIVITY_ROW_FIXTURES) {
  const result = normalizeActivityRow({
    rawRow: fixture.rawRow,
    sourceRowNumber: 7,
    sourceFileName: "activity-recap.csv",
    sourceSheetName: "Sheet 1",
  });

  assert.equal(result.row.channel, fixture.expected.channel, fixture.name);
  assert.equal(result.row.activityType, fixture.expected.activityType, fixture.name);
  assert.equal(result.row.outcome, fixture.expected.outcome, fixture.name);
  assert.equal(result.row.sourceRowNumber, 7);
  assert.equal(result.row.sourceFileName, "activity-recap.csv");
  assert.equal(result.row.sourceSheetName, "Sheet 1");

  for (const warningCode of fixture.expected.warningCodes ?? []) {
    assert.ok(
      result.warnings.includes(warningCode),
      `${fixture.name} expected warning ${warningCode}`
    );
  }

  assert.equal(result.row.sourceRowHash, computeSourceRowHash(fixture.rawRow));
  assert.equal(typeof result.row.sourceActivityHash, "string");
  assert.equal(result.row.sourceActivityHash.length, 64);
  assert.equal(
    result.row.sourceActivityHash,
    normalizeActivityRow({
      rawRow: fixture.rawRow,
      sourceRowNumber: 7,
      sourceFileName: "activity-recap.csv",
      sourceSheetName: "Sheet 1",
    }).row.sourceActivityHash
  );
  assert.equal(computeSourceRowHash(fixture.rawRow), computeSourceRowHash(fixture.rawRow));
}
console.log("PASS single-event source activity hash is deterministic");

const sameValuesDifferentKeyOrder = {
  b: "second",
  a: "first",
};
const sortedEquivalent = {
  a: "first",
  b: "second",
};
assert.equal(
  computeSourceRowHash(sameValuesDifferentKeyOrder),
  computeSourceRowHash(sortedEquivalent)
);
console.log("PASS source row hash is deterministic across key order");

const blankTextResult = normalizeActivityRow({
  rawRow: {
    channel: "  ",
    status: "  ",
    note: "  ",
    company: " Example Co ",
  },
  sourceRowNumber: 1,
});
assert.equal(blankTextResult.row.companyName, "Example Co");
assert.equal(blankTextResult.row.rawStatus, null);
assert.equal(blankTextResult.row.note, null);
console.log("PASS blank strings normalize to null");

for (const fixture of SAMPLE_ACTIVITY_EXPANSION_FIXTURES) {
  const result = expandActivityRowsFromRawRow({
    rawRow: fixture.rawRow,
    sourceRowNumber: 11,
    sourceFileName: "activity-expansion.csv",
    sourceSheetName: "Sheet 1",
    importRowKind: fixture.importRowKind,
    wideRowChannelMappings: fixture.wideRowChannelMappings,
  });

  assert.equal(result.events.length, fixture.expected.eventCount, fixture.name);
  assert.equal(
    result.requiresManagerReview,
    fixture.expected.requiresManagerReview,
    fixture.name
  );

  for (const warningCode of fixture.expected.warningCodes ?? []) {
    assert.ok(
      result.warnings.includes(warningCode) ||
        result.events.some((event) => event.warnings.includes(warningCode)),
      `${fixture.name} expected warning ${warningCode}`
    );
  }

  for (const [index, expectedEvent] of (
    fixture.expected.eventExpectations ?? []
  ).entries()) {
    const event = result.events[index];

    assert.equal(event.row.channel, expectedEvent.channel, fixture.name);
    assert.equal(event.row.activityType, expectedEvent.activityType, fixture.name);
    assert.equal(event.row.outcome, expectedEvent.outcome, fixture.name);
    assert.equal(event.timestampQuality, expectedEvent.timestampQuality, fixture.name);
    assert.equal(
      event.eventIndexWithinRow,
      expectedEvent.eventIndexWithinRow,
      fixture.name
    );
    assert.equal(event.row.sourceRowHash, computeSourceRowHash(fixture.rawRow));
    assert.equal(typeof event.row.sourceActivityHash, "string", fixture.name);
    assert.equal(event.row.sourceActivityHash.length, 64, fixture.name);
  }

  const repeatedResult = expandActivityRowsFromRawRow({
    rawRow: fixture.rawRow,
    sourceRowNumber: 11,
    sourceFileName: "activity-expansion.csv",
    sourceSheetName: "Sheet 1",
    importRowKind: fixture.importRowKind,
    wideRowChannelMappings: fixture.wideRowChannelMappings,
  });

  assert.deepEqual(
    result.events.map((event) => event.row.sourceActivityHash),
    repeatedResult.events.map((event) => event.row.sourceActivityHash),
    `${fixture.name} expected deterministic sourceActivityHash`
  );
}
console.log("PASS activity expansion fixtures");

const collisionFixture = SAMPLE_ACTIVITY_EXPANSION_FIXTURES.find(
  (fixture) => fixture.name === "event index prevents same event hash collision"
);
const collisionResult = expandActivityRowsFromRawRow({
  rawRow: collisionFixture.rawRow,
  sourceRowNumber: 12,
  importRowKind: collisionFixture.importRowKind,
  wideRowChannelMappings: collisionFixture.wideRowChannelMappings,
});
assert.equal(collisionResult.events.length, 2);
assert.notEqual(
  collisionResult.events[0].row.sourceActivityHash,
  collisionResult.events[1].row.sourceActivityHash
);
console.log("PASS eventIndexWithinRow prevents source activity hash collision");

assert.equal(parseTimestampQuality(null), "missing");
assert.equal(parseTimestampQuality("2026-06-01"), "date_only");
assert.equal(parseTimestampQuality("2026-06-01 10:30"), "exact_datetime");
assert.equal(parseTimestampQuality("yesterday after lunch"), "inferred_from_note");
assert.equal(parseTimestampQuality("not a date"), "unparseable");
assert.equal(parseTimestampQuality(["2026-06-01", "2026-06-02"]), "conflicting");
console.log("PASS timestamp quality parsing");

assert.equal(
  computeSourceActivityHash({
    sourceRowHash: "row-hash",
    channel: "email",
    sourceColumnName: null,
    rawStage: undefined,
    rawTimestamp: null,
    eventIndexWithinRow: 0,
  }),
  computeSourceActivityHash({
    sourceRowHash: "row-hash",
    channel: "email",
    sourceColumnName: "",
    rawStage: "",
    rawTimestamp: "",
    eventIndexWithinRow: 0,
  })
);
console.log("PASS source activity hash normalizes nullish fields");

console.log("PASS V2 activity recap normalization fixtures");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const resolvedPath = resolve(dirname(absolutePath), `${specifier}.ts`);
    const relativeToRoot = resolvedPath.slice(rootDir.length + 1);

    return loadTsModule(relativeToRoot);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
