(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetGameCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // One record contains the entire economy. A rejected write never publishes a
  // candidate state. The host may supply an awaited encrypted storage adapter.
  var KEY = 'pet_game_v3', MAX = 9000000000000, MAX_BYTES = 1000000;
  // Birth origin is chosen once, independently of later care-driven evolution.
  // Older records omit it and keep their existing B without an initialization write.
  var eggCatalogue = Object.freeze([
    {key:'lilac',eggLabel:'すみれのたまご',characterName:'ふわり',colorName:'薄紫',color:'#b5a0d9',description:'ふっくらした頬とふわ耳'},
    {key:'mint',eggLabel:'しずくのたまご',characterName:'しずく',colorName:'ミント',color:'#98c8be',description:'少し長い耳とすらりとした姿'},
    {key:'apricot',eggLabel:'ひだまりのたまご',characterName:'まる',colorName:'杏色',color:'#e6bb8e',description:'小さな耳とぽってりしたおなか'}
  ].map(function(egg){return Object.freeze(egg);}));
  // Visual growth information is separate from the existing reward/unlock stages.
  var lilacGrowthStages = Object.freeze([
    {key:'egg',label:'うまれたて',min:0},
    {key:'baby',label:'よちよち',min:15},
    {key:'child',label:'こども',min:45},
    {key:'final',label:'わかもの',min:110},
    {key:'adult',label:'おとな',min:400},
    {key:'companion',label:'なかよしの姿',min:800}
  ].map(function(stage){return Object.freeze(stage);}));
  // Finer appearance steps never become saved evolution milestones. The six
  // canonical growth rows above remain authoritative for history and colors.
  var lilacAppearanceStages = Object.freeze([
    {key:'egg',label:'たまご',min:0},
    {key:'egg_cracked',label:'ひびのたまご',min:5},
    {key:'hatching',label:'もうすぐうまれる',min:10},
    {key:'newborn',label:'うまれたて',min:15},
    {key:'baby',label:'あかちゃん',min:30},
    {key:'toddler',label:'よちよち',min:45},
    {key:'child',label:'こども',min:75},
    {key:'juvenile',label:'わかもの',min:110},
    {key:'grown',label:'育った姿',min:200},
    {key:'adult',label:'おとな',min:400},
    {key:'companion',label:'なかよしの姿',min:800}
  ].map(function(stage){return Object.freeze(stage);}));
  var lilacEvolutionPaths = Object.freeze([
    {key:'balanced',label:'のんびり',colorName:'薄紫',color:'#b5a0d9',description:'毎日のふれあいを大切にする、のんびりした姿。',hint:'日を分けて続けたり、ごはん・なでる・休むを組み合わせよう。'},
    {key:'fruit',label:'はなほっぺ',colorName:'桃色',color:'#d99eae',description:'くだもののお世話から育つ、はなやかなほっぺの姿。',hint:'いつものごはんや、りんご・いちごが好き。'},
    {key:'hearty',label:'ぽかぽか',colorName:'はちみつ色',color:'#d2ad70',description:'しっかりしたごはんから育つ、あたたかな姿。',hint:'おにぎりや、ごちそうのお世話をしてみよう。'},
    {key:'sweet',label:'おやつっこ',colorName:'杏色',color:'#dfa88b',description:'おやつのお世話から育つ、やさしい杏色の姿。',hint:'ケーキのお世話をしてみよう。'},
    {key:'active',label:'そよかぜ',colorName:'空色',color:'#92b4d1',description:'いっしょに遊んで育つ、軽やかな姿。',hint:'なでたり、ミニゲームで遊んでみよう。'},
    {key:'calm',label:'まどろみ',colorName:'ミント色',color:'#9dbfb0',description:'休むお世話から育つ、おだやかな姿。',hint:'ゆっくり休む時間を作ってみよう。'}
  ].map(function(path){return Object.freeze(path);}));
  var LIMITS = {care:{feed:3,play:3,rest:3},minigamesPerDay:3,maxScore:30,minigameDurationMs:25000,
    marketAdvancesPerDay:12,feeRate:0.01,minFee:1,dividendEvery:5};
  var STOCKS = [
    {id:'apl',name:'りんご商事',emoji:'🍎',base:40,volatility:0.14,dividendRate:0.03},
    {id:'rkt',name:'ロケット技研',emoji:'🚀',base:80,volatility:0.28,dividendRate:0.01},
    {id:'grn',name:'みどり農園',emoji:'🌱',base:25,volatility:0.08,dividendRate:0.05},
    {id:'gam',name:'あそびゲームズ',emoji:'🎮',base:55,volatility:0.22,dividendRate:0.02},
    {id:'bnk',name:'かいてい銀行',emoji:'🏦',base:60,volatility:0.10,dividendRate:0.06},
    {id:'fud',name:'もぐもぐフード',emoji:'🍔',base:35,volatility:0.16,dividendRate:0.03}
  ];
  var ITEMS = [
    {id:'apple',name:'りんご',emoji:'🍎',type:'food',price:8,exp:3},
    {id:'cake',name:'ケーキ',emoji:'🍰',type:'food',price:18,exp:6},
    {id:'berry',name:'いちご',emoji:'🍓',type:'food',price:6,exp:2},
    {id:'rice',name:'おにぎり',emoji:'🍙',type:'food',price:12,exp:4},
    {id:'feast',name:'ごちそう',emoji:'🍗',type:'food',price:15,exp:20},
    {id:'house',name:'おうち',emoji:'🏠',type:'decoration',price:40},
    {id:'tree',name:'き',emoji:'🌳',type:'decoration',price:25},
    {id:'flower',name:'はな',emoji:'🌷',type:'decoration',price:15},
    {id:'fountain',name:'ふんすい',emoji:'⛲',type:'decoration',price:60},
    {id:'sunflower',name:'ひまわり',emoji:'🌻',type:'decoration',price:20},
    {id:'mushroom',name:'きのこ',emoji:'🍄',type:'decoration',price:18},
    {id:'lantern',name:'とうろう',emoji:'🏮',type:'decoration',price:30},
    {id:'bg_meadow',name:'そうげん',emoji:'🌿',type:'background',price:0},
    {id:'bg_beach',name:'うみべ',emoji:'🏖️',type:'background',price:40},
    {id:'bg_snow',name:'ゆきやま',emoji:'🏔️',type:'background',price:40},
    {id:'bg_room',name:'おへや',emoji:'🏠',type:'background',price:40},
    {id:'cloth_cream_vest',name:'はじめてベスト',emoji:'🦺',type:'clothing',price:0},
    {id:'cloth_rose_cape',name:'ももいろケープ',emoji:'🧣',type:'clothing',price:30},
    {id:'cloth_sky_overalls',name:'そらいろサロペット',emoji:'👖',type:'clothing',price:45},
    {id:'cloth_mint_knit',name:'ミントのニット',emoji:'🧶',type:'clothing',price:40},
    {id:'cloth_star_pajamas',name:'星のおやすみ服',emoji:'🌙',type:'clothing',price:55},
    {id:'cloth_flower_dress',name:'お花のワンピース',emoji:'🌼',type:'clothing',price:65}
  ];
  // Optional, additive room layout shares the existing durable v3 record.
  // The six built-ins are free room fixtures; decoration ownership stays separate.
  var ROOM_FURNITURE = Object.freeze([
    {id:'room_window',name:'まど',x:11,y:2,flip:false},
    {id:'room_shelf',name:'ほんだな',x:88,y:10,flip:false},
    {id:'room_rug',name:'ラグ',x:50,y:93,flip:false},
    {id:'room_bed',name:'ベッド',x:94,y:86,flip:false},
    {id:'room_bowl',name:'ごはんのうつわ',x:10,y:91,flip:false},
    {id:'room_toy',name:'おもちゃ',x:25,y:94,flip:false}
  ].map(function(row){return Object.freeze(row);}));
  var LEGACY_KEYS = ['pg_exp','pg_coins','pg_name','pg_species','pg_deco','pg_bg','pg_bgs',
    'pg_ach','pg_day','pg_feed','pg_pet','pg_play','pg_cnt_feed','pg_cnt_pet','pg_mg_best',
    'pg_path','pg_px','pg_kakeibo_day','pg_kakeibo_rwd','pg_login_day','pg_morning_day',
    'pg_items','sk_total','sk_streak','pet_game'];
  var PG_RECORD_KEYS = ['pg_exp','pg_coins','pg_name','pg_species','pg_deco','pg_bg','pg_bgs',
    'pg_ach','pg_day','pg_feed','pg_pet','pg_play','pg_cnt_feed','pg_cnt_pet','pg_mg_best','pg_path','pg_px','pg_items'];
  var FOOD_IDS = {'🍎':'apple','🍰':'cake','🍓':'berry','🍙':'rice','🍗':'feast'};
  var ERRORS = {
    corrupt_data:'保存内容を読み込めません。元の記録を保持しました。',corrupt_legacy:'以前の記録を確認できません。元の記録を保持しました。',
    storage_failed:'保存できませんでした。進捗は変更していません。',storage_unavailable:'この端末の保存先を利用できません。',
    storage_read_failed:'保存内容を確認できません。元の記録を保持しました。',read_only:'保存内容を確認できないため変更できません。',
    stale_state:'別の画面で記録が変わりました。再読み込みしてから操作してください。',storage_full:'保存できる容量を超えました。',
    daily_limit:'今日の回数を使い切りました。また明日あそぼう。',clock_moved_back:'日付が以前に戻っています。端末の日付を確認してください。',
    invalid_clock:'端末の日時を確認してください。',invalid_random:'値動きを作成できませんでした。',invalid_action:'この操作には対応していません。',
    invalid_name:'名前は40文字までで入力してください。',invalid_species:'キャラクターを選んでください。',invalid_item:'アイテムを確認してください。',
    invalid_egg:'たまごを選んでください。',egg_required:'最初にいっしょに育つたまごを選んでください。',
    egg_already_chosen:'このこのたまごは選択済みです。',egg_species_locked:'選んだたまごから生まれた子を育ててください。',
    appearance_locked:'さいしゅうしんかすると姿を選べます。',invalid_appearance:'姿と表示方法を確認してください。',
    invalid_room_layout:'家具の配置を確認してください。保存済みのお部屋は変更していません。',
    insufficient_coins:'コインが足りません。',already_owned:'すでに持っています。',not_owned:'このアイテムを持っていません。',
    game_active:'進行中のミニゲームを終えてから開始してください。',invalid_session:'このミニゲームは終了済み、または確認できません。',
    invalid_score:'ミニゲームの結果を確認してください。',game_too_short:'ミニゲームを遊んでから結果を保存してください。',
    invalid_trade:'株数は1以上の整数で入力してください。',amount_overflow:'扱える金額を超えています。',insufficient_shares:'保有株数が足りません。',
    legacy_already_transferred:'移せる旧ゲームの記録はありません。',legacy_pot_empty:'引き出せる旧ポット資産はありません。',invalid_backup:'バックアップの形式を確認してください。'
  };
  var locks = new WeakMap();
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
  function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function eggProfile(key) { return eggCatalogue.find(function(egg){return egg.key===key;})||eggCatalogue[0]; }
  function validEggKey(key) { return typeof key==='string'&&eggCatalogue.some(function(egg){return egg.key===key;}); }
  function needsEggChoice(s) { return !!(plain(s)&&plain(s.pet)&&own(s.pet,'eggOrigin')&&s.pet.eggOrigin===null); }
  function getEggOrigin(s) { return needsEggChoice(s)?null:plain(s)&&plain(s.pet)&&validEggKey(s.pet.eggOrigin)?s.pet.eggOrigin:'lilac'; }
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function check(ok, code) { if (!ok) fail(code || 'invalid_data','保存内容または入力を確認してください。'); }
  function amount(n, signed) { return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX && (signed || n >= 0); }
  function integer(n) { return amount(n,false) && Number.isSafeInteger(n); }
  function text(v, n) { return typeof v === 'string' && v.length <= n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function validDay(v, empty) { if (empty && v === '') return true; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; var d=new Date(v+'T12:00:00');return Number.isFinite(d.getTime()) && dayKey(d.getTime())===v; }
  function sameLegacyDay(a,b) { return typeof a==='string' && a.split('-').map(Number).join('-')===b.split('-').map(Number).join('-'); }
  function parse(raw) {
    check(typeof raw==='string' && raw.length<=MAX_BYTES,'corrupt_data');
    try { return JSON.parse(raw,function(k,v) { check(k!=='__proto__' && k!=='prototype' && k!=='constructor','corrupt_data');return v; }); }
    catch(e) { fail('corrupt_data','保存内容を読み込めません。元の記録を保持しました。'); }
  }
  function finiteTree(v, depth) {
    check(depth<30,'corrupt_data');
    if(typeof v==='number')check(Number.isFinite(v),'corrupt_data');
    if(v && typeof v==='object') Object.keys(v).forEach(function(k) { check(k!=='__proto__'&&k!=='constructor'&&k!=='prototype','corrupt_data');finiteTree(v[k],depth+1); });
  }
  function counts(v) { check(plain(v),'corrupt_data');Object.keys(v).forEach(function(k){check(text(k,100)&&integer(v[k]),'corrupt_data');}); }
  function getStage(exp) {
    var a=[{key:'egg',label:'たまご',min:0},{key:'baby',label:'うまれたて',min:15},
      {key:'child',label:'こども',min:45},{key:'final',label:'さいしゅうしんか',min:110}];
    var i=0;while(i+1<a.length&&exp>=a[i+1].min)i++;
    var s=clone(a[i]);s.next=i+1<a.length?a[i+1].min:null;
    s.progress=s.next===null?100:Math.max(0,Math.min(100,Math.round((exp-s.min)/(s.next-s.min)*100)));return s;
  }
  function getLilacGrowth(exp) {
    exp=typeof exp==='number'&&Number.isFinite(exp)?Math.max(0,Math.min(MAX,exp)):0;
    var i=0;while(i+1<lilacGrowthStages.length&&exp>=lilacGrowthStages[i+1].min)i++;
    var s=clone(lilacGrowthStages[i]);s.next=i+1<lilacGrowthStages.length?lilacGrowthStages[i+1].min:null;
    if(s.key==='companion'){s.min=Math.floor(exp/800)*800;s.next=s.min<=MAX-800?s.min+800:null;}
    s.progress=s.next===null?100:Math.max(0,Math.min(100,Math.round((exp-s.min)/(s.next-s.min)*100)));
    s.remaining=s.next===null?0:s.next-exp;return s;
  }
  function getLilacAppearance(exp) {
    exp=typeof exp==='number'&&Number.isFinite(exp)?Math.max(0,Math.min(MAX,exp)):0;
    var i=0;while(i+1<lilacAppearanceStages.length&&exp>=lilacAppearanceStages[i+1].min)i++;
    var s=clone(lilacAppearanceStages[i]);s.next=i+1<lilacAppearanceStages.length?lilacAppearanceStages[i+1].min:null;
    if(s.key==='companion'){s.min=Math.floor(exp/800)*800;s.next=s.min<=MAX-800?s.min+800:null;}
    s.progress=s.next===null?100:Math.max(0,Math.min(100,Math.round((exp-s.min)/(s.next-s.min)*100)));
    s.remaining=s.next===null?0:s.next-exp;return s;
  }
  function evolutionPath(key) {return lilacEvolutionPaths.find(function(path){return path.key===key;});}
  function evolutionScores() {var scores={};lilacEvolutionPaths.forEach(function(path){scores[path.key]=0;});return scores;}
  function exactKeys(value,keys) {return plain(value)&&Object.keys(value).length===keys.length&&keys.every(function(key){return own(value,key);});}
  function dayOrdinal(day) {var parts=day.split('-').map(Number);return Math.floor(Date.UTC(parts[0],parts[1]-1,parts[2])/86400000);}
  function validateEvolution(e,s) {
    check(exactKeys(e,['version','startedAt','startedDay','baselineExp','lastAt','lastDay','activeDays','routineDays','meals','care','scores','day','history'])&&e.version===1,'corrupt_data');
    check(integer(e.startedAt)&&integer(e.lastAt)&&e.startedAt>=s.createdAt&&e.lastAt>=e.startedAt,'corrupt_data');
    check(integer(e.baselineExp)&&e.baselineExp<=s.pet.exp&&validDay(e.startedDay,false)&&validDay(e.lastDay,false)&&e.lastDay>=e.startedDay,'corrupt_data');
    check(integer(e.activeDays)&&e.activeDays>=1&&e.activeDays<=dayOrdinal(e.lastDay)-dayOrdinal(e.startedDay)+1,'corrupt_data');
    check(integer(e.routineDays)&&e.routineDays<e.activeDays&&integer(e.meals)&&e.meals<=e.activeDays*3,'corrupt_data');
    check(exactKeys(e.care,['feed','play','rest']),'corrupt_data');
    ['feed','play','rest'].forEach(function(key){check(integer(e.care[key])&&e.care[key]<=e.activeDays*3,'corrupt_data');});
    check(e.care.feed<=e.meals&&e.meals+e.care.play+e.care.rest>=e.activeDays,'corrupt_data');
    var scoreKeys=lilacEvolutionPaths.map(function(path){return path.key;});check(exactKeys(e.scores,scoreKeys),'corrupt_data');
    scoreKeys.forEach(function(key){check(integer(e.scores[key]),'corrupt_data');});
    check(e.scores.fruit+e.scores.hearty+e.scores.sweet<=e.meals*3-e.care.feed&&e.scores.active<=e.care.play*3&&e.scores.calm<=e.care.rest*3,'corrupt_data');
    check(e.scores.balanced<=e.routineDays*3+Math.min(e.activeDays,e.meals,e.care.play,e.care.rest)*4,'corrupt_data');
    check(exactKeys(e.day,['meals','play','rest']),'corrupt_data');
    ['meals','play','rest'].forEach(function(key){check(integer(e.day[key])&&e.day[key]<=3,'corrupt_data');});
    check(e.day.meals+e.day.play+e.day.rest>0&&e.day.meals<=e.meals&&e.day.play<=e.care.play&&e.day.rest<=e.care.rest,'corrupt_data');
    check(Array.isArray(e.history)&&e.history.length<=12,'corrupt_data');var previousMin=e.baselineExp,previousAt=e.startedAt;
    e.history.forEach(function(entry){
      check(exactKeys(entry,['stageKey','min','branch','at']),'corrupt_data');
      var stage=lilacGrowthStages.find(function(row){return row.key===entry.stageKey;});
      check(stage&&stage.min>0&&integer(entry.min)&&(stage.key==='companion'?entry.min>=800&&entry.min%800===0:entry.min===stage.min)&&entry.min>previousMin&&entry.min<=s.pet.exp&&!!evolutionPath(entry.branch),'corrupt_data');
      check(integer(entry.at)&&entry.at>=previousAt&&entry.at<=e.lastAt,'corrupt_data');previousMin=entry.min;previousAt=entry.at;
    });
    return e;
  }
  function bestEvolution(scores,previous) {
    var max=0,winners=[];lilacEvolutionPaths.forEach(function(path){var score=scores[path.key];if(score>max){max=score;winners=[path.key];}else if(score===max&&score>0)winners.push(path.key);});
    return max===0?previous:winners.length===1?winners[0]:'balanced';
  }
  function getLilacEvolution(s) {
    var e=s&&s.evolution,exp=s&&s.pet?s.pet.exp:0;
    if(e){try{validateEvolution(e,s);}catch(_){e=null;}}
    var previous=e&&e.history.length?e.history[e.history.length-1].branch:'balanced';
    var scores=e?clone(e.scores):evolutionScores(),hasScores=lilacEvolutionPaths.some(function(path){return scores[path.key]>0;});
    return {current:clone(evolutionPath(previous)),tendency:hasScores?clone(evolutionPath(bestEvolution(scores,previous))):null,
      tracked:!!e,activeDays:e?e.activeDays:0,routineDays:e?e.routineDays:0,meals:e?e.meals:0,
      care:e?clone(e.care):{feed:0,play:0,rest:0},scores:scores,startedAt:e?e.startedAt:null,baselineExp:e?e.baselineExp:null,
      history:e?clone(e.history):[],nextAt:getLilacGrowth(exp).next};
  }
  // Only future, successfully saved B care contributes. Older totals are never
  // reconstructed into meals or daily frequency, and interval resets keep caps.
  function recordEvolution(next,beforeExp,kind,ms) {
    if(next.pet.species!=='lilac'||next.pet.exp<=beforeExp)return;
    check(ms>=next.updatedAt&&ms>=next.createdAt,'clock_moved_back');
    var day=dayKey(ms),e=next.evolution;
    if(!e)e=next.evolution={version:1,startedAt:ms,startedDay:day,baselineExp:beforeExp,lastAt:ms,lastDay:day,
      activeDays:1,routineDays:0,meals:0,care:{feed:0,play:0,rest:0},scores:evolutionScores(),day:{meals:0,play:0,rest:0},history:[]};
    else {
      check(ms>=e.lastAt&&day>=e.lastDay,'clock_moved_back');
      if(day!==e.lastDay){
        if(dayOrdinal(day)-dayOrdinal(e.lastDay)===1){e.routineDays++;e.scores.balanced+=3;}
        e.activeDays++;e.day={meals:0,play:0,rest:0};e.lastDay=day;
      }
      e.lastAt=ms;
    }
    var allKinds=e.day.meals>0&&e.day.play>0&&e.day.rest>0;
    if(kind==='play'){if(e.day.play<3){e.day.play++;e.care.play++;e.scores.active+=3;}}
    else if(kind==='rest'){if(e.day.rest<3){e.day.rest++;e.care.rest++;e.scores.calm+=3;}}
    else if(e.day.meals<3){e.day.meals++;e.meals++;if(kind==='feed')e.care.feed++;e.scores[kind==='feed'?'fruit':kind]+=kind==='feed'?2:3;}
    if(!allKinds&&e.day.meals>0&&e.day.play>0&&e.day.rest>0)e.scores.balanced+=4;
    var boundary=getLilacGrowth(beforeExp).next;
    if(boundary!==null&&boundary<=next.pet.exp){
      var previous=e.history.length?e.history[e.history.length-1].branch:'balanced';
      var stage=boundary>=800?'companion':lilacGrowthStages.find(function(row){return row.min===boundary;}).key;
      e.history.push({stageKey:stage,min:boundary,branch:bestEvolution(e.scores,previous),at:ms});
      if(e.history.length>12)e.history.shift();e.scores=evolutionScores();
    }
  }
  function market() {
    var m={day:1,prices:{},previous:{},holdings:{},realizedProfit:0,dividends:0,feesPaid:0,
      history:[],advanceDay:'',advances:0,lastDividendDay:0,legacyPot:null};
    STOCKS.forEach(function(x){m.prices[x.id]=x.base;m.previous[x.id]=x.base;m.holdings[x.id]={quantity:0,costBasis:0};});return m;
  }
  function fresh(ms) { return {version:3,revision:0,createdAt:ms,updatedAt:ms,
    pet:{name:'',species:'lilac',exp:0,path:'cute',pixel:false,eggOrigin:null},coins:100,inventory:{},wardrobe:{owned:{},equipped:null},
    decorations:{owned:{},equipped:null,background:'meadow',backgrounds:['meadow']},achievements:[],
    care:{day:dayKey(ms),counts:{feed:0,play:0,rest:0},lastCareAt:null,dailyRewardDay:'',total:{feed:0,play:0,rest:0}},
    minigames:{day:dayKey(ms),started:0,active:null,completed:[],bestScore:0},market:market(),
    legacyReserve:{available:false,transferred:false,name:'',coins:0,exp:0,inventory:{},decorations:{},equipped:null,market:null,pot:{value:0,basis:0,days:0},sourceRaw:null},
    migration:{version:1,at:ms,source:'new',legacyRaw:{}}}; }
  function validate(s) {
    check(plain(s)&&s.version===3&&integer(s.revision),'corrupt_data');finiteTree(s,0);
    check(integer(s.createdAt)&&integer(s.updatedAt),'corrupt_data');
    check(plain(s.pet)&&text(s.pet.name,40)&&['dragon','bunny','lilac'].indexOf(s.pet.species)>=0&&integer(s.pet.exp),'corrupt_data');
    if(own(s.pet,'eggOrigin'))check(s.pet.species==='lilac'&&(s.pet.eggOrigin===null?s.pet.exp===0:validEggKey(s.pet.eggOrigin)),'corrupt_data');
    check(s.pet.path===undefined||['cute','cool'].indexOf(s.pet.path)>=0,'corrupt_data');check(s.pet.pixel===undefined||typeof s.pet.pixel==='boolean','corrupt_data');
    check(integer(s.coins),'corrupt_data');counts(s.inventory);
    if(own(s,'evolution'))validateEvolution(s.evolution,s);
    // Older v3 records/backups need no write merely to add an empty wardrobe.
    if(own(s,'wardrobe')) {
      var wardrobe=s.wardrobe;
      check(plain(wardrobe)&&Object.keys(wardrobe).every(function(k){return k==='owned'||k==='equipped';})&&plain(wardrobe.owned),'corrupt_data');
      Object.keys(wardrobe.owned).forEach(function(k){var clothing=item(k);check(clothing&&clothing.type==='clothing'&&wardrobe.owned[k]===true,'corrupt_data');});
      check(wardrobe.equipped===null||typeof wardrobe.equipped==='string'&&own(wardrobe.owned,wardrobe.equipped)&&wardrobe.owned[wardrobe.equipped]===true,'corrupt_data');
    }
    var d=s.decorations;check(plain(d)&&plain(d.owned)&&text(d.background,100)&&Array.isArray(d.backgrounds)&&d.backgrounds.length<=200,'corrupt_data');
    Object.keys(d.owned).forEach(function(k){check(text(k,100)&&plain(d.owned[k]),'corrupt_data');});
    check(d.equipped===null || text(d.equipped,100)&&own(d.owned,d.equipped),'corrupt_data');
    d.backgrounds.forEach(function(x){check(text(x,100),'corrupt_data');});check(d.backgrounds.indexOf(d.background)>=0,'corrupt_data');
    if(own(s,'roomLayout'))validateRoomLayout(s.roomLayout,s,'corrupt_data');
    check(Array.isArray(s.achievements)&&s.achievements.length<=300,'corrupt_data');s.achievements.forEach(function(x){check(text(x,100),'corrupt_data');});
    var c=s.care;check(plain(c)&&validDay(c.day,false)&&validDay(c.dailyRewardDay,true)&&plain(c.counts)&&plain(c.total),'corrupt_data');
    ['feed','play','rest'].forEach(function(k){check(integer(c.counts[k])&&c.counts[k]<=LIMITS.care[k]&&integer(c.total[k]),'corrupt_data');});
    check(c.lastCareAt===null || integer(c.lastCareAt),'corrupt_data');
    var g=s.minigames;check(plain(g)&&validDay(g.day,false)&&integer(g.started)&&g.started<=3&&integer(g.bestScore)&&Array.isArray(g.completed)&&g.completed.length<=64,'corrupt_data');
    g.completed.forEach(function(x){check(text(x,100),'corrupt_data');});
    check(g.active===null || plain(g.active)&&text(g.active.id,100)&&g.active.kind==='catch'&&integer(g.active.startedAt),'corrupt_data');
    var m=s.market;check(plain(m)&&integer(m.day)&&m.day>=1&&plain(m.prices)&&plain(m.previous)&&plain(m.holdings),'corrupt_data');
    STOCKS.forEach(function(x){check(integer(m.prices[x.id])&&m.prices[x.id]>=1&&m.prices[x.id]<=99999&&integer(m.previous[x.id])&&m.previous[x.id]>=1,'corrupt_data');var h=m.holdings[x.id];check(plain(h)&&integer(h.quantity)&&amount(h.costBasis,false)&&(h.quantity>0||h.costBasis===0),'corrupt_data');});
    check(amount(m.realizedProfit,true)&&integer(m.dividends)&&integer(m.feesPaid)&&validDay(m.advanceDay,true)&&integer(m.advances)&&m.advances<=LIMITS.marketAdvancesPerDay&&integer(m.lastDividendDay)&&m.lastDividendDay<=m.day&&Array.isArray(m.history)&&m.history.length<=100,'corrupt_data');
    if(m.legacyPot!==null)check(plain(m.legacyPot)&&integer(m.legacyPot.value)&&amount(m.legacyPot.basis,false)&&integer(m.legacyPot.days),'corrupt_data');
    var value=0,basis=0;STOCKS.forEach(function(x){value+=m.prices[x.id]*m.holdings[x.id].quantity;basis+=m.holdings[x.id].costBasis;});
    check(amount(value,false)&&amount(basis,false)&&amount(s.coins+value,false),'amount_overflow');
    var r=s.legacyReserve;check(plain(r)&&typeof r.available==='boolean'&&typeof r.transferred==='boolean'&&text(r.name,40)&&integer(r.coins)&&integer(r.exp)&&plain(r.decorations),'corrupt_data');counts(r.inventory);
    check(r.sourceRaw===null || text(r.sourceRaw,MAX_BYTES),'corrupt_data');check(r.market===null || plain(r.market),'corrupt_data');
    check(plain(r.pot)&&integer(r.pot.value)&&amount(r.pot.basis,false)&&integer(r.pot.days),'corrupt_data');
    check(plain(s.migration)&&plain(s.migration.legacyRaw),'corrupt_data');return s;
  }
  function legacyNumber(raw, key, fallback) {
    if(raw[key]===null || raw[key]===undefined)return fallback===undefined?0:fallback;
    check(typeof raw[key]==='string'&&/^\d+$/.test(raw[key]),'corrupt_legacy');var n=Number(raw[key]);check(integer(n),'corrupt_legacy');return n;
  }
  function legacyJSON(raw,key,fallback) { if(raw[key]===null||raw[key]===undefined)return fallback;return parse(raw[key]); }
  function legacyMarket(v) {
    if(v===undefined||v===null)return null;
    check(plain(v)&&plain(v.price)&&plain(v.hold)&&plain(v.cost),'corrupt_legacy');
    STOCKS.forEach(function(x){var p=v.price[x.id],q=v.hold[x.id],c=v.cost[x.id];if(p!==undefined)check(amount(p,false)&&p>0&&p<=99999,'corrupt_legacy');if(q!==undefined)check(integer(q),'corrupt_legacy');if(c!==undefined)check(amount(c,false),'corrupt_legacy');if(q>0)check(p!==undefined&&c!==undefined,'corrupt_legacy');});
    return clone(v);
  }
  function migrate(raw,ms) {
    // Site streaks and household/morning producer markers alone are not proof
    // that a pet existed. Preserve their raw records without granting new EXP.
    var s=fresh(ms),has=PG_RECORD_KEYS.some(function(k){return raw[k]!==null;});
    // A preexisting pet, including the earlier pet_game reserve, must not be
    // sent back through the new-pet choice or assigned an invented birth origin.
    if(has||raw.pet_game!==null)delete s.pet.eggOrigin;
    s.migration.source=has?'pg_legacy':'new';s.migration.legacyRaw=clone(raw);
    if(has) {
      var total=legacyNumber(raw,'sk_total'),streak=legacyNumber(raw,'sk_streak');
      s.pet.exp=legacyNumber(raw,'pg_exp')+total*10+Math.floor(streak/7)*10;check(integer(s.pet.exp),'corrupt_legacy');
      s.coins=legacyNumber(raw,'pg_coins');
      if(raw.pg_name!==null){check(text(raw.pg_name,40),'corrupt_legacy');s.pet.name=raw.pg_name;}
      if(raw.pg_species){check(['dragon','bunny'].indexOf(raw.pg_species)>=0,'corrupt_legacy');s.pet.species=raw.pg_species==='dragon'?'lilac':raw.pg_species;}
      if(raw.pg_path){check(['cute','cool'].indexOf(raw.pg_path)>=0,'corrupt_legacy');s.pet.path=raw.pg_path;}
      if(raw.pg_px!==null){check(raw.pg_px==='0'||raw.pg_px==='1','corrupt_legacy');s.pet.pixel=raw.pg_px==='1';}
      var deco=legacyJSON(raw,'pg_deco',{});check(plain(deco)||Array.isArray(deco),'corrupt_legacy');
      if(Array.isArray(deco))deco.forEach(function(k){check(text(k,100),'corrupt_legacy');s.decorations.owned[k]={};});
      else {Object.keys(deco).forEach(function(k){check(plain(deco[k]),'corrupt_legacy');});s.decorations.owned=deco;}
      var bgs=legacyJSON(raw,'pg_bgs',['meadow']);check(Array.isArray(bgs),'corrupt_legacy');s.decorations.backgrounds=bgs.slice();
      if(s.decorations.backgrounds.indexOf('meadow')<0)s.decorations.backgrounds.push('meadow');
      if(raw.pg_bg){s.decorations.background=raw.pg_bg;if(bgs.indexOf(raw.pg_bg)<0)s.decorations.backgrounds.push(raw.pg_bg);}
      var ach=legacyJSON(raw,'pg_ach',[]);check(Array.isArray(ach),'corrupt_legacy');s.achievements=ach.slice();
      var items=legacyJSON(raw,'pg_items',{});counts(items);s.inventory=items;
      if(sameLegacyDay(raw.pg_day,dayKey(ms))){s.care.counts.feed=Math.min(3,legacyNumber(raw,'pg_feed'));s.care.counts.play=Math.min(3,legacyNumber(raw,'pg_pet'));s.minigames.started=Math.min(3,legacyNumber(raw,'pg_play'));}
      s.care.total.feed=legacyNumber(raw,'pg_cnt_feed');s.care.total.play=legacyNumber(raw,'pg_cnt_pet');s.minigames.bestScore=legacyNumber(raw,'pg_mg_best');
    }
    if(raw.pet_game!==null) {
      var old=legacyJSON(raw,'pet_game',null);check(plain(old),'corrupt_legacy');finiteTree(old,0);
      var r=s.legacyReserve;r.available=true;r.sourceRaw=raw.pet_game;
      r.name=old.name===undefined?'':old.name;check(text(r.name,40),'corrupt_legacy');
      ['coins','exp'].forEach(function(k){r[k]=old[k]===undefined?0:old[k];check(integer(r[k]),'corrupt_legacy');});
      var foods=old.foods===undefined?{}:old.foods;counts(foods);Object.keys(foods).forEach(function(k){r.inventory[FOOD_IDS[k]||k]=foods[k];});
      var decos=old.decos===undefined?{}:old.decos;counts(decos);Object.keys(decos).forEach(function(k){if(decos[k]>0)r.decorations[k]={count:decos[k]};});
      if(old.equipped!==undefined&&old.equipped!==null){check(text(old.equipped,100)&&own(r.decorations,old.equipped),'corrupt_legacy');r.equipped=old.equipped;}
      r.market=legacyMarket(old._mkt);
      r.pot={value:old.pot===undefined?0:old.pot,basis:old.potBasis===undefined?0:old.potBasis,days:old.potDays===undefined?0:old.potDays};
      check(integer(r.pot.value)&&amount(r.pot.basis,false)&&integer(r.pot.days),'corrupt_legacy');
    }
    return validate(s);
  }
  function stock(id) {return STOCKS.find(function(x){return x.id===id;});}
  function item(id) {return ITEMS.find(function(x){return x.id===id;});}
  function exactKeys(value,keys) {
    return plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){return own(value,key);});
  }
  function roomDecoration(id) {var entry=item(id);return !!entry&&entry.type==='decoration';}
  function validateRoomLayout(layout,s,code) {
    code=code||'invalid_room_layout';
    check(exactKeys(layout,['version','items'])&&layout.version===1&&Array.isArray(layout.items)&&layout.items.length<=13,code);
    var seen=Object.create(null);
    for(var i=0;i<layout.items.length;i++) {
      var placed=layout.items[i];
      check(own(layout.items,i)&&exactKeys(placed,['id','x','y','flip'])&&typeof placed.id==='string'&&
        integer(placed.x)&&placed.x<=100&&integer(placed.y)&&placed.y<=100&&typeof placed.flip==='boolean',code);
      check(!own(seen,placed.id),code);seen[placed.id]=true;
      var builtin=ROOM_FURNITURE.some(function(entry){return entry.id===placed.id;});
      check(builtin||roomDecoration(placed.id),code);
      check(builtin||plain(s.decorations)&&plain(s.decorations.owned)&&own(s.decorations.owned,placed.id),code==='corrupt_data'?code:'not_owned');
    }
    return layout;
  }
  function defaultRoomLayout(s) {
    var placed=ROOM_FURNITURE.map(function(entry){return {id:entry.id,x:entry.x,y:entry.y,flip:entry.flip};});
    var decor=s&&s.decorations,equipped=decor&&decor.equipped;
    if(roomDecoration(equipped)&&plain(decor.owned)&&own(decor.owned,equipped))placed.push({id:equipped,x:74,y:94,flip:false});
    return {version:1,items:placed};
  }
  function getRoomLayout(s) {
    if(s&&own(s,'roomLayout'))return clone(validateRoomLayout(s.roomLayout,s,'corrupt_data'));
    return defaultRoomLayout(s);
  }
  function achievement(s,id) {if(s.achievements.indexOf(id)<0)s.achievements.push(id);}
  function history(m,event) {m.history.push(event);if(m.history.length>100)m.history.shift();}
  function summary(s) {
    var value=0,cost=0;STOCKS.forEach(function(x){value+=s.market.prices[x.id]*s.market.holdings[x.id].quantity;cost+=s.market.holdings[x.id].costBasis;});
    return {value:value,costBasis:cost,unrealizedProfit:value-cost,realizedProfit:s.market.realizedProfit,
      dividends:s.market.dividends,feesPaid:s.market.feesPaid,totalAssets:s.coins+value};
  }
  function operation(storage,fn) {
    var previous=locks.get(storage)||Promise.resolve();var next=previous.catch(function(){}).then(function(){
      if(typeof navigator!=='undefined'&&navigator.locks&&navigator.locks.request)return navigator.locks.request('pet-game-v3-write',fn);
      return fn();
    });locks.set(storage,next.catch(function(){}));return next;
  }
  function create(options) {
    options=options||{};var storage=options.storage,legacy=options.legacy||storage;
    var clock=options.now||Date.now,rng=options.random||Math.random,listeners=[];
    var ms=Number(clock()),state=fresh(Number.isSafeInteger(ms)&&ms>=0?ms:0),baseRaw=null,blocked=false,loading=true,lastError=null;
    function time(){var n=Number(clock());check(integer(n),'invalid_clock');return n;}
    function random(){var r=rng();check(typeof r==='number'&&Number.isFinite(r)&&r>=0&&r<1,'invalid_random');return r;}
    function visible(){var out=clone(state);out.error=lastError?clone(lastError):null;out.readOnly=loading||blocked;out.stage=getStage(state.pet.exp);out.marketSummary=summary(state);return out;}
    function notify(){listeners.slice().forEach(function(fn){try{fn(visible());}catch(e){/* A listener must not roll back a successful save. */}});}
    function result(ok,error,reward){var r={ok:ok,error:error||null,state:visible()};if(reward)r.reward=reward;return r;}
    function failure(e){var code=e&&own(ERRORS,e.code)?e.code:'storage_failed';lastError={code:code,message:ERRORS[code]};notify();return result(false,clone(lastError));}
    async function read(k,reader){var raw=await reader.getItem(k);check(raw===null||typeof raw==='string','storage_read_failed');return raw;}
    async function commit(next){
      check((await read(KEY,storage))===baseRaw,'stale_state');validate(next);
      var raw=JSON.stringify(next);check(raw.length<=MAX_BYTES,'storage_full');
      var saved=await storage.setItem(KEY,raw);check(saved!==false&&!(plain(saved)&&saved.ok===false),'storage_failed');state=next;baseRaw=raw;lastError=null;notify();
    }
    var api;
    var ready=operation(storage||{},async function(){
      try {
        check(storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function'&&legacy&&typeof legacy.getItem==='function','storage_unavailable');
        baseRaw=await read(KEY,storage);
        if(baseRaw!==null) {
          state=validate(parse(baseRaw));
          // Retired dragon records remain readable. Adopt B only after the
          // same awaited/CAS write used by every real game transition succeeds.
          if(state.pet.species==='dragon') {
            var updated=clone(state);updated.pet.species='lilac';updated.revision++;updated.updatedAt=time();await commit(updated);
          }
        }
        else {var raw={};for(var i=0;i<LEGACY_KEYS.length;i++)raw[LEGACY_KEYS[i]]=await read(LEGACY_KEYS[i],legacy);var initial=migrate(raw,time());await commit(initial);}
        loading=false;lastError=null;notify();return result(true);
      } catch(e){loading=false;blocked=true;return failure(e);}
    });
    function act(next,a,ms) {
      check(plain(a)&&text(a.type,40),'invalid_action');var day=dayKey(ms),reward={},beforeExp=next.pet.exp,evolutionKind=null;
      if(a.type==='chooseEgg') {
        check(validEggKey(a.eggOrigin),'invalid_egg');check(needsEggChoice(next),'egg_already_chosen');
        next.pet.eggOrigin=a.eggOrigin;
        // Selection changes identity only: no care, evolution, rewards or generic achievements.
        return reward;
      }
      check(!needsEggChoice(next),'egg_required');
      if(a.type==='saveRoomLayout') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        validateRoomLayout(a.layout,next);next.roomLayout=clone(a.layout);
        // Moving or removing furniture never charges, rewards or backfills achievements.
        return reward;
      }
      if(a.type==='care') {
        check(own(LIMITS.care,a.kind),'invalid_action');var c=next.care;
        if(day!==c.day){check(day>c.day,'clock_moved_back');c.day=day;c.counts={feed:0,play:0,rest:0};}
        check(c.counts[a.kind]<LIMITS.care[a.kind],'daily_limit');c.counts[a.kind]++;c.total[a.kind]++;
        var xp={feed:8,play:5,rest:4}[a.kind];next.pet.exp+=xp;c.lastCareAt=ms;reward.exp=xp;reward.coins=0;
        if(c.dailyRewardDay!==day){check(!c.dailyRewardDay||day>c.dailyRewardDay,'clock_moved_back');c.dailyRewardDay=day;next.coins+=10;reward.coins=10;}
        if(c.total.feed>=20)achievement(next,'feed20');if(c.total.play>=50)achievement(next,'pet50');
        evolutionKind=a.kind==='feed'?'feed':a.kind;
      } else if(a.type==='rename') {
        check(text(a.name,40),'invalid_name');next.pet.name=a.name.trim();
      } else if(a.type==='chooseSpecies') {
        check(['bunny','lilac'].indexOf(a.species)>=0,'invalid_species');
        check(!own(next.pet,'eggOrigin')||a.species===next.pet.species,'egg_species_locked');next.pet.species=a.species;
      } else if(a.type==='chooseAppearance') {
        check(next.pet.exp>=110,'appearance_locked');check(['cute','cool'].indexOf(a.path)>=0&&typeof a.pixel==='boolean','invalid_appearance');
        next.pet.path=a.path;next.pet.pixel=a.pixel;
      } else if(a.type==='buyItem') {
        var it=item(a.itemId);check(!!it,'invalid_item');
        if(it.type==='clothing') {
          var wardrobe=next.wardrobe||{owned:{},equipped:null};
          check(!own(wardrobe.owned,it.id),'already_owned');check(next.coins>=it.price,'insufficient_coins');
          next.coins-=it.price;wardrobe.owned[it.id]=true;next.wardrobe=wardrobe;
          return reward;
        }
        check(next.coins>=it.price,'insufficient_coins');
        if(it.type==='food'){next.coins-=it.price;next.inventory[it.id]=(next.inventory[it.id]||0)+1;}
        else if(it.type==='decoration'){check(!own(next.decorations.owned,it.id),'already_owned');next.coins-=it.price;next.decorations.owned[it.id]={};}
        else {var bg=it.id.slice(3);check(next.decorations.backgrounds.indexOf(bg)<0,'already_owned');next.coins-=it.price;next.decorations.backgrounds.push(bg);}
      } else if(a.type==='useItem') {
        var food=item(a.itemId);check(food&&food.type==='food','invalid_item');check(next.inventory[a.itemId]>0,'not_owned');next.inventory[a.itemId]--;next.pet.exp+=food.exp;next.care.lastCareAt=ms;reward.exp=food.exp;
        evolutionKind=food.id==='apple'||food.id==='berry'?'fruit':food.id==='cake'?'sweet':'hearty';
      } else if(a.type==='equip') {
        var previousEquipped=next.decorations.equipped;
        if(a.itemId===null) {
          next.decorations.equipped=null;
          if(own(next,'roomLayout')&&roomDecoration(previousEquipped))next.roomLayout.items=next.roomLayout.items.filter(function(entry){return entry.id!==previousEquipped;});
        }
        else if(typeof a.itemId==='string'&&a.itemId.indexOf('bg_')===0){var bgid=a.itemId.slice(3);check(next.decorations.backgrounds.indexOf(bgid)>=0,'not_owned');next.decorations.background=bgid;}
        else {
          check(typeof a.itemId==='string'&&own(next.decorations.owned,a.itemId),'not_owned');next.decorations.equipped=a.itemId;
          if(own(next,'roomLayout')&&roomDecoration(a.itemId)&&!next.roomLayout.items.some(function(entry){return entry.id===a.itemId;}))next.roomLayout.items.push({id:a.itemId,x:74,y:94,flip:false});
        }
      } else if(a.type==='equipClothing') {
        if(a.itemId===null) {if(next.wardrobe)next.wardrobe.equipped=null;}
        else {
          var clothing=item(a.itemId);check(clothing&&clothing.type==='clothing','invalid_item');
          check(next.wardrobe&&next.wardrobe.owned[a.itemId]===true,'not_owned');next.wardrobe.equipped=a.itemId;
        }
        return reward;
      } else if(a.type==='beginMinigame') {
        var g=next.minigames;check(!g.active,'game_active');check(a.kind===undefined||a.kind==='catch','invalid_action');
        if(g.day!==day){check(day>g.day,'clock_moved_back');g.day=day;g.started=0;}
        check(g.started<LIMITS.minigamesPerDay,'daily_limit');g.started++;
        var id='catch-'+ms+'-'+next.revision+'-'+Math.floor(random()*1000000000);g.active={id:id,kind:'catch',startedAt:ms};reward.sessionId=id;
      } else if(a.type==='finishMinigame'||a.type==='cancelMinigame') {
        var mg=next.minigames;check(mg.active&&a.sessionId===mg.active.id&&mg.completed.indexOf(a.sessionId)<0,'invalid_session');
        if(a.type==='finishMinigame') {
          check(integer(a.score)&&a.score<=LIMITS.maxScore,'invalid_score');check(ms-mg.active.startedAt>=LIMITS.minigameDurationMs,'game_too_short');
          reward.coins=a.score;reward.exp=Math.min(10,Math.ceil(a.score/2));next.coins+=reward.coins;next.pet.exp+=reward.exp;next.care.lastCareAt=ms;mg.bestScore=Math.max(mg.bestScore,a.score);
          if(a.score>=15)achievement(next,'mg15');
          if(a.score>0){var foods=['apple','cake','berry','rice'];var foodId=foods[Math.floor(random()*foods.length)];next.inventory[foodId]=(next.inventory[foodId]||0)+1;reward.items=[{id:foodId,count:1}];}
          if(a.score>0&&reward.exp>0)evolutionKind='play';
        }
        mg.completed.push(mg.active.id);if(mg.completed.length>64)mg.completed.shift();mg.active=null;
      } else if(a.type==='advanceMarketDay') {
        var m=next.market;if(m.advanceDay!==day){check(!m.advanceDay||day>m.advanceDay,'clock_moved_back');m.advanceDay=day;m.advances=0;}
        check(m.advances<LIMITS.marketAdvancesPerDay,'daily_limit');m.advances++;m.day++;
        STOCKS.forEach(function(x){var prev=m.prices[x.id];m.previous[x.id]=prev;var change=(random()*2-1)*x.volatility;
          var price=Math.max(3,Math.min(99999,Math.round(prev*(1+change))));if(price===prev)price=Math.max(3,Math.min(99999,prev+(change>=0?1:-1)));m.prices[x.id]=price;});
        reward.dividend=0;
        if(m.day%LIMITS.dividendEvery===0&&m.lastDividendDay!==m.day){STOCKS.forEach(function(x){reward.dividend+=Math.floor(m.prices[x.id]*m.holdings[x.id].quantity*x.dividendRate);});next.coins+=reward.dividend;m.dividends+=reward.dividend;m.lastDividendDay=m.day;if(reward.dividend>0)achievement(next,'dividend');}
        history(m,{type:'day',day:m.day,prices:clone(m.prices),dividend:reward.dividend});
      } else if(a.type==='buyStock'||a.type==='sellStock') {
        var spec=stock(a.stockId);check(spec&&integer(a.quantity)&&a.quantity>0,'invalid_trade');var mm=next.market,hold=mm.holdings[a.stockId];
        var gross=mm.prices[a.stockId]*a.quantity;check(integer(gross),'amount_overflow');var fee=Math.max(1,Math.ceil(gross*LIMITS.feeRate));
        reward.fee=fee;
        if(a.type==='buyStock') {check(next.coins>=gross+fee,'insufficient_coins');next.coins-=gross+fee;hold.quantity+=a.quantity;hold.costBasis+=gross+fee;}
        else {check(hold.quantity>=a.quantity,'insufficient_shares');check(gross>=fee,'invalid_trade');var allocated=a.quantity===hold.quantity?hold.costBasis:hold.costBasis*a.quantity/hold.quantity;hold.quantity-=a.quantity;hold.costBasis=hold.quantity===0?0:hold.costBasis-allocated;
          reward.realizedProfit=gross-fee-allocated;next.coins+=gross-fee;mm.realizedProfit+=reward.realizedProfit;if(reward.realizedProfit>0)achievement(next,'first_profit');}
        mm.feesPaid+=fee;achievement(next,'first_trade');if(STOCKS.every(function(x){return mm.holdings[x.id].quantity>0;}))achievement(next,'all_six');
        history(mm,{type:a.type,day:mm.day,stockId:a.stockId,quantity:a.quantity,price:mm.prices[a.stockId],fee:fee,realizedProfit:reward.realizedProfit||0});
      } else if(a.type==='withdrawLegacyPot') {
        var pot=next.market.legacyPot;check(pot&&pot.value>0,'legacy_pot_empty');
        next.coins+=pot.value;next.market.realizedProfit+=pot.value-pot.basis;reward.coins=pot.value;reward.realizedProfit=pot.value-pot.basis;
        pot.withdrawnValue=(pot.withdrawnValue||0)+pot.value;pot.value=0;pot.basis=0;
      } else if(a.type==='transferLegacy') {
        var r=next.legacyReserve;check(r.available&&!r.transferred,'legacy_already_transferred');next.coins+=r.coins;next.pet.exp+=r.exp;
        if(next.pet.name==='')next.pet.name=r.name;
        Object.keys(r.inventory).forEach(function(k){next.inventory[k]=(next.inventory[k]||0)+r.inventory[k];});
        Object.keys(r.decorations).forEach(function(k){if(!own(next.decorations.owned,k))next.decorations.owned[k]=clone(r.decorations[k]);});
        if(next.decorations.equipped===null&&r.equipped)next.decorations.equipped=r.equipped;
        if(r.market){next.market.legacyConversion=[];STOCKS.forEach(function(x){var q=r.market.hold[x.id]||0;if(!q)return;var h=next.market.holdings[x.id];
          var oldPrice=r.market.price[x.id],converted=Math.max(1,Math.round(oldPrice));
          if(h.quantity===0){next.market.prices[x.id]=converted;next.market.previous[x.id]=converted;}
          next.market.legacyConversion.push({stockId:x.id,sourcePrice:oldPrice,gamePrice:next.market.prices[x.id],quantity:q,
            valuationDifference:(next.market.prices[x.id]-oldPrice)*q,reason:'integer_coin_price'});
          h.quantity+=q;h.costBasis+=r.market.cost[x.id];});next.market.legacyPriceSnapshot=clone(r.market.price);}
        next.market.legacyPot=clone(r.pot);r.transferred=true;r.available=false;reward.coins=r.coins;reward.exp=r.exp;
      } else fail('invalid_action','この操作には対応していません。');
      if(evolutionKind)recordEvolution(next,beforeExp,evolutionKind,ms);
      if(next.pet.exp>=110)achievement(next,'final');if(next.coins>=100)achievement(next,'rich');
      if(Object.keys(next.decorations.owned).length>=3)achievement(next,'deco3');if(Object.keys(next.decorations.owned).length>=7)achievement(next,'deco7');
      return reward;
    }
    async function dispatch(action) {
      await ready;return operation(storage||{},async function(){
        try {check(!blocked,'read_only');var next=clone(state),ms=time();var reward=act(next,action,ms);next.revision++;next.updatedAt=ms;await commit(next);return result(true,null,reward);}
        catch(e){return failure(e);}
      });
    }
    async function importBackup(raw) {
      await ready;return operation(storage||{},async function(){
        try {check(!blocked,'read_only');var backup=parse(raw);check(plain(backup)&&backup.format==='PetGameBackup'&&backup.version===3,'invalid_backup');
          var next=validate(backup.state);next=clone(next);if(next.pet.species==='dragon')next.pet.species='lilac';next.revision=state.revision+1;next.updatedAt=time();await commit(next);return result(true);}
        catch(e){return failure(e);}
      });
    }
    api={ready:ready,getState:visible,dispatch:dispatch,getStage:getStage,getLilacGrowth:getLilacGrowth,getLilacAppearance:getLilacAppearance,getLilacEvolution:getLilacEvolution,getEggOrigin:getEggOrigin,needsEggChoice:needsEggChoice,
      subscribe:function(fn){check(typeof fn==='function','invalid_listener');listeners.push(fn);return function(){listeners=listeners.filter(function(x){return x!==fn;});};},
      exportBackup:function(){check(!loading&&!blocked,'read_only');return JSON.stringify({format:'PetGameBackup',version:3,exportedAt:time(),state:clone(state)});},
      importBackup:importBackup};return api;
  }
  return {create:create,getStage:getStage,getLilacGrowth:getLilacGrowth,lilacGrowthStages:lilacGrowthStages,getLilacAppearance:getLilacAppearance,lilacAppearanceStages:lilacAppearanceStages,getLilacEvolution:getLilacEvolution,lilacEvolutionPaths:lilacEvolutionPaths,getMarketSummary:summary,eggCatalogue:eggCatalogue,eggProfile:eggProfile,getEggOrigin:getEggOrigin,needsEggChoice:needsEggChoice,KEY:KEY,STORAGE_KEY:KEY,
    roomFurniture:clone(ROOM_FURNITURE),defaultRoomLayout:defaultRoomLayout,getRoomLayout:getRoomLayout,
    STOCKS:clone(STOCKS),stocks:clone(STOCKS),ITEMS:clone(ITEMS),items:clone(ITEMS),catalogue:clone(ITEMS),
    LIMITS:clone(LIMITS),limits:clone(LIMITS),LEGACY_KEYS:LEGACY_KEYS.slice()};
}));
