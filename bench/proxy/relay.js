#!/usr/bin/env node
"use strict";

const dgram = require("node:dgram");
const fs = require("node:fs");
const path = require("node:path");

const CLASS_STUN = "STUN";
const CLASS_DTLS = "DTLS";
const CLASS_RTP = "RTP";
const CLASS_RTCP = "RTCP";
const CLASS_OTHER = "OTHER";

const DIR_CLIENT_TO_HOST = "clientToHost";
const DIR_HOST_TO_CLIENT = "hostToClient";
const DIR_UNKNOWN = "unknown";

function envNumber(name, fallback, env = process.env) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric, got ${value}`);
  return parsed;
}

function defaultStatsPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(__dirname, "..", "out", `proxy-${stamp}.json`);
}

function readConfig(env = process.env) {
  const loss = envNumber("LOSS", 0, env);
  return {
    bindHost: env.PROXY_HOST || "127.0.0.1",
    port: envNumber("PROXY_PORT", 8891, env),
    profile: env.PROFILE || "passthrough",
    seed: env.SEED || "0",
    latencyMs: envNumber("LAT_MS", 0, env),
    jitterMs: envNumber("JIT_MS", 0, env),
    loss,
    geP: envNumber("GE_P", 0.02, env),
    geR: envNumber("GE_R", 0.25, env),
    geLossBad: envNumber("GE_LOSS_BAD", 1, env),
    fragBytes: envNumber("FRAG_BYTES", 1100, env),
    fragLoss: envNumber("FRAG_LOSS", loss > 0 ? loss : 1, env),
    rtcpLoss: envNumber("RTCP_LOSS", 0, env),
    // Residual loss: probability a retransmit is ALSO dropped, modeling real
    // networks where recovery packets are lost too. Default 0 = retransmits
    // always pass (NACK/RTX trivially recovers), which saturates the benchmark.
    retxLoss: envNumber("RETX_LOSS", 0, env),
    burstSchedule: parseBurstSchedule(env.BURST_SCHEDULE || ""),
    statsPath: env.PROXY_STATS ? path.resolve(env.PROXY_STATS) : defaultStatsPath(),
  };
}

function parseBurstSchedule(value) {
  if (!value) return [];
  return value.split(",").filter(Boolean).map((entry) => {
    const [start, duration] = entry.split(":");
    const startMs = Number(start);
    const durationMs = Number(duration);
    if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || startMs < 0 || durationMs <= 0) {
      throw new Error(`BURST_SCHEDULE entries must be startMs:durationMs, got ${entry}`);
    }
    return { startOffsetMs: startMs, durationMs };
  });
}

function hash32(input) {
  let h = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return h >>> 0;
}

function seededFloat(seed, key) {
  return hash32(`${seed}:${key}`) / 0x100000000;
}

function classifyPacket(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { className: CLASS_OTHER };
  const first = buffer[0];
  if (first >= 0x00 && first <= 0x03) return { className: CLASS_STUN };
  if (first >= 0x14 && first <= 0x17) return { className: CLASS_DTLS };
  if (first >= 0x80 && first <= 0xbf) {
    if (buffer.length < 2) return { className: CLASS_OTHER };
    const payloadType = buffer[1] & 0x7f;
    if (payloadType >= 64 && payloadType <= 95) {
      return { className: CLASS_RTCP, payloadType };
    }
    if (buffer.length < 12) return { className: CLASS_RTP, payloadType };
    return {
      className: CLASS_RTP,
      payloadType,
      seq: buffer.readUInt16BE(2),
      timestamp: buffer.readUInt32BE(4),
      ssrc: buffer.readUInt32BE(8),
    };
  }
  return { className: CLASS_OTHER };
}

function emptyClassCounters() {
  return {
    total: 0,
    forwarded: 0,
    dropped: 0,
  };
}

function emptyDirectionCounters() {
  return {
    total: 0,
    forwarded: 0,
    dropped: 0,
    classes: {
      [CLASS_STUN]: emptyClassCounters(),
      [CLASS_DTLS]: emptyClassCounters(),
      [CLASS_RTP]: emptyClassCounters(),
      [CLASS_RTCP]: emptyClassCounters(),
      [CLASS_OTHER]: emptyClassCounters(),
    },
  };
}

function createStats(config) {
  return {
    config,
    startedAt: new Date().toISOString(),
    endedAt: null,
    endpoints: {
      client: null,
      host: null,
    },
    directions: {
      [DIR_CLIENT_TO_HOST]: emptyDirectionCounters(),
      [DIR_HOST_TO_CLIENT]: emptyDirectionCounters(),
      [DIR_UNKNOWN]: emptyDirectionCounters(),
    },
    droppedByProfile: {},
    uniqueSeqsDropped: 0,
    retransmitsPassed: 0,
    retransmitsDropped: 0,
    bursts: [],
    notes: [
      "The first RTP media sender is treated as host-side; the other learned endpoint is treated as client-side.",
      "Fragment profile is size-based because SRTP hides H.264 IDR identity from this relay.",
    ],
  };
}

function addCounter(stats, direction, className, field) {
  const dir = stats.directions[direction] || stats.directions[DIR_UNKNOWN];
  const klass = dir.classes[className] || dir.classes[CLASS_OTHER];
  dir[field] += 1;
  klass[field] += 1;
}

class SeqNormalizer {
  constructor() {
    this.baseSeq = null;
    this.maxNorm = null;
  }

  normalize(seq) {
    if (this.baseSeq === null) {
      this.baseSeq = seq;
      this.maxNorm = 0;
      return 0;
    }
    const diff = (seq - this.baseSeq + 65536) & 0xffff;
    let norm = diff;
    if (this.maxNorm !== null) {
      const turns = Math.round((this.maxNorm - diff) / 65536);
      norm = diff + turns * 65536;
      if (norm < 0) norm += 65536;
    }
    if (this.maxNorm === null || norm > this.maxNorm) this.maxNorm = norm;
    return norm;
  }
}

class Impairer {
  constructor(config, stats = createStats(config)) {
    this.config = config;
    this.stats = stats;
    this.normalizer = new SeqNormalizer();
    this.sendCounts = new Map();
    this.droppedSeqs = new Set();
    this.geStates = [];
    this.startedAtMs = Date.parse(stats.startedAt);
    this.bursts = (config.burstSchedule || []).map((burst) => {
      const startMs = this.startedAtMs + burst.startOffsetMs;
      const endMs = startMs + burst.durationMs;
      return {
        startOffsetMs: burst.startOffsetMs,
        durationMs: burst.durationMs,
        startMs,
        endMs,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
      };
    });
    stats.bursts = this.bursts;
  }

  isPassthrough() {
    return this.config.profile === "passthrough";
  }

  geBadAt(normSeq) {
    for (let i = this.geStates.length; i <= normSeq; i += 1) {
      if (i === 0) {
        this.geStates[i] = false;
        continue;
      }
      const previousBad = this.geStates[i - 1];
      const draw = seededFloat(this.config.seed, `ge:${i}:transition`);
      this.geStates[i] = previousBad ? draw >= this.config.geR : draw < this.config.geP;
    }
    return this.geStates[normSeq] === true;
  }

  markedBurstAt(nowMs) {
    return this.bursts.find((burst) => nowMs >= burst.startMs && nowMs < burst.endMs) || null;
  }

  selectedProfileForRtp(normSeq, length, nowMs) {
    if (this.isPassthrough()) return null;
    if (this.config.profile === "marked-burst") {
      return this.markedBurstAt(nowMs) ? "marked-burst" : null;
    }
    if (this.config.profile === "loss") {
      return seededFloat(this.config.seed, `loss:${normSeq}`) < this.config.loss ? "loss" : null;
    }
    if (this.config.profile === "burst") {
      return this.geBadAt(normSeq) &&
        seededFloat(this.config.seed, `ge:${normSeq}:loss`) < this.config.geLossBad
        ? "burst"
        : null;
    }
    if (this.config.profile === "fragment") {
      return length >= this.config.fragBytes &&
        seededFloat(this.config.seed, `fragment:${normSeq}`) < this.config.fragLoss
        ? "fragment"
        : null;
    }
    return null;
  }

  delayFor(normSeq) {
    if (this.isPassthrough()) return 0;
    const fixed = this.config.latencyMs;
    const jitter = this.config.jitterMs;
    if (fixed <= 0 && jitter <= 0) return 0;
    const draw = seededFloat(this.config.seed, `jitter:${normSeq}`);
    const offset = jitter > 0 ? (draw * 2 - 1) * jitter : 0;
    return Math.max(0, Math.round(fixed + offset));
  }

  decide(packet, direction, length) {
    if (packet.className === CLASS_STUN || packet.className === CLASS_DTLS) {
      return { drop: false, delayMs: 0, reason: null, normSeq: null };
    }

    if (packet.className === CLASS_RTCP) {
      if (!this.isPassthrough() && this.config.rtcpLoss > 0) {
        const draw = seededFloat(this.config.seed, `rtcp:${direction}:${this.stats.directions[direction].total}`);
        if (draw < this.config.rtcpLoss) return { drop: true, delayMs: 0, reason: "rtcpLoss", normSeq: null };
      }
      return { drop: false, delayMs: 0, reason: null, normSeq: null };
    }

    if (packet.className !== CLASS_RTP || direction !== DIR_HOST_TO_CLIENT || typeof packet.seq !== "number") {
      return { drop: false, delayMs: 0, reason: null, normSeq: null };
    }

    const normSeq = this.normalizer.normalize(packet.seq);
    const count = (this.sendCounts.get(normSeq) || 0) + 1;
    this.sendCounts.set(normSeq, count);
    const selectedProfile = this.selectedProfileForRtp(normSeq, length, Date.now());
    const delayMs = this.delayFor(normSeq);
    if (selectedProfile && count === 1) {
      this.droppedSeqs.add(normSeq);
      this.stats.uniqueSeqsDropped = this.droppedSeqs.size;
      return { drop: true, delayMs: 0, reason: selectedProfile, normSeq };
    }
    if (count > 1) {
      if (!this.isPassthrough() && this.config.retxLoss > 0 &&
        seededFloat(this.config.seed, `retx:${normSeq}:${count}`) < this.config.retxLoss) {
        this.droppedSeqs.add(normSeq);
        this.stats.uniqueSeqsDropped = this.droppedSeqs.size;
        this.stats.retransmitsDropped += 1;
        return { drop: true, delayMs: 0, reason: "retxLoss", normSeq };
      }
      if (selectedProfile) this.stats.retransmitsPassed += 1;
    }
    return { drop: false, delayMs, reason: null, normSeq };
  }
}

function endpointKey(rinfo) {
  return `${rinfo.address}:${rinfo.port}`;
}

function endpointObject(rinfo) {
  return { address: rinfo.address, port: rinfo.port };
}

class Relay {
  constructor(config) {
    this.config = config;
    this.socket = dgram.createSocket("udp4");
    this.stats = createStats(config);
    this.impairer = new Impairer(config, this.stats);
    this.client = null;
    this.host = null;
    this.peerA = null;
    this.peerB = null;
    this.exiting = false;
  }

  learnPeer(rinfo) {
    const key = endpointKey(rinfo);
    if (this.peerA && endpointKey(this.peerA) === key) return "peerA";
    if (this.peerB && endpointKey(this.peerB) === key) return "peerB";
    if (!this.peerA) {
      this.peerA = endpointObject(rinfo);
      return "peerA";
    }
    if (!this.peerB) {
      this.peerB = endpointObject(rinfo);
      return "peerB";
    }
    return null;
  }

  destinationForPeer(peer) {
    if (peer === "peerA") return this.peerB;
    if (peer === "peerB") return this.peerA;
    return null;
  }

  assignMediaRoles(source, destination) {
    if (this.host || this.client || !source || !destination) return;
    this.host = source;
    this.client = destination;
    this.stats.endpoints.host = this.host;
    this.stats.endpoints.client = this.client;
  }

  directionFor(source) {
    if (source && this.client && endpointKey(source) === endpointKey(this.client)) return DIR_CLIENT_TO_HOST;
    if (source && this.host && endpointKey(source) === endpointKey(this.host)) return DIR_HOST_TO_CLIENT;
    return null;
  }

  handleMessage(buffer, rinfo) {
    const source = endpointObject(rinfo);
    const peer = this.learnPeer(rinfo);
    const packet = classifyPacket(buffer);
    const destination = this.destinationForPeer(peer);
    if (packet.className === CLASS_RTP) this.assignMediaRoles(source, destination);
    const direction = this.directionFor(source) || DIR_UNKNOWN;
    addCounter(this.stats, direction, packet.className, "total");
    if (!destination) return;

    const decision = this.impairer.decide(packet, direction, buffer.length);
    if (decision.drop) {
      addCounter(this.stats, direction, packet.className, "dropped");
      this.stats.droppedByProfile[decision.reason] = (this.stats.droppedByProfile[decision.reason] || 0) + 1;
      return;
    }

    const forward = () => {
      this.socket.send(buffer, destination.port, destination.address);
      addCounter(this.stats, direction, packet.className, "forwarded");
    };
    if (decision.delayMs > 0) setTimeout(forward, decision.delayMs);
    else forward();
  }

  start() {
    this.socket.on("message", (buffer, rinfo) => this.handleMessage(buffer, rinfo));
    this.socket.on("error", (error) => {
      console.error(error.stack || error.message);
      this.exit(1);
    });
    this.socket.bind(this.config.port, this.config.bindHost, () => {
      const addr = this.socket.address();
      console.error(`relay listening on ${addr.address}:${addr.port} profile=${this.config.profile} seed=${this.config.seed}`);
    });
  }

  writeStats() {
    this.stats.endedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.config.statsPath), { recursive: true });
    fs.writeFileSync(this.config.statsPath, `${JSON.stringify(this.stats, null, 2)}\n`);
    console.error(this.config.statsPath);
  }

  exit(code) {
    if (this.exiting) return;
    this.exiting = true;
    try {
      this.writeStats();
    } catch (error) {
      console.error(error.stack || error.message);
      code = code || 1;
    }
    this.socket.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 200).unref();
  }
}

function main() {
  const config = readConfig();
  const relay = new Relay(config);
  process.on("SIGINT", () => relay.exit(0));
  process.on("SIGTERM", () => relay.exit(0));
  relay.start();
}

if (require.main === module) main();

module.exports = {
  CLASS_DTLS,
  CLASS_OTHER,
  CLASS_RTCP,
  CLASS_RTP,
  CLASS_STUN,
  DIR_CLIENT_TO_HOST,
  DIR_HOST_TO_CLIENT,
  DIR_UNKNOWN,
  Impairer,
  SeqNormalizer,
  classifyPacket,
  createStats,
  readConfig,
  seededFloat,
};
