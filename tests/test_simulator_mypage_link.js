'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

for(const file of ['simulator.html','static/simulator-embed-55a2f12d18.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const start=html.indexOf('function openSiteMyPage(){');
  const end=html.indexOf('\nasync function loadMyPage()',start);
  assert.ok(start>0&&end>start);
  const source=html.slice(start,end);

  function harness({embedded=true,sameOrigin=true,hostMatches=true,withEntry=true,withHost=true,blockedParent=false}={}){
    const calls={entry:0,navigations:[],legacyLoads:0,calculations:0,storage:0,network:0};
    const panels=new Map(['daily','monthly','lump','goal','mypage'].map(name=>[name,{style:{},classList:{add(){},remove(){}},offsetWidth:390}]));
    const document={getElementById:id=>panels.get(id.replace('tab-','')),querySelectorAll:()=>[]};
    const context={document,location:{origin:'https://example.test',assign:route=>calls.navigations.push(route)},
      loadMyPage(){calls.legacyLoads++;},calcD(){calls.calculations++;},calcM(){},calcL(){},calcG(){},
      fetch(){calls.network++;throw Error('Navigation must not request legacy or private records');},
      localStorage:{getItem(){calls.storage++;throw Error('Navigation must not read an identity or record');},setItem(){calls.storage++;throw Error('Navigation must not write a record');}}};
    context.window=context;
    vm.createContext(context);
    const self=vm.runInContext('window',context);
    const entry={click(){calls.entry++;}};
    const parentDocument={getElementById:id=>id==='knSimEmbedFrame'&&withHost?{contentWindow:hostMatches?self:{}}:null,
      querySelector:selector=>selector==='#knBottomNav .bn-item[data-act="mypage"]'&&withEntry?entry:null};
    let parent={location:{origin:sameOrigin?context.location.origin:'https://other.test'}};
    Object.defineProperty(parent,'document',{get(){if(blockedParent)throw Error('Cross-origin parent');return parentDocument;}});
    context.parent=embedded?parent:context;
    vm.runInContext(source,context,{filename:file});
    return {calls,context};
  }

  test(file+': MyPage uses the actual bottom-nav entry without legacy or private record access',()=>{
    const h=harness();
    h.context.switchTab('mypage');h.context.switchTab('mypage');
    assert.equal(h.calls.entry,2);assert.deepEqual(h.calls.navigations,[]);
    assert.equal(h.calls.legacyLoads,0);assert.equal(h.calls.storage,0);assert.equal(h.calls.network,0);
  });

  test(file+': standalone and unavailable hosts use the fixed canonical route without identity parameters',()=>{
    for(const options of [{embedded:false},{withHost:false},{withEntry:false},{hostMatches:false},{sameOrigin:false},{blockedParent:true}]){
      const h=harness(options);h.context.switchTab('mypage');
      assert.equal(h.calls.entry,0);assert.deepEqual(h.calls.navigations,['/?mypage=assets']);
      assert.equal(h.calls.legacyLoads,0);assert.equal(h.calls.storage,0);assert.equal(h.calls.network,0);
    }
  });

  test(file+': the other calculator tabs keep their existing behavior',()=>{
    const h=harness();h.context.switchTab('daily');
    assert.equal(h.calls.calculations,1);assert.equal(h.calls.entry,0);
    assert.equal(h.calls.legacyLoads,0);assert.deepEqual(h.calls.navigations,[]);
  });
}
