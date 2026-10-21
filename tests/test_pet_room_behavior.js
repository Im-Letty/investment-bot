'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Behavior = require('../static/pet-room-behavior.js');
const Motion = require('../static/pet-lilac-motion.js');

function fixture(options = {}) {
  let now = 100000, next = 0, visible = true, reduced = false;
  const timers = new Map(), callbacks = [], cues = [];
  const clock = {
    now: () => now,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { at: now + delay, fn }); callbacks.push(fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    visible: () => visible, reducedMotion: () => reduced,
    onCue(value) { cues.push({ ...value, at: now }); }
  };
  const controller = Behavior.create({ ...clock, ...options });
  return { controller, timers, callbacks, cues, clock,
    get now() { return now; },
    show(value) { visible = value; }, reduce(value) { reduced = value; },
    shift(ms) { now += ms; },
    next(late = 0) { const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) return false; timers.delete(entry[0]); now = Math.max(now, entry[1].at) + late; entry[1].fn(); return true; },
    early() { const entry = [...timers.entries()][0]; if (!entry) return false; timers.delete(entry[0]); entry[1].fn(); return true; },
    advance(ms) { const end = now + ms; for (let n = 0; n < 1000; n++) { const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (!entry || entry[1].at > end) { now = end; return; } timers.delete(entry[0]); now = Math.max(now, entry[1].at); entry[1].fn(); } throw new Error('timer loop'); }
  };
}

test('standalone UMD exposes only a controller and performs no work at import or creation', () => {
  const source = fs.readFileSync(require.resolve('../static/pet-room-behavior.js'), 'utf8');
  const sandbox = { window: {} }; vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.window.PetRoomBehavior.create, 'function');
  assert.equal(Object.isFrozen(Behavior), true);
  const f = fixture(); assert.equal(f.timers.size, 0); assert.equal(f.cues.length, 0); assert.equal(Object.isFrozen(f.controller), true);
  assert.deepEqual(Object.keys(f.controller).sort(), ['destroy', 'start', 'stop', 'suspendFor']);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|Math\.random|requestAnimationFrame|\bexp\b|\bcoins\b|buyItem|useItem|saveState/);
});

test('a newborn begins in quiet idle, uses one timer, and rotates real finite cues with long rests', () => {
  const f = fixture({ appearanceKey: 'newborn' });
  assert.equal(f.controller.start(), true); assert.equal(f.controller.start(), true); assert.equal(f.timers.size, 1);
  f.advance(8499); assert.equal(f.cues.length, 0); f.advance(1); assert.equal(f.cues[0].situation, 'direction_left');
  const actual = [];
  for (let n = 0; n < 28; n++) {
    const current = f.cues.at(-1);
    if (current.situation !== 'idle') { actual.push(current); assert.equal(current.durationMs, Motion.durations[current.situation]); assert.ok(current.message); assert.ok(['looking','ears','hands','walking','resting','idle'].includes(current.activity)); }
    assert.equal(f.timers.size, 1); f.next();
  }
  assert.deepEqual(actual.slice(0, 13).map(row => row.situation), ['direction_left','body_ears','room_walk_right','direction_back','body_hands','room_walk_left','relaxed','body_head','direction_right','body_tail','gentlesmile','body_flap','direction_spin']);
  for (let i = 1; i < actual.length; i++) { const gap = actual[i].at - actual[i-1].at - actual[i-1].durationMs; assert.ok(gap >= 7000 && gap <= 12000); assert.notEqual(actual[i].situation, actual[i-1].situation); }
  f.controller.destroy(); assert.equal(f.timers.size, 0);
});

test('every egg remains in egg-compatible reactions while all eight born appearances retain expressive body cues', () => {
  for (const appearanceKey of ['egg','egg_cracked','hatching']) {
    const f = fixture({ appearanceKey }); f.controller.start(); f.advance(150000);
    assert.ok(f.cues.some(row => row.situation === 'curious')); assert.ok(f.cues.some(row => row.situation === 'relaxed'));
    assert.ok(f.cues.every(row => ['idle','curious','relaxed'].includes(row.situation))); for (const row of f.cues) assert.equal(row.durationMs, Motion.durations[row.situation]); f.controller.destroy();
  }
  for (const appearanceKey of ['newborn','baby','toddler','child','juvenile','grown','adult','companion',undefined,'unknown']) {
    const f = fixture({ appearanceKey }); f.controller.start(); f.advance(230000);
    assert.ok(f.cues.some(row => row.situation === 'body_ears')); assert.ok(f.cues.some(row => row.situation === 'body_hands')); assert.ok(f.cues.some(row => row.situation === 'room_walk_left')); assert.ok(f.cues.some(row => row.situation === 'room_walk_right')); assert.ok(f.cues.some(row => row.situation === 'direction_back'));
    assert.ok(f.cues.every(row => !['feeding','cry','angry','scared','celebrate'].includes(row.situation))); f.controller.destroy();
  }
});

test('care cancels the pending action and its old neutral return, then restarts after the full care and idle wait', () => {
  const f = fixture({ appearanceKey: 'newborn' }); f.controller.start(); f.next();
  const oldEnd = f.callbacks.at(-1), start = f.now; assert.equal(f.cues.at(-1).situation, 'direction_left');
  assert.equal(f.controller.suspendFor(8400), true); oldEnd(); assert.equal(f.cues.length, 1); assert.equal(f.timers.size, 1);
  f.advance(8399); assert.equal(f.cues.length, 1); f.advance(1); assert.deepEqual(f.cues.at(-1), { situation: 'idle', durationMs: 0, message: '', activity: 'idle', at: start + 8400 });
  f.advance(8499); assert.equal(f.cues.length, 2); f.advance(1); assert.equal(f.cues.at(-1).situation, 'body_ears', 'restart avoids immediately repeating the previous turn');
  f.controller.destroy();
});

test('repeated care cannot shorten a longer meal, and stopped care never starts hidden autonomy', () => {
  const f = fixture(); f.controller.start(); f.controller.suspendFor(8400); f.advance(1000); f.controller.suspendFor(1500);
  f.advance(7399); assert.equal(f.cues.length, 0); f.advance(1); assert.equal(f.cues.at(-1).situation, 'idle');
  f.controller.stop(); const count = f.cues.length; assert.equal(f.controller.suspendFor(6200), true); assert.equal(f.timers.size, 0); f.advance(1000); f.controller.start(); f.advance(5199); assert.equal(f.cues.length, count); f.advance(1); assert.equal(f.cues.length, count + 1);
  f.controller.destroy();
});

test('stop, destroy and late callbacks cannot revive an old cue or create catch-up actions', () => {
  const f = fixture(); f.controller.start(); const waiting = f.callbacks.at(-1); f.controller.stop(); waiting(); assert.equal(f.cues.length, 0); assert.equal(f.timers.size, 0);
  f.controller.start(); f.next(60000); assert.equal(f.cues.length, 1); f.next(60000); assert.equal(f.cues.length, 2); assert.equal(f.cues.at(-1).situation, 'idle'); assert.equal(f.timers.size, 1);
  const late = f.callbacks.at(-1); f.controller.destroy(); f.controller.destroy(); late(); assert.equal(f.timers.size, 0); assert.equal(f.controller.start(), false); assert.equal(f.controller.suspendFor(1000), false); assert.equal(f.cues.length, 2);
});

test('hidden or reduced-motion rooms are quiet and need an explicit visible resume', () => {
  for (const option of [{ visible: false }, { reducedMotion: true }, { visible() { throw new Error('private'); } }, { reducedMotion() { throw new Error('private'); } }]) {
    const f = fixture(option); assert.equal(f.controller.start(), false); assert.equal(f.timers.size, 0); assert.equal(f.cues.length, 0); f.controller.destroy();
  }
  for (const kind of ['hidden','reduced']) {
    const f = fixture(); f.controller.start(); if (kind === 'hidden') f.show(false); else f.reduce(true); f.next(); assert.equal(f.cues.length, 0); assert.equal(f.timers.size, 0);
    if (kind === 'hidden') f.show(true); else f.reduce(false); f.advance(30000); assert.equal(f.cues.length, 0); f.controller.start(); f.advance(8500); assert.equal(f.cues.length, 1); f.controller.destroy();
  }
  const f = fixture(); f.controller.start(); f.show(false); assert.equal(f.controller.start(), false); assert.equal(f.timers.size, 0); f.controller.destroy();
});

test('reentrant care and stopping inside onCue preserve a single owner of the next deadline', () => {
  let f; f = fixture({ onCue(value) { f.cues.push({ ...value, at: f.now }); if (value.situation === 'direction_left') f.controller.suspendFor(8400); } });
  f.controller.start(); f.next(); assert.equal(f.timers.size, 1); f.advance(6000); assert.equal(f.cues.length, 1); f.advance(2400); assert.equal(f.cues.at(-1).situation, 'idle'); f.controller.destroy();
  let g; g = fixture({ onCue(value) { g.cues.push(value); g.controller.stop(); } }); g.controller.start(); g.next(); assert.equal(g.timers.size, 0); assert.equal(g.cues.length, 1); g.controller.destroy();
});

test('callback, clock and timer exceptions fail closed without leaking timers or exposing errors', () => {
  const f = fixture({ onCue() { throw new Error('private detail'); } }); f.controller.start(); assert.doesNotThrow(() => f.next()); assert.equal(f.timers.size, 0);
  for (const options of [{ now() { throw new Error('private'); } }, { now: () => NaN }, { now: () => Infinity }, { now: () => Number.MAX_VALUE }, { setTimeout() { throw new Error('private'); } }, { onCue: null }]) {
    const g = fixture(options); assert.doesNotThrow(() => assert.equal(g.controller.start(), false)); assert.equal(g.timers.size, 0); g.controller.destroy();
  }
  const g = fixture({ clearTimeout() { throw new Error('private'); } }); g.controller.start(); const stale = g.callbacks.at(-1); g.controller.stop(); stale(); assert.equal(g.cues.length, 0); g.controller.destroy();
});

test('invalid suspensions leave the current deadline intact and early timers cannot shorten care', () => {
  const f = fixture(); f.controller.start(); const before = [...f.timers.keys()];
  for (const value of [NaN, Infinity, -1, '8400', undefined]) assert.equal(f.controller.suspendFor(value), false);
  assert.deepEqual([...f.timers.keys()], before); f.controller.suspendFor(8400); f.shift(-1000); f.early(); assert.equal(f.cues.length, 0); assert.equal(f.timers.size, 1);
  f.advance(8400); assert.equal(f.cues.length, 0); assert.equal(f.timers.size, 1); f.advance(1000); assert.equal(f.cues.at(-1).situation, 'idle');
  f.controller.destroy();
});


test('born room visitors see side and back views before a long frontal-only loop', () => {
  for (const appearanceKey of ['newborn','baby','grown','companion']) {
    const f = fixture({ appearanceKey }); f.controller.start(); f.advance(70000);
    const turns = f.cues.filter(row => row.situation !== 'idle');
    assert.equal(turns[0].situation, 'direction_left');
    assert.ok(turns.some(row => row.situation === 'direction_back'));
    assert.ok(turns.some(row => row.situation.startsWith('room_walk_')));
    f.controller.destroy();
  }
});
