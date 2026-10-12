'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('static/ledger-session.js','utf8');
function fixture(seed={}){
 const values=new Map(Object.entries(seed)),attrs=new Map(),events=new Map();let user='alice',timer,fail=false;
 const storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const document={documentElement:{setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)},getElementById:()=>null,createElement:()=>({setAttribute(){}}),body:{appendChild(){}},head:{appendChild(){}}};
 const c={localStorage:storage,document,location:{origin:'https://example.test'},Event:class{constructor(t){this.type=t}},setInterval:fn=>timer=fn,addEventListener:(k,v)=>events.set(k,v),dispatchEvent(){},console};
 c.window=c;c.parent={location:c.location,document:{addEventListener(){}},knEnsureGuest:async()=>{if(fail)throw Error();return {user:{id:user},access_token:'token-'+user}}};
 vm.runInNewContext(source,c);
 return {c,values,attrs,async tick(){await new Promise(r=>setImmediate(r));await timer();},setUser:v=>user=v,setFail:()=>fail=true};
}
test('first verified guest retains existing local input without importing any supplied legacy UID',async()=>{
 const h=fixture({kb2_2026_10:'local-records',lineUserId:'someone-else'});await h.tick();
 assert.equal(h.values.get('kb2_2026_10'),'local-records');assert.equal(h.values.get('kn_ledger_owner'),'alice');assert.equal(h.c.knLedgerSession.user.id,'alice');
});
test('account change preserves old backup but exposes only new account records, and restores when returning',async()=>{
 const h=fixture({kb2_2026_10:'alice-records'});await h.tick();h.setUser('bob');await h.tick();
 assert.equal(h.values.has('kb2_2026_10'),false);assert.match(h.values.get('kn_ledger_backup:alice'),/alice-records/);
 h.values.set('kb2_2026_10','bob-records');h.setUser('alice');await h.tick();assert.equal(h.values.get('kb2_2026_10'),'alice-records');
});
test('failed verification clears active session and hides private contents without deleting stored records',async()=>{
 const h=fixture({kb2_2026_10:'saved-records'});await h.tick();h.setFail();await h.tick();assert.equal(h.c.knLedgerSession,null);assert.equal(h.attrs.has('data-ledger-private-ready'),false);assert.equal(h.values.get('kb2_2026_10'),'saved-records');
});
