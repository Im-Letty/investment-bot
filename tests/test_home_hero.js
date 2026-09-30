'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/home-hero.js'),'utf8');
const config=fs.readFileSync(path.join(__dirname,'../static/home-hero-config.js'),'utf8');

test('the shipped setting delegates to the unchanged globe provider',()=>{
  const orbit={markup:'existing globe',mount(){}};
  const context={window:{KNNewsOrbit:orbit}};
  vm.runInNewContext(config,context);
  vm.runInNewContext(source,context);
  assert.equal(context.window.KNHomeHero,orbit);
});

test('missing and invalid settings safely fall back without mounting another scene',()=>{
  for(const value of [undefined,null,{}, {style:'unknown'}, {style:'__proto__'}]){
    const orbit={markup:'existing globe',mount(){throw new Error('unexpected mount');}};
    const context={window:{KNNewsOrbit:orbit,KNHomeHeroConfig:value}};
    vm.runInNewContext(source,context);
    assert.equal(context.window.KNHomeHero,orbit);
  }
});

for(const style of ['paper','town'])test(`${style} uses the existing motion controller with its own description`,()=>{
  let mounted,description;const attrs={};
  const host={closest(selector){assert.equal(selector,'.morning-banner');return{setAttribute(k,v){attrs[k]=v;}};}};
  const orbit={markup:'existing globe',mount(h,options){mounted=h;description=options.descriptions;}};
  const context={window:{KNNewsOrbit:orbit,KNHomeHeroConfig:{style}}};
  vm.runInNewContext(source,context);
  const hero=context.window.KNHomeHero;
  assert.notEqual(hero,orbit);assert.ok(!hero.markup.includes('earth.webp'));
  hero.mount(host);
  assert.equal(mounted,host);assert.equal(attrs['data-kn-home-hero'],style);
  assert.ok(description.ja);assert.ok(description.en);assert.ok(!description.en.includes('Earth'));
});
