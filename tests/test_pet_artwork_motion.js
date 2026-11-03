'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Art = require('../static/pet-artwork-motion.js');

const milne = 'pet-characters/milne-original8-v1/';
const cases = [
  ['milne-egg', milne + 'egg', []],
  ['milne-newborn', milne + 'newborn', Art.parts],
  ['milne-baby', milne + 'baby', Art.parts],
  ['milne-child', milne + 'child', Art.parts],
  ['milne-adult', milne + 'adult', Art.parts],
  ['bunny-egg', 'pet_bimg_egg', []],
  ['bunny-baby', 'pet_bimg_baby', Art.parts.slice(0, 7)],
  ['bunny-child', 'pet_bimg_child', Art.parts.filter(part => part !== 'leftFoot')],
  ['bunny-final', 'pet_bimg_final', Art.parts.filter(part => part !== 'rightPaw' && part !== 'leftFoot')],
  ['bunny-cool', 'pet_bimg_cool', Art.parts]
];

test('all ten normal still sources have their own bounded regions and no invented hidden parts', () => {
  for (const [id, filename, visible] of cases) {
    const file = `/static/${filename}.webp`;
    assert.ok(fs.statSync(path.join(__dirname, '..', file)).size > 0);
    const profile = Art.profile(file);
    assert.equal(profile.id, id);
    assert.ok(profile.ground > .9 && profile.ground < 1);
    assert.deepEqual(profile.zones.flatMap((zone, i) => zone ? [Art.parts[i]] : []), visible);
    for (const [x, y, rx, ry] of profile.zones.filter(Boolean)) {
      assert.ok(x > 0 && x < 1 && y > 0 && y < profile.ground);
      assert.ok(rx > 0 && rx < .25 && ry > 0 && ry < .25);
    }
    const reduced = Art.pose(profile, 3620, .15, true, true);
    assert.equal(reduced.state, 'neutral');
    assert.equal(reduced.egg, 0);
    assert.ok(reduced.moves.every(move => move.every(n => n === 0)));
    if (!visible.length) {
      const egg = Art.pose(profile, 500, .15, true, false);
      assert.equal(egg.state, 'egg');
      assert.notEqual(egg.egg, 0);
      assert.equal(egg.blink, 0);
      assert.equal(egg.step, 0);
    } else {
      const neutralFace = Art.pose(profile, 100, 0, false, false);
      const blink = Art.pose(profile, 3620, 0, false, false);
      const stride = Art.pose(profile, 500, .53 / 4, true, false);
      const nextStride = Art.pose(profile, 500, .53 * .75, true, false);
      assert.ok(blink.moves[0][2] > neutralFace.moves[0][2]);
      assert.equal(stride.state, 'walking');
      assert.ok(stride.moves[7][1] > nextStride.moves[7][1]);
      assert.ok(stride.moves[8][1] < nextStride.moves[8][1]);
      assert.ok(stride.moves[3][0] * nextStride.moves[3][0] < 0);
      assert.notEqual(stride.moves[5][1], nextStride.moves[5][1]);
      assert.notEqual(stride.moves[9][0], nextStride.moves[9][0]);
    }
  }
  for (const key of ['unknown', '__proto__', '/static/pet_lilac_original.webp']) assert.equal(Art.profile(key), null);
});
