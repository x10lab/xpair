#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { computeRecovery } = require("../score/recovery");

const METRICS = [
  "framesDecoded",
  "decodedFps",
  "bytesReceived",
  "averageBitrateKbps",
  "freezeCount",
  "totalFreezesDuration",
  "packetsLost",
  "jitter",
];

// Derived score terms that score.js normalizes by baseline stddev. They are not
// raw summary fields, so without these keys score.js silently falls back to fixed
// scales. We emit them under the exact names score.js reads. (recoverySpeed is ~0
// for unimpaired baselines that never burst, so it usually epsilon-falls-back
// anyway; pliRate carries real baseline variance. cpuSlope/qpDelta/e2eP95Delta are
// not yet instrumented, so they stay absent and use score.js's epsilon scales.)
const DERIVED_METRICS = ["recoverySpeed", "pliRate"];

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sampleStddev(values, mean) {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function runMetric(record, metric) {
  const summary = record.summary || {};
  if (metric === "jitter") {
    const samples = Array.isArray(record.samples) ? record.samples : [];
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      const value = numberOrNull(samples[i].jitter);
      if (value !== null) return value;
    }
    return null;
  }
  return numberOrNull(summary[metric]);
}

// score.js's rate-from-counter, replicated so baseline pliRate uses the same math.
function rateFromCounter(record, key) {
  const samples = Array.isArray(record.samples) ? record.samples : [];
  let first = null;
  let last = null;
  for (const s of samples) {
    const v = numberOrNull(s[key]);
    if (v !== null) {
      if (first === null) first = v;
      last = v;
    }
  }
  const durationMs = numberOrNull(record.summary && record.summary.durationMs);
  if (first === null || last === null || !durationMs || durationMs <= 0) return null;
  return Math.max(0, last - first) / (durationMs / 1000);
}

function runDerived(record, metric) {
  if (metric === "pliRate") return rateFromCounter(record, "pliCount");
  if (metric === "recoverySpeed") {
    try {
      return numberOrNull(computeRecovery(record).recoverySpeed);
    } catch {
      return null;
    }
  }
  return null;
}

function aggregateRecords(records, content) {
  const metrics = {};

  const collect = (metric, getter) => {
    const values = records.map(getter).filter((value) => value !== null);
    const mean = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    metrics[metric] = {
      count: values.length,
      mean,
      stddev: mean === null ? null : sampleStddev(values, mean),
      values,
    };
  };

  for (const metric of METRICS) {
    collect(metric, (record) => runMetric(record, metric));
  }
  for (const metric of DERIVED_METRICS) {
    collect(metric, (record) => runDerived(record, metric));
  }

  return {
    content,
    runCount: records.length,
    generatedAt: new Date().toISOString(),
    runs: records.map((record) => ({
      path: record.path || null,
      startedAt: record.startedAt || null,
      endedAt: record.endedAt || null,
      summary: record.summary || {},
    })),
    metrics,
  };
}

function printTable(aggregate) {
  const rows = Object.entries(aggregate.metrics);
  console.log("metric                 mean          stddev        n");
  console.log("---------------------  ------------  ------------  --");
  for (const [metric, data] of rows) {
    const mean = data.mean === null ? "n/a" : data.mean.toFixed(3);
    const stddev = data.stddev === null ? "n/a" : data.stddev.toFixed(3);
    console.log(`${metric.padEnd(21)}  ${mean.padStart(12)}  ${stddev.padStart(12)}  ${String(data.count).padStart(2)}`);
  }
}

function readRecord(file) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  record.path = file;
  return record;
}

function main(argv) {
  const [content, out, ...files] = argv;
  if (!content || !out || files.length === 0) {
    throw new Error("usage: variance.js <content> <out> <run-json>...");
  }
  const aggregate = aggregateRecords(files.map(readRecord), content);
  fs.writeFileSync(out, `${JSON.stringify(aggregate, null, 2)}\n`);
  printTable(aggregate);
  console.log(out);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  METRICS,
  aggregateRecords,
  runMetric,
};
