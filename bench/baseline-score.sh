#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNS="${RUNS:-3}"
COOLDOWN="${COOLDOWN:-20}"
CONTENT="${CONTENT:-motion}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-${ROOT}/out/baseline-score-${STAMP}.json}"

if ! [[ "${RUNS}" =~ ^[0-9]+$ ]] || [[ "${RUNS}" -lt 1 ]]; then
  echo "RUNS must be a positive integer, got ${RUNS}" >&2
  exit 64
fi

mkdir -p "${ROOT}/out"

SCORE_FILES=()
for ((i = 1; i <= RUNS; i += 1)); do
  SCORE_OUT="${ROOT}/out/score-baseline-${CONTENT}-${STAMP}-run${i}.json"
  echo "baseline score run ${i}/${RUNS}: ${SCORE_OUT}" >&2
  PROFILE=passthrough CONTENT="${CONTENT}" SCORE_OUT="${SCORE_OUT}" "${ROOT}/evaluate.sh" >/dev/null
  SCORE_FILES+=("${SCORE_OUT}")

  if [[ "${i}" -lt "${RUNS}" && "${COOLDOWN}" -gt 0 ]]; then
    echo "cooldown ${COOLDOWN}s" >&2
    sleep "${COOLDOWN}"
  fi
done

node - "${OUT}" "${SCORE_FILES[@]}" <<'NODE'
const fs = require("node:fs");
const [out, ...files] = process.argv.slice(2);
const records = files.map((file) => ({ path: file, ...JSON.parse(fs.readFileSync(file, "utf8")) }));
const scores = records.map((record) => record.score).filter((score) => typeof score === "number" && Number.isFinite(score));
const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
const variance = scores.length > 1
  ? scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / (scores.length - 1)
  : 0;
const aggregate = {
  generatedAt: new Date().toISOString(),
  runCount: records.length,
  score: {
    count: scores.length,
    mean,
    stddev: mean === null ? null : Math.sqrt(variance),
    values: scores,
  },
  runs: records.map((record) => ({
    path: record.path,
    score: record.score,
    gates: record.gates,
    inputs: record.inputs,
  })),
};
fs.writeFileSync(out, `${JSON.stringify(aggregate, null, 2)}\n`);
console.error(out);
console.log(mean);
NODE
