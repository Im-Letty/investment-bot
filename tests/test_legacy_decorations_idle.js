const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const marker of ['__KN_NEWS_ENHANCE :', '__KN_DRAWER_ICONS :']) {
  const start = html.indexOf(marker);
  assert.ok(start > 0);
  const source = html.slice(html.indexOf('(function(){', start), html.indexOf('</script>', start));
  test(`${marker} leaves the current home idle without DOM reads or timers`, () => {
    const forbidden = () => { throw new Error('legacy decoration touched the current home'); };
    vm.runInNewContext(source, {
      window: {__KN_HOME_A: true},
      document: new Proxy({}, {get: forbidden}),
      getComputedStyle: forbidden, setInterval: forbidden,
    });
  });
  test(`${marker} keeps its legacy startup path when that home is selected`, () => {
    const intervals = [], ready = [];
    vm.runInNewContext(source, {
      window: {__KN_HOME_A: false},
      document: {readyState: 'loading', addEventListener: (event, fn) => ready.push([event, fn])},
      setInterval: (fn, delay) => intervals.push([fn, delay]),
    });
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0][1], 400);
    assert.equal(ready.length, 1);
    assert.equal(ready[0][0], 'DOMContentLoaded');
    assert.equal(ready[0][1], intervals[0][0]);
  });
}
