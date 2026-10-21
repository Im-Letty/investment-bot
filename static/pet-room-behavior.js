(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PetRoomBehavior = factory(root);
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (environment) {
  'use strict';

  // These are presentation cues only. Real care, inventory and growth belong to
  // the game core. The room never invents a meal or awards an action.
  var initialWait = 8500, gaps = [9000, 11000, 7500, 12000, 9500, 7000];
  var eggs = ['egg', 'egg_cracked', 'hatching'];
  var young = ['newborn', 'baby', 'toddler', 'child', 'juvenile'];
  function cue(situation, durationMs, message, activity) {
    return Object.freeze({ situation: situation, durationMs: durationMs, message: message, activity: activity });
  }
  var eggSequence = Object.freeze([
    cue('curious', 5400, 'たまごが、そっとゆれた', 'looking'),
    cue('relaxed', 6200, 'あたたかそうに、ゆらゆら', 'resting')
  ]);
  var youngSequence = Object.freeze([
    cue('curious', 5400, 'なにか、きになるみたい', 'looking'),
    cue('body_ears', 6000, 'お耳をぴくぴく', 'ears'),
    cue('relaxed', 6200, 'ほっとひとやすみ', 'resting'),
    cue('body_hands', 6000, '小さな手をふっている', 'hands'),
    cue('moving', 1600, 'とことこ、おさんぽ', 'walking'),
    cue('body_head', 6000, 'こてん、と首をかしげた', 'looking'),
    cue('body_tail', 6000, 'しっぽをゆらゆら', 'idle'),
    cue('gentlesmile', 4800, 'こちらを見て、にっこり', 'resting'),
    cue('body_flap', 6600, 'おててを広げて、ぱたぱた', 'hands')
  ]);
  var matureSequence = Object.freeze([
    youngSequence[0], youngSequence[6], youngSequence[2], youngSequence[4],
    youngSequence[3], youngSequence[1], youngSequence[5], youngSequence[7], youngSequence[8]
  ]);

  function create(options) {
    options = options || {};
    var sequence = eggs.indexOf(options.appearanceKey) >= 0 ? eggSequence : young.indexOf(options.appearanceKey) >= 0 ? youngSequence : matureSequence;
    var clock = typeof options.now === 'function' ? options.now : function () { return Date.now(); };
    var schedule = typeof options.setTimeout === 'function' ? options.setTimeout : environment && typeof environment.setTimeout === 'function' ? environment.setTimeout.bind(environment) : null;
    var cancel = typeof options.clearTimeout === 'function' ? options.clearTimeout : environment && typeof environment.clearTimeout === 'function' ? environment.clearTimeout.bind(environment) : null;
    var callback = typeof options.onCue === 'function' ? options.onCue : null;
    var running = false, dead = false, timer = null, epoch = 0, cursor = 0, gapIndex = 0;
    var holdUntil = -Infinity, lastClock = null, lastActive = null;

    function flag(value, fallback) {
      try { return value === undefined ? fallback : typeof value === 'function' ? !!value() : !!value; }
      catch (_) { return !fallback; }
    }
    function eligible() { return !dead && !!callback && !!schedule && !!cancel && flag(options.visible, true) && !flag(options.reducedMotion, false); }
    function time() {
      var value;
      try { value = clock(); } catch (_) { return null; }
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER - 86400000) return null;
      lastClock = lastClock === null ? value : Math.max(lastClock, value);
      return lastClock;
    }
    function clear() {
      epoch++;
      if (timer !== null) { try { cancel(timer); } catch (_) {} timer = null; }
    }
    function stop() { running = false; clear(); }
    function arm(deadline, action) {
      if (!running || !eligible()) { stop(); return false; }
      var at = time();
      if (at === null) { stop(); return false; }
      var token = ++epoch;
      try {
        timer = schedule(function () {
          if (dead || !running || token !== epoch) return;
          timer = null;
          if (!eligible()) { stop(); return; }
          var actual = time();
          if (actual === null) { stop(); return; }
          // Early timers and a backwards wall clock cannot shorten a care hold.
          if (actual < deadline) { arm(deadline, action); return; }
          action(actual);
        }, Math.min(2147483647, Math.max(0, deadline - at)));
        return true;
      } catch (_) { stop(); return false; }
    }
    function emit(value) {
      if (!running || !eligible()) { stop(); return false; }
      var token = epoch;
      try { callback({ situation: value.situation, durationMs: value.durationMs, message: value.message, activity: value.activity }); }
      catch (_) { stop(); return false; }
      return running && !dead && token === epoch;
    }
    function rest(at, delay) { return arm(at + delay, perform); }
    function neutral(at) {
      if (emit({ situation: 'idle', durationMs: 0, message: '', activity: 'idle' })) rest(at, initialWait);
    }
    function perform(at) {
      var row = sequence[cursor++ % sequence.length];
      if (row.situation === lastActive) row = sequence[cursor++ % sequence.length];
      lastActive = row.situation;
      if (!emit(row)) return;
      arm(at + row.durationMs, function (end) {
        if (emit({ situation: 'idle', durationMs: 0, message: '', activity: 'idle' })) rest(end, gaps[gapIndex++ % gaps.length]);
      });
    }
    function start() {
      if (dead) return false;
      if (!eligible()) { stop(); return false; }
      if (running) return true;
      var at = time();
      if (at === null) return false;
      running = true; cursor = 0; gapIndex = 0;
      return holdUntil > at ? arm(holdUntil, neutral) : rest(at, initialWait);
    }
    function suspendFor(durationMs) {
      if (dead || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return false;
      var at = time();
      if (at === null) { stop(); return false; }
      holdUntil = Math.max(holdUntil, at + Math.min(durationMs, 86400000));
      clear(); cursor = 0; gapIndex = 0;
      // A hidden/stopped room records the hold but never starts itself.
      return running ? arm(holdUntil, neutral) : true;
    }
    function destroy() { if (dead) return; stop(); dead = true; callback = null; options = null; }
    return Object.freeze({ start: start, stop: stop, suspendFor: suspendFor, destroy: destroy });
  }
  return Object.freeze({ create: create });
}));
