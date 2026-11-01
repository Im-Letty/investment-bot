(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet-village-economy.js'), require('./pet-shop-layout.js'), require('./pet-river-fishing.js'), require('./pet-ocean-discoveries.js'), require('./pet-japan-seasons.js'));
  else root.PetGameCore = factory(root.PetVillageEconomy, root.PetShopLayout, root.PetRiverFishing, root.PetOceanDiscoveries, root.PetJapanSeasons);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (VillageEconomy, ShopLayout, RiverFishing, OceanDiscoveries, Seasons) {
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
    {key:'active',label:'そよかぜ',colorName:'空色',color:'#92b4d1',description:'いっしょに遊んで育つ、軽やかな姿。',hint:'なでたり、いっしょに過ごしてみよう。'},
    {key:'calm',label:'まどろみ',colorName:'ミント色',color:'#9dbfb0',description:'休むお世話から育つ、おだやかな姿。',hint:'ゆっくり休む時間を作ってみよう。'}
  ].map(function(path){return Object.freeze(path);}));
  var LIMITS = {care:{feed:3,play:3,rest:3},
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
    {id:'peach',name:'もも',emoji:'🍑',type:'food',price:0,exp:3,harvestOnly:true,foodGroup:'fruit'},
    {id:'pear',name:'なし',emoji:'🍐',type:'food',price:0,exp:3,harvestOnly:true,foodGroup:'fruit'},
    {id:'mandarin',name:'みかん',emoji:'🍊',type:'food',price:0,exp:3,harvestOnly:true,foodGroup:'fruit'},
    {id:'asparagus',name:'アスパラガス',emoji:'🌱',type:'food',price:0,exp:2,harvestOnly:true,foodGroup:'vegetable'},
    {id:'cucumber',name:'きゅうり',emoji:'🥒',type:'food',price:0,exp:2,harvestOnly:true,foodGroup:'vegetable'},
    {id:'sweet_potato',name:'さつまいも',emoji:'🍠',type:'food',price:0,exp:2,harvestOnly:true,foodGroup:'vegetable'},
    {id:'daikon',name:'だいこん',emoji:'🌿',type:'food',price:0,exp:2,harvestOnly:true,foodGroup:'vegetable'},
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
  // The approved 3D room has its own optional layout. Its free fixtures never
  // become inventory, and the earlier percentage-based room record stays intact.
  var COZY_ROOM_FURNITURE = Object.freeze([
    {id:'bed',name:'チェックのベッド',width:1.65,depth:2.55,flat:false},
    {id:'table',name:'まるい木のテーブル',width:1.65,depth:1.35,flat:false},
    {id:'chair',name:'木のチェア',width:.75,depth:.8,flat:false},
    {id:'cupboard',name:'ガラスの食器棚',width:1.5,depth:.66,flat:false},
    {id:'plant',name:'みどりの鉢植え',width:.85,depth:.85,flat:false},
    {id:'counter',name:'カフェのカウンター',width:1.85,depth:.85,flat:false},
    {id:'lamp',name:'森色のフロアランプ',width:.65,depth:.65,flat:false},
    {id:'rug',name:'やわらかラグ',width:2.9,depth:2.25,flat:true}
  ].map(function(row){return Object.freeze(row);}));
  var COZY_ROOM_IMPORTS = Object.freeze([
    {id:'legacy_window',name:'これまでのまど',width:1.65,depth:.35,flat:false,sourceId:'room_window'},
    {id:'legacy_bowl',name:'ごはんのうつわ',width:.7,depth:.7,flat:false,sourceId:'room_bowl'},
    {id:'legacy_toy',name:'これまでのおもちゃ',width:.8,depth:.8,flat:false,sourceId:'room_toy'},
    {id:'decor_house',name:'おうちのかざり',width:1.2,depth:1.1,flat:false,sourceId:'house'},
    {id:'decor_tree',name:'きのかざり',width:1.1,depth:1.1,flat:false,sourceId:'tree'},
    {id:'decor_flower',name:'はなのかざり',width:.65,depth:.65,flat:false,sourceId:'flower'},
    {id:'decor_fountain',name:'ふんすいのかざり',width:1.2,depth:1.2,flat:false,sourceId:'fountain'},
    {id:'decor_sunflower',name:'ひまわりのかざり',width:.65,depth:.65,flat:false,sourceId:'sunflower'},
    {id:'decor_mushroom',name:'きのこのかざり',width:.7,depth:.7,flat:false,sourceId:'mushroom'},
    {id:'decor_lantern',name:'とうろうのかざり',width:.55,depth:.55,flat:false,sourceId:'lantern'}
  ].map(function(row){return Object.freeze(row);}));
  var COZY_ROOM_TYPES = COZY_ROOM_FURNITURE.concat(COZY_ROOM_IMPORTS);
  // New-home acquisition is additive. The original item prices and free legacy
  // fixtures stay unchanged; a true first visit starts with a bed and a rug.
  var HOME_FURNISHINGS = Object.freeze([
    {id:'bed',price:0,minExp:0,purchases:0},{id:'rug',price:0,minExp:0,purchases:0},
    {id:'table',price:24,minExp:15,purchases:1},{id:'chair',price:32,minExp:45,purchases:2},
    {id:'plant',price:40,minExp:110,purchases:3},{id:'lamp',price:55,minExp:400,purchases:5},
    {id:'cupboard',price:95,minExp:400,purchases:7},{id:'counter',price:140,minExp:800,purchases:10}
  ].map(function(row){return Object.freeze(row);}));
  var VILLAGE_HARVEST = Object.freeze([
    Object.freeze({id:'orchard',name:'くだものの収穫',kind:'fruit'}),
    Object.freeze({id:'berry',name:'野菜の収穫',kind:'vegetable'})
  ]);
  function seasonalLife(ms){var calendar=Seasons||(typeof globalThis!=='undefined'&&globalThis.PetJapanSeasons);return calendar&&typeof calendar.life==='function'?calendar.life(ms):null;}
  function harvestPlots(ms){
    var season=seasonalLife(ms);
    check(!!season,'invalid_clock');
    return VILLAGE_HARVEST.map(function(p){return {id:p.id,name:p.name,itemId:season[p.kind].id};});
  }

  var COZY_ROOM_SOURCES = {room_window:'legacy_window',room_shelf:'cupboard',room_rug:'rug',room_bed:'bed',room_bowl:'legacy_bowl',room_toy:'legacy_toy',
    house:'decor_house',tree:'decor_tree',flower:'decor_flower',fountain:'decor_fountain',sunflower:'decor_sunflower',mushroom:'decor_mushroom',lantern:'decor_lantern'};
  // Village places are free entrances, distinct from owned room decorations.
  // Their optional layout is materialized only by an explicit confirmed save.
  var VILLAGE_PLACES = Object.freeze([
    {id:'home',name:'おうち',x:22,y:23},
    {id:'cafe',name:'カフェ',x:72,y:23},
    {id:'shop',name:'マルシェ',x:22,y:65},
    {id:'playground',name:'あそびの広場',x:72,y:65},
    {id:'tree',name:'村の木',x:48,y:44},
    {id:'flowers',name:'花だん',x:48,y:83}
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
    invalid_ocean_discovery:'海の中で、近くの生きものを見つけてから記録してください。',ocean_already_discovered:'この生きものは記録済みです。',
    invalid_opening_story:'物語のページを順番に確認してください。しおりは変更していません。',
    invalid_fishing:'川岸の釣り場を確認してください。',fishing_active:'前の釣りを続けるか、やめてから始めてください。',
    fishing_wait:'浮きが沈んでから引き上げよう。',fishing_escaped:'魚が離れました。もう一度投げてみよう。',
    fishing_cooldown:'少し待ってから、もう一度投げよう。',
    invalid_name:'名前は40文字までで入力してください。',invalid_species:'キャラクターを選んでください。',invalid_item:'アイテムを確認してください。',
    invalid_egg:'たまごを選んでください。',egg_required:'最初にいっしょに育つたまごを選んでください。',
    egg_already_chosen:'このこのたまごは選択済みです。',egg_species_locked:'選んだたまごから生まれた子を育ててください。',
    appearance_locked:'さいしゅうしんかすると姿を選べます。',invalid_appearance:'姿と表示方法を確認してください。',
    invalid_room_layout:'家具の配置を確認してください。保存済みのお部屋は変更していません。',
    invalid_cozy_room_layout:'家具や壁紙・床の配置を確認してください。保存済みのお部屋は変更していません。',
    invalid_shop_interior:'お店を確認してください。保存済みの配置は変更していません。',
    invalid_shop_interior_layout:'家具の位置や通路を確認してください。保存済みのお店は変更していません。',
    invalid_home_furniture:'おうちの家具を確認してください。',home_furniture_locked:'成長やお買い物で、新しい家具が見つかります。',
    invalid_harvest:'収穫する場所を確認してください。',harvest_wait:'ここでの収穫は今日はおしまいです。また明日育ちます。',
    invalid_village_layout:'村の配置を確認してください。保存済みの村は変更していません。',
    village_construction_required:'村の配置は、業者への工事依頼を通して変更します。保存済みの村は変更していません。',
    village_invalid:'食品の数・値段・株数を確認してください。',village_listing_limit:'出品は8件までです。',
    village_not_found:'商品や出品の最新の状態を確認してください。',village_wait:'村の一日を進めるには60秒あけてください。',
    village_liquidity:'今はNPCの買戻し予算が足りません。株数を減らすか、村の一日を進めてください。',
    village_not_open:'出資や売却ができるお店の状態を確認してください。',village_no_benefit:'受け取れる優待はまだありません。',
    insufficient_coins:'コインが足りません。',already_owned:'すでに持っています。',not_owned:'このアイテムを持っていません。',
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
  function harvestDay(ms) {return new Date(ms+32400000).toISOString().slice(0,10);}
  function newVillageLife(mode) {return {version:1,homeMode:mode,purchaseCount:0,harvest:{day:'',claimed:[]},claimedFurniture:{bed:true,rug:true}};}
  function validateVillageLife(life,code) {
    code=code||'corrupt_data';
    check(exactKeys(life,['version','homeMode','purchaseCount','harvest','claimedFurniture'])&&life.version===1&&
      ['starter','legacy'].indexOf(life.homeMode)>=0&&integer(life.purchaseCount),code);
    var h=life.harvest,owned=life.claimedFurniture;
    check(exactKeys(h,['day','claimed'])&&validDay(h.day,true)&&Array.isArray(h.claimed)&&h.claimed.length<=VILLAGE_HARVEST.length&&
      Reflect.ownKeys(h.claimed).length===h.claimed.length+1&&(h.day!==''||!h.claimed.length),code);
    var seen=Object.create(null);
    h.claimed.forEach(function(id){check(typeof id==='string'&&VILLAGE_HARVEST.some(function(p){return p.id===id;})&&!own(seen,id),code);seen[id]=true;});
    check(plain(owned)&&Reflect.ownKeys(owned).length===Object.keys(owned).length&&Object.keys(owned).length<=HOME_FURNISHINGS.length,code);
    Object.keys(owned).forEach(function(id){check(HOME_FURNISHINGS.some(function(f){return f.id===id;})&&owned[id]===true,code);});
    check(owned.bed===true&&own(owned,'bed')&&owned.rug===true&&own(owned,'rug'),code);return life;
  }
  function villageLife(s) {return s&&own(s,'villageLife')?clone(validateVillageLife(s.villageLife)):newVillageLife('legacy');}
  function ensureVillageLife(s) {if(!own(s,'villageLife'))s.villageLife=newVillageLife('legacy');return validateVillageLife(s.villageLife);}
  function paidPurchase(s) {var life=ensureVillageLife(s);check(life.purchaseCount<MAX,'amount_overflow');life.purchaseCount++;}
  function getHomeFurnishingsView(s) {
    var life=villageLife(s),legacy=life.homeMode==='legacy',exp=s&&s.pet?s.pet.exp:0,chosen=!!s&&!needsEggChoice(s);
    var rows=HOME_FURNISHINGS.map(function(f){
      var owned=legacy||own(life.claimedFurniture,f.id),growth=exp>=f.minExp,available=owned||growth||life.purchaseCount>=f.purchases;
      var spec=COZY_ROOM_FURNITURE.find(function(x){return x.id===f.id;});
      return {id:f.id,name:spec.name,price:f.price,owned:owned,available:available,canClaim:chosen&&!owned&&growth,
        canBuy:chosen&&!owned&&available&&!!s&&s.coins>=f.price,minExp:f.minExp,requiredPurchases:f.purchases,
        reason:owned?'おうちで使えます':growth?'成長のお祝いに受け取れます':available?'お買い物の経験で見つけました':f.minExp+' EXP またはお買い物'+f.purchases+'回で見つかります'};
    });return {version:1,homeMode:life.homeMode,purchaseCount:life.purchaseCount,items:rows,rows:rows};
  }
  function getCozyRoomFurniture(s) {
    var view=getHomeFurnishingsView(s),legacy=view.homeMode==='legacy';
    return COZY_ROOM_FURNITURE.filter(function(f){return view.rows.some(function(row){return row.id===f.id&&row.owned;});})
      .map(function(f){var row=clone(f);row.limit=legacy?24:1;return row;});
  }
  function getVillageHarvestView(s,ms) {
    check(integer(ms),'invalid_clock');var life=villageLife(s),day=harvestDay(ms),back=!!(s&&ms<s.updatedAt)||life.harvest.day!==''&&day<life.harvest.day;
    return {day:day,nextAt:(Math.floor((ms+32400000)/86400000)+1)*86400000-32400000,season:seasonalLife(ms),plots:harvestPlots(ms).map(function(p){
      var done=life.harvest.day===day&&life.harvest.claimed.indexOf(p.id)>=0,available=!!s&&!needsEggChoice(s)&&!back&&!done;
      return {id:p.id,name:p.name,itemId:p.itemId,itemName:item(p.itemId).name,quantity:1,owned:s&&s.inventory?s.inventory[p.itemId]||0:0,claimed:done,available:available,reason:back?'clock_moved_back':done?'harvest_wait':needsEggChoice(s)?'egg_required':null};
    })};
  }
  function getRiverFishingView(s,ms,position) {
    check(integer(ms),'invalid_clock');
    var fishing=s&&own(s,'riverFishing')?s.riverFishing:RiverFishing.empty();
    check(RiverFishing.valid(fishing),'corrupt_data');
    var result=RiverFishing.view(fishing,ms,RiverFishing.createWorld(getVillageLayout(s)),position);
    if(s&&ms<s.updatedAt){result.phase='clock_moved_back';result.canCast=false;result.canReel=false;}return result;
  }
  function getOceanDiscoveryView(s) {
    check(OceanDiscoveries&&typeof OceanDiscoveries.view==='function','invalid_ocean_discovery');
    return OceanDiscoveries.view(s&&own(s,'oceanDiscoveries')?s.oceanDiscoveries:OceanDiscoveries.empty());
  }
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
    pet:{name:'',species:'lilac',exp:0,path:'cute',pixel:false,eggOrigin:null},coins:100,inventory:{},wardrobe:{owned:{},equipped:null},villageLife:newVillageLife('starter'),
    decorations:{owned:{},equipped:null,background:'meadow',backgrounds:['meadow']},achievements:[],
    care:{day:dayKey(ms),counts:{feed:0,play:0,rest:0},lastCareAt:null,dailyRewardDay:'',total:{feed:0,play:0,rest:0}},
    // Historical minigame data remains readable/exportable; no game commands run it.
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
    if(own(s,'openingStory'))validateOpeningStory(s.openingStory,'corrupt_data');
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
    if(own(s,'villageLife'))validateVillageLife(s.villageLife,'corrupt_data');
    if(own(s,'riverFishing'))check(!!RiverFishing&&RiverFishing.valid(s.riverFishing),'corrupt_data');
    if(own(s,'oceanDiscoveries')){
      check(!!OceanDiscoveries&&OceanDiscoveries.valid(s.oceanDiscoveries),'corrupt_data');
      check(s.oceanDiscoveries.entries.every(function(row){return row.discoveredAt>=s.createdAt&&row.discoveredAt<=s.updatedAt;}),'corrupt_data');
    }
    if(own(s,'cozyRoomLayout'))validateCozyRoomLayout(s.cozyRoomLayout,s,'corrupt_data');
    if(own(s,'villageLayout'))validateVillageLayout(s.villageLayout,'corrupt_data');
    if(own(s,'shopInteriorLayouts'))validateShopInteriorLayouts(s.shopInteriorLayouts,'corrupt_data');
    check(Array.isArray(s.achievements)&&s.achievements.length<=300,'corrupt_data');s.achievements.forEach(function(x){check(text(x,100),'corrupt_data');});
    var c=s.care;check(plain(c)&&validDay(c.day,false)&&validDay(c.dailyRewardDay,true)&&plain(c.counts)&&plain(c.total),'corrupt_data');
    ['feed','play','rest'].forEach(function(k){check(integer(c.counts[k])&&c.counts[k]<=LIMITS.care[k]&&integer(c.total[k]),'corrupt_data');});
    check(c.lastCareAt===null || integer(c.lastCareAt),'corrupt_data');
    var g=s.minigames;check(plain(g)&&validDay(g.day,false)&&integer(g.started)&&g.started<=3&&integer(g.bestScore)&&Array.isArray(g.completed)&&g.completed.length<=64,'corrupt_data');
    g.completed.forEach(function(x){check(text(x,100),'corrupt_data');});
    check(g.active===null || plain(g.active)&&text(g.active.id,100)&&['catch','snack'].indexOf(g.active.kind)>=0&&integer(g.active.startedAt),'corrupt_data');
    var m=s.market;check(plain(m)&&integer(m.day)&&m.day>=1&&plain(m.prices)&&plain(m.previous)&&plain(m.holdings),'corrupt_data');
    STOCKS.forEach(function(x){check(integer(m.prices[x.id])&&m.prices[x.id]>=1&&m.prices[x.id]<=99999&&integer(m.previous[x.id])&&m.previous[x.id]>=1,'corrupt_data');var h=m.holdings[x.id];check(plain(h)&&integer(h.quantity)&&amount(h.costBasis,false)&&(h.quantity>0||h.costBasis===0),'corrupt_data');});
    check(amount(m.realizedProfit,true)&&integer(m.dividends)&&integer(m.feesPaid)&&validDay(m.advanceDay,true)&&integer(m.advances)&&m.advances<=LIMITS.marketAdvancesPerDay&&integer(m.lastDividendDay)&&m.lastDividendDay<=m.day&&Array.isArray(m.history)&&m.history.length<=100,'corrupt_data');
    if(m.legacyPot!==null)check(plain(m.legacyPot)&&integer(m.legacyPot.value)&&amount(m.legacyPot.basis,false)&&integer(m.legacyPot.days),'corrupt_data');
    var value=0,basis=0;STOCKS.forEach(function(x){value+=m.prices[x.id]*m.holdings[x.id].quantity;basis+=m.holdings[x.id].costBasis;});
    check(amount(value,false)&&amount(basis,false)&&amount(s.coins+value,false),'amount_overflow');
    if(own(s,'villageEconomy')){check(VillageEconomy&&typeof VillageEconomy.validate==='function','corrupt_data');VillageEconomy.validate(s);}
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
    if(has||raw.pet_game!==null){delete s.pet.eggOrigin;delete s.villageLife;}
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
  function savedRoomSource(s,id) {
    // Action validation receives the confirmed state before assigning its draft.
    // Restored, already-saved legacy sources remain usable without new stock.
    return !!(s&&own(s,'roomLayout')&&plain(s.roomLayout)&&Array.isArray(s.roomLayout.items)&&
      s.roomLayout.items.some(function(row){return plain(row)&&row.id===id;}));
  }
  function starterRoomSourceOwned(s,acquisition,id) {
    return savedRoomSource(s,id)||own(acquisition.claimedFurniture,COZY_ROOM_SOURCES[id]);
  }
  function validateRoomLayout(layout,s,code) {
    code=code||'invalid_room_layout';
    check(exactKeys(layout,['version','items'])&&layout.version===1&&Array.isArray(layout.items)&&layout.items.length<=13,code);
    var seen=Object.create(null),acquisition=s&&own(s,'villageLife')?validateVillageLife(s.villageLife,code):null;
    for(var i=0;i<layout.items.length;i++) {
      var placed=layout.items[i];
      check(own(layout.items,i)&&exactKeys(placed,['id','x','y','flip'])&&typeof placed.id==='string'&&
        integer(placed.x)&&placed.x<=100&&integer(placed.y)&&placed.y<=100&&typeof placed.flip==='boolean',code);
      check(!own(seen,placed.id),code);seen[placed.id]=true;
      var builtin=ROOM_FURNITURE.some(function(entry){return entry.id===placed.id;});
      check(builtin||roomDecoration(placed.id),code);
      check(builtin||plain(s.decorations)&&plain(s.decorations.owned)&&own(s.decorations.owned,placed.id),code==='corrupt_data'?code:'not_owned');
      if(builtin&&acquisition&&acquisition.homeMode==='starter')
        check(starterRoomSourceOwned(s,acquisition,placed.id),code==='corrupt_data'?code:'not_owned');
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
  function cozyRoomType(id) {return COZY_ROOM_TYPES.find(function(row){return row.id===id;});}
  function validateShopInteriorLayout(layout,roomId,code) {
    check(ShopLayout&&ShopLayout.validRoom(roomId),code||'invalid_shop_interior');
    try { return ShopLayout.validateLayout(layout,roomId); }
    catch (_) { check(false,code||'invalid_shop_interior_layout'); }
  }
  function validateShopInteriorLayouts(layouts,code) {
    check(plain(layouts)&&Object.keys(layouts).length<=2&&Reflect.ownKeys(layouts).length===Object.keys(layouts).length,code||'corrupt_data');
    Object.keys(layouts).forEach(function(id){validateShopInteriorLayout(layouts[id],id,code);});return layouts;
  }
  function getShopInteriorLayout(s,roomId) {
    check(ShopLayout&&ShopLayout.validRoom(roomId),'invalid_shop_interior');
    if(s&&own(s,'shopInteriorLayouts')) {
      validateShopInteriorLayouts(s.shopInteriorLayouts,'corrupt_data');
      if(own(s.shopInteriorLayouts,roomId))return clone(validateShopInteriorLayout(s.shopInteriorLayouts[roomId],roomId,'corrupt_data'));
    }
    return ShopLayout.defaultLayout(roomId);
  }
  function validateCozyRoomLayout(layout,s,code) {
    code=code||'invalid_cozy_room_layout';
    check(exactKeys(layout,['version','wall','floor','objects','nextId'])&&layout.version===1&&
      ['brick','floral','mint'].indexOf(layout.wall)>=0&&['honey','oak','check'].indexOf(layout.floor)>=0&&
      Array.isArray(layout.objects)&&layout.objects.length<=24&&Reflect.ownKeys(layout.objects).length===layout.objects.length+1&&
      integer(layout.nextId)&&layout.nextId>0,code);
    var ids=Object.create(null),sources=Object.create(null),largest=0,placedCounts=Object.create(null),ownershipDenied=false;
    var acquisition=s&&own(s,'villageLife')?validateVillageLife(s.villageLife,code):null;
    for(var i=0;i<layout.objects.length;i++) {
      var placed=layout.objects[i];
      check(own(layout.objects,i)&&plain(placed)&&exactKeys(placed,own(placed,'sourceId')?['id','type','x','z','r','sourceId']:['id','type','x','z','r'])&&
        integer(placed.id)&&placed.id>0&&!own(ids,placed.id)&&typeof placed.type==='string'&&
        amount(placed.x,true)&&amount(placed.z,true)&&integer(placed.r)&&placed.r<=3,code);
      var spec=cozyRoomType(placed.type);check(!!spec,code);
      ids[placed.id]=true;largest=Math.max(largest,placed.id);
      var width=placed.r%2?spec.depth:spec.width,depth=placed.r%2?spec.width:spec.depth;
      check(Math.abs(placed.x)+width/2<=3.85+1e-9&&Math.abs(placed.z)+depth/2<=3.85+1e-9,code);
      if(own(placed,'sourceId')) {
        var source=placed.sourceId;
        check(typeof source==='string'&&own(COZY_ROOM_SOURCES,source)&&COZY_ROOM_SOURCES[source]===placed.type&&!own(sources,source),code);
        sources[source]=true;
        if(roomDecoration(source))check(plain(s)&&plain(s.decorations)&&plain(s.decorations.owned)&&own(s.decorations.owned,source),code==='corrupt_data'?code:'not_owned');
        else if(acquisition&&acquisition.homeMode==='starter'&&!starterRoomSourceOwned(s,acquisition,source))ownershipDenied=true;
      } else check(!own(spec,'sourceId'),code);
      if(acquisition&&acquisition.homeMode==='starter'&&HOME_FURNISHINGS.some(function(row){return row.id===placed.type;})) {
        if(!own(placed,'sourceId')&&!own(acquisition.claimedFurniture,placed.type))ownershipDenied=true;
        placedCounts[placed.type]=(placedCounts[placed.type]||0)+1;
      }
      // Old rooms can contain overlapping fixtures. Display/edit collision rules
      // prevent new overlaps without making an existing saved room unreadable.
    }
    check(layout.nextId>largest,code);
    check(!ownershipDenied,code==='corrupt_data'?code:'not_owned');
    Object.keys(placedCounts).forEach(function(type){check(placedCounts[type]<=1,code==='corrupt_data'?code:'not_owned');});
    return layout;
  }
  function defaultCozyRoomLayout() {
    return {version:1,wall:'brick',floor:'honey',objects:[
      {id:1,type:'cupboard',x:-2.5,z:-3.2,r:0},{id:2,type:'counter',x:-.25,z:-3.15,r:0},
      {id:3,type:'bed',x:2.45,z:.2,r:0},{id:4,type:'rug',x:-.5,z:.65,r:0},
      {id:5,type:'table',x:-1,z:-.5,r:0},{id:6,type:'chair',x:-1,z:1.05,r:0},
      {id:7,type:'plant',x:-3,z:2.35,r:0},{id:8,type:'lamp',x:3,z:-2.5,r:0}
    ],nextId:9};
  }
  function cozyRoomFromLegacy(row,id) {
    var type=COZY_ROOM_SOURCES[row.id],spec=cozyRoomType(type);
    // A legacy mirror bit becomes a half-turn in this detached projection only.
    // The original flip and percentage coordinates remain in roomLayout verbatim.
    var r=row.flip?2:0,width=r%2?spec.depth:spec.width,depth=r%2?spec.width:spec.depth;
    var edgeX=3.85-width/2,edgeZ=3.85-depth/2;
    return {id:id,type:type,x:Math.max(-edgeX,Math.min(edgeX,(row.x/100-.5)*6.4)),
      z:Math.max(-edgeZ,Math.min(edgeZ,(row.y/100-.5)*6.4)),r:r,sourceId:row.id};
  }
  function getCozyRoomLayout(s) {
    if(s&&own(s,'cozyRoomLayout'))return clone(validateCozyRoomLayout(s.cozyRoomLayout,s,'corrupt_data'));
    var layout=defaultCozyRoomLayout();
    if(s&&own(s,'villageLife')&&validateVillageLife(s.villageLife).homeMode==='starter')
      layout.objects=layout.objects.filter(function(row){return row.type==='bed'||row.type==='rug';});
    if(s&&own(s,'roomLayout')) {
      var previous=validateRoomLayout(s.roomLayout,s,'corrupt_data');
      layout.objects=previous.items.map(function(row,i){return cozyRoomFromLegacy(row,i+1);});
      layout.nextId=layout.objects.length+1;
    } else {
      var decor=s&&s.decorations,equipped=decor&&decor.equipped;
      if(roomDecoration(equipped)&&plain(decor.owned)&&own(decor.owned,equipped)) {
        layout.objects.push(cozyRoomFromLegacy({id:equipped,x:74,y:94,flip:false},layout.nextId++));
      }
    }
    return clone(validateCozyRoomLayout(layout,s,'corrupt_data'));
  }
  function validateVillageLayout(layout,code) {
    code=code||'invalid_village_layout';
    check(exactKeys(layout,['version','theme','items'])&&layout.version===1&&layout.theme==='cafe'&&
      Array.isArray(layout.items)&&layout.items.length===VILLAGE_PLACES.length&&
      Reflect.ownKeys(layout.items).length===VILLAGE_PLACES.length+1,code);
    var seen=Object.create(null);
    for(var i=0;i<layout.items.length;i++) {
      var placed=layout.items[i];
      check(own(layout.items,i)&&exactKeys(placed,['id','x','y'])&&typeof placed.id==='string'&&
        integer(placed.x)&&placed.x<=100&&integer(placed.y)&&placed.y<=100,code);
      check(VILLAGE_PLACES.some(function(entry){return entry.id===placed.id;})&&!own(seen,placed.id),code);
      seen[placed.id]=true;
    }
    return layout;
  }
  function defaultVillageLayout() {
    return {version:1,theme:'cafe',items:VILLAGE_PLACES.map(function(entry){return {id:entry.id,x:entry.x,y:entry.y};})};
  }
  function getVillageLayout(s) {
    if(s&&own(s,'villageLayout'))return clone(validateVillageLayout(s.villageLayout,'corrupt_data'));
    return defaultVillageLayout();
  }
  // This optional candidate bookmark carries no adoption, resident, reward or
  // unlock authority. Merely reading an older save never initializes it.
  function validateOpeningStory(value,code) {
    check(exactKeys(value,['version','candidateId','readThrough'])&&value.version===1&&
      value.candidateId==='quiet-arrival-v1'&&integer(value.readThrough)&&value.readThrough<=3,code);
    return value;
  }
  function getOpeningStoryView(s) {
    var bookmark=s&&own(s,'openingStory')?validateOpeningStory(s.openingStory,'corrupt_data'):
      {version:1,candidateId:'quiet-arrival-v1',readThrough:0};
    return {version:1,candidateId:bookmark.candidateId,readThrough:bookmark.readThrough,
      pageCount:3,complete:bookmark.readThrough===3};
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
      if(a.type==='readOpeningStory') {
        check(exactKeys(a,['type','expectedRevision','candidateId','page'])&&integer(a.expectedRevision),'invalid_opening_story');
        check(a.expectedRevision===next.revision,'stale_state');
        check(ms>=next.updatedAt&&ms>=next.createdAt,'clock_moved_back');
        var opening=getOpeningStoryView(next);
        check(a.candidateId===opening.candidateId&&integer(a.page)&&a.page>=1&&a.page<=opening.pageCount&&
          a.page===opening.readThrough+1,'invalid_opening_story');
        next.openingStory={version:1,candidateId:opening.candidateId,readThrough:a.page};
        // Reading may precede egg selection. It must bypass care, evolution and
        // the generic achievement tail, including incidental wealth awards.
        return;
      }
      if(a.type==='chooseEgg') {
        check(validEggKey(a.eggOrigin),'invalid_egg');check(needsEggChoice(next),'egg_already_chosen');
        next.pet.eggOrigin=a.eggOrigin;
        // Selection changes identity only: no care, evolution, rewards or generic achievements.
        return reward;
      }
      check(!needsEggChoice(next),'egg_required');
      if((a.type==='care'||a.type==='useItem')&&own(a,'expectedRevision'))
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
      if(a.type==='recordOceanDiscovery') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        check(ms>=next.updatedAt,'clock_moved_back');
        check(!!OceanDiscoveries&&typeof OceanDiscoveries.record==='function','invalid_ocean_discovery');
        var discoveries=own(next,'oceanDiscoveries')?next.oceanDiscoveries:OceanDiscoveries.empty();
        next.oceanDiscoveries=OceanDiscoveries.record(discoveries,{creatureId:a.creatureId,position:a.position,mode:a.mode,depth:a.depth,at:ms});
        // Observation is its own collection: no EXP, inventory, coins or achievements.
        return null;
      }
      if(['startRiverFishing','reelRiverFishing','cancelRiverFishing'].indexOf(a.type)>=0) {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        check(ms>=next.updatedAt,'clock_moved_back');
        var fishing=own(next,'riverFishing')?clone(next.riverFishing):RiverFishing.empty();
        check(RiverFishing.valid(fishing),'corrupt_data');
        var attempt=fishing.active,view=getRiverFishingView(next,ms,a.position);
        if(a.type==='startRiverFishing') {
          check(!attempt,'fishing_active');check(view.nearBank&&a.spotId===view.site.id,'invalid_fishing');
          check(ms>=fishing.nextCastAt,'fishing_cooldown');check(integer(ms+RiverFishing.WINDOW),'invalid_clock');
          fishing=RiverFishing.start(fishing,ms,'river-'+(next.revision+1)+'-'+ms);
        } else {
          check(attempt&&typeof a.attemptId==='string'&&a.attemptId===attempt.id,'invalid_fishing');
          check(ms>=attempt.startedAt,'clock_moved_back');
          if(a.type==='reelRiverFishing') {
            check(view.nearBank,'invalid_fishing');check(ms>=attempt.biteAt,'fishing_wait');check(ms<=attempt.expiresAt,'fishing_escaped');
            var catchResult=RiverFishing.reel(fishing,ms);fishing=catchResult.state;reward=catchResult.reward;
          }
          if(a.type==='cancelRiverFishing')fishing=RiverFishing.cancel(fishing,ms);
        }
        next.riverFishing=fishing;return reward;
      }
      if(a.type==='harvestVillageFood') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        var plot=harvestPlots(ms).find(function(p){return p.id===a.plotId;});check(!!plot,'invalid_harvest');
        check(ms>=next.updatedAt,'clock_moved_back');var life=ensureVillageLife(next),harvest=life.harvest,today=harvestDay(ms);
        check(!harvest.day||today>=harvest.day,'clock_moved_back');
        if(harvest.day!==today){harvest.day=today;harvest.claimed=[];}
        check(harvest.claimed.indexOf(plot.id)<0,'harvest_wait');check((next.inventory[plot.itemId]||0)<MAX,'amount_overflow');
        next.inventory[plot.itemId]=(next.inventory[plot.itemId]||0)+1;harvest.claimed.push(plot.id);
        return {itemId:plot.itemId,quantity:1};
      }
      if(a.type==='claimHomeFurniture'||a.type==='buyHomeFurniture') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        check(ms>=next.updatedAt,'clock_moved_back');
        var furnishing=getHomeFurnishingsView(next).rows.find(function(f){return f.id===a.furnitureId;});check(!!furnishing,'invalid_home_furniture');
        check(!furnishing.owned,'already_owned');check(a.type==='claimHomeFurniture'?furnishing.canClaim:furnishing.available,'home_furniture_locked');
        if(a.type==='buyHomeFurniture'){check(next.coins>=furnishing.price,'insufficient_coins');next.coins-=furnishing.price;paidPurchase(next);}
        ensureVillageLife(next).claimedFurniture[furnishing.id]=true;return reward;
      }
      if(VillageEconomy&&VillageEconomy.handles(a.type)) {
        var walletBefore=next.coins;
        var village=VillageEconomy.transition(next,a,ms);next.villageEconomy=village.economy;
        next.coins=village.coins;next.inventory=village.inventory;
        if(a.type==='buyVillageOffer'&&next.coins<walletBefore)paidPurchase(next);
        // NPC transactions never change care, EXP, evolution or achievements.
        return village.reward;
      }
      if(a.type==='saveRoomLayout') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        validateRoomLayout(a.layout,next);next.roomLayout=clone(a.layout);
        // Moving or removing furniture never charges, rewards or backfills achievements.
        return reward;
      }
      if(a.type==='saveShopInteriorLayout') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        var shopLayout=validateShopInteriorLayout(a.layout,a.roomId);
        next.shopInteriorLayouts=Object.assign({},next.shopInteriorLayouts||{});
        next.shopInteriorLayouts[a.roomId]=clone(shopLayout);
        // Shop fixtures are view preferences, separate from home and all ownership/economy.
        return reward;
      }
      if(a.type==='saveCozyRoomLayout') {
        check(integer(a.expectedRevision)&&a.expectedRevision===next.revision,'stale_state');
        validateCozyRoomLayout(a.layout,next);next.cozyRoomLayout=clone(a.layout);
        // Free room design never changes ownership, care, growth or rewards.
        return reward;
      }
      if(a.type==='saveVillageLayout') {
        // Exterior changes belong to a commissioned construction flow. Archived
        // layouts remain readable/restorable; this retired direct command cannot write.
        fail('village_construction_required','村の配置を直接変更する操作は終了しました。');
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
        var it=item(a.itemId);check(!!it&&!it.harvestOnly,'invalid_item');
        if(it.type==='clothing') {
          var wardrobe=next.wardrobe||{owned:{},equipped:null};
          check(!own(wardrobe.owned,it.id),'already_owned');check(next.coins>=it.price,'insufficient_coins');
          next.coins-=it.price;wardrobe.owned[it.id]=true;next.wardrobe=wardrobe;
          if(it.price>0)paidPurchase(next);
          return reward;
        }
        check(next.coins>=it.price,'insufficient_coins');
        if(it.type==='food'){next.coins-=it.price;next.inventory[it.id]=(next.inventory[it.id]||0)+1;}
        else if(it.type==='decoration'){check(!own(next.decorations.owned,it.id),'already_owned');next.coins-=it.price;next.decorations.owned[it.id]={};}
        else {var bg=it.id.slice(3);check(next.decorations.backgrounds.indexOf(bg)<0,'already_owned');next.coins-=it.price;next.decorations.backgrounds.push(bg);}
        if(it.price>0)paidPurchase(next);
      } else if(a.type==='useItem') {
        var food=item(a.itemId);check(food&&food.type==='food','invalid_item');check(next.inventory[a.itemId]>0,'not_owned');next.inventory[a.itemId]--;next.pet.exp+=food.exp;next.care.lastCareAt=ms;reward.exp=food.exp;
        evolutionKind=food.id==='apple'||food.id==='berry'||food.foodGroup==='fruit'?'fruit':food.id==='cake'?'sweet':'hearty';
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
    api={ready:ready,getState:visible,dispatch:dispatch,getStage:getStage,getLilacGrowth:getLilacGrowth,getLilacAppearance:getLilacAppearance,getLilacEvolution:getLilacEvolution,getEggOrigin:getEggOrigin,needsEggChoice:needsEggChoice,getVillageLayout:function(){return getVillageLayout(state);},getCozyRoomLayout:function(){return getCozyRoomLayout(state);},getHomeFurnishingsView:function(){return getHomeFurnishingsView(state);},getCozyRoomFurniture:function(){return getCozyRoomFurniture(state);},getVillageHarvestView:function(ms){return getVillageHarvestView(state,ms===undefined?Number(clock()):ms);},getRiverFishingView:function(ms,position){return getRiverFishingView(state,ms===undefined?Number(clock()):ms,position);},getOceanDiscoveryView:function(){return getOceanDiscoveryView(state);},getVillageEconomyView:function(ms){return VillageEconomy.view(state,ms===undefined?Number(clock()):ms);},
      getOpeningStoryView:function(){return getOpeningStoryView(state);},
      subscribe:function(fn){check(typeof fn==='function','invalid_listener');listeners.push(fn);return function(){listeners=listeners.filter(function(x){return x!==fn;});};},
      exportBackup:function(){check(!loading&&!blocked,'read_only');return JSON.stringify({format:'PetGameBackup',version:3,exportedAt:time(),state:clone(state)});},
      importBackup:importBackup};return api;
  }
  return {create:create,getStage:getStage,getLilacGrowth:getLilacGrowth,lilacGrowthStages:lilacGrowthStages,getLilacAppearance:getLilacAppearance,lilacAppearanceStages:lilacAppearanceStages,getLilacEvolution:getLilacEvolution,lilacEvolutionPaths:lilacEvolutionPaths,getMarketSummary:summary,eggCatalogue:eggCatalogue,eggProfile:eggProfile,getEggOrigin:getEggOrigin,needsEggChoice:needsEggChoice,KEY:KEY,STORAGE_KEY:KEY,
    roomFurniture:clone(ROOM_FURNITURE),defaultRoomLayout:defaultRoomLayout,getRoomLayout:getRoomLayout,
    cozyRoomFurniture:clone(COZY_ROOM_FURNITURE),cozyRoomTypes:clone(COZY_ROOM_TYPES),defaultCozyRoomLayout:defaultCozyRoomLayout,getCozyRoomLayout:getCozyRoomLayout,
    getHomeFurnishingsView:getHomeFurnishingsView,getCozyRoomFurniture:getCozyRoomFurniture,seasonalLifeRevision:'annual-life1',getSeasonalLife:seasonalLife,getVillageHarvestView:getVillageHarvestView,getRiverFishingView:getRiverFishingView,getOceanDiscoveryView:getOceanDiscoveryView,
    getShopInteriorLayout:getShopInteriorLayout,
    villagePlaces:VILLAGE_PLACES,defaultVillageLayout:defaultVillageLayout,getVillageLayout:getVillageLayout,getOpeningStoryView:getOpeningStoryView,
    getVillageEconomyView:function(s,ms){return VillageEconomy.view(s,ms===undefined?Date.now():ms);},
    STOCKS:clone(STOCKS),stocks:clone(STOCKS),ITEMS:clone(ITEMS),items:clone(ITEMS),catalogue:clone(ITEMS),
    LIMITS:clone(LIMITS),limits:clone(LIMITS),LEGACY_KEYS:LEGACY_KEYS.slice()};
}));
