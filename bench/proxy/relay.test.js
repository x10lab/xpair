#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  CLASS_DTLS,
  CLASS_RTCP,
  CLASS_RTP,
  CLASS_STUN,
  DIR_HOST_TO_CLIENT,
  Impairer,
  SeqNormalizer,
  classifyPacket,
  createStats,
} = require("./relay");

function stunPacket() {
  return Buffer.from([0x00, 0x01, 0x00, 0x00]);
}

function dtlsPacket() {
  return Buffer.from([0x16, 0xfe, 0xfd, 0x00]);
}

function rtcpPacket() {
  return Buffer.from([0x80, 0xc8, 0x00, 0x06]);
}

function rtpPacket(seq, length = 100) {
  const buffer = Buffer.alloc(Math.max(length, 12));
  buffer[0] = 0x80;
  buffer[1] = 96;
  buffer.writeUInt16BE(seq & 0xffff, 2);
  buffer.writeUInt32BE(1234 + seq, 4);
  buffer.writeUInt32BE(0xfeedbeef, 8);
  return buffer;
}

function config(overrides = {}) {
  return {
    profile: "passthrough",
    seed: "relay-test",
    latencyMs: 0,
    jitterMs: 0,
    loss: 0,
    geP: 0.02,
    geR: 0.25,
    geLossBad: 1,
    fragBytes: 1100,
    fragLoss: 1,
    rtcpLoss: 0,
    ...overrides,
  };
}

function droppedSeqs(seed) {
  const cfg = config({ profile: "loss", seed, loss: 0.35 });
  const impairer = new Impairer(cfg, createStats(cfg));
  const dropped = [];
  for (let seq = 4000; seq < 4050; seq += 1) {
    const packet = rtpPacket(seq);
    const decision = impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length);
    if (decision.drop) dropped.push(decision.normSeq);
  }
  return dropped;
}

assert.equal(classifyPacket(stunPacket()).className, CLASS_STUN);
assert.equal(classifyPacket(dtlsPacket()).className, CLASS_DTLS);
assert.equal(classifyPacket(rtcpPacket()).className, CLASS_RTCP);
assert.equal(classifyPacket(rtpPacket(7)).className, CLASS_RTP);
assert.equal(classifyPacket(rtpPacket(7)).seq, 7);

{
  const cfg = config({ profile: "loss", loss: 1 });
  const stats = createStats(cfg);
  const impairer = new Impairer(cfg, stats);
  assert.equal(impairer.decide(classifyPacket(stunPacket()), DIR_HOST_TO_CLIENT, 4).drop, false);
  assert.equal(impairer.decide(classifyPacket(dtlsPacket()), DIR_HOST_TO_CLIENT, 4).drop, false);
  const packet = rtpPacket(1200);
  assert.equal(impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop, true);
  assert.equal(impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop, false);
  assert.equal(stats.retransmitsPassed, 1);
}

assert.deepEqual(droppedSeqs("same-seed"), droppedSeqs("same-seed"));
assert.notDeepEqual(droppedSeqs("same-seed"), droppedSeqs("other-seed"));

// Residual loss (RETX_LOSS): retransmits can also be dropped, so NACK/RTX no
// longer trivially recovers. retxLoss=1 drops every retransmit too.
{
  const cfg = config({ profile: "loss", loss: 1, retxLoss: 1 });
  const stats = createStats(cfg);
  const impairer = new Impairer(cfg, stats);
  const packet = rtpPacket(2200);
  assert.equal(impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop, true);
  const retx = impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length);
  assert.equal(retx.drop, true);
  assert.equal(retx.reason, "retxLoss");
  assert.equal(stats.retransmitsPassed, 0);
  assert.equal(stats.retransmitsDropped, 1);
}

// retxLoss=0 (default) keeps the old behavior: retransmits always pass.
{
  const cfg = config({ profile: "loss", loss: 1, retxLoss: 0 });
  const stats = createStats(cfg);
  const impairer = new Impairer(cfg, stats);
  const packet = rtpPacket(2300);
  impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length);
  assert.equal(impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop, false);
  assert.equal(stats.retransmitsPassed, 1);
  assert.equal(stats.retransmitsDropped, 0);
}

{
  const cfg = config({ profile: "burst", seed: "burst-seed", geP: 0.7, geR: 0.05, geLossBad: 1 });
  const impairer = new Impairer(cfg, createStats(cfg));
  const dropped = [];
  for (let seq = 200; seq < 240; seq += 1) {
    const packet = rtpPacket(seq);
    if (impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop) dropped.push(seq);
  }
  let hasConsecutiveDrop = false;
  for (let i = 1; i < dropped.length; i += 1) {
    if (dropped[i] === dropped[i - 1] + 1) hasConsecutiveDrop = true;
  }
  assert.equal(hasConsecutiveDrop, true, `expected bursty consecutive drops, got ${dropped.join(",")}`);
}

{
  const cfg = config({ profile: "fragment", fragBytes: 1100, fragLoss: 1 });
  const impairer = new Impairer(cfg, createStats(cfg));
  const small = rtpPacket(1, 500);
  const large = rtpPacket(2, 1200);
  assert.equal(impairer.decide(classifyPacket(small), DIR_HOST_TO_CLIENT, small.length).drop, false);
  assert.equal(impairer.decide(classifyPacket(large), DIR_HOST_TO_CLIENT, large.length).drop, true);
}

{
  const cfg = config({ profile: "marked-burst", burstSchedule: [{ startOffsetMs: 1000, durationMs: 500 }] });
  const stats = createStats(cfg);
  const impairer = new Impairer(cfg, stats);
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse(stats.startedAt) + 1100;
    const packet = rtpPacket(10);
    assert.equal(impairer.decide(classifyPacket(packet), DIR_HOST_TO_CLIENT, packet.length).drop, true);
    assert.equal(stats.bursts.length, 1);
    assert.equal(stats.bursts[0].startOffsetMs, 1000);
    Date.now = () => Date.parse(stats.startedAt) + 2000;
    assert.equal(impairer.decide(classifyPacket(rtpPacket(11)), DIR_HOST_TO_CLIENT, packet.length).drop, false);
  } finally {
    Date.now = originalNow;
  }
}

{
  const normalizer = new SeqNormalizer();
  assert.equal(normalizer.normalize(65534), 0);
  assert.equal(normalizer.normalize(65535), 1);
  assert.equal(normalizer.normalize(0), 2);
  assert.equal(normalizer.normalize(1), 3);
}

console.log("relay.test ok");
