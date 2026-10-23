(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetVillageEconomy = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure NPC simulation. The host alone commits the returned wallet, inventory
  // and optional economy in its existing awaited, encrypted v3 transaction.
  var MAX = 9000000000000, WAIT = 60000, DAILY = 12;
  var FOODS = [
    {id:'apple',name:'りんご',emoji:'🍎',price:8},
    {id:'cake',name:'ケーキ',emoji:'🍰',price:18},
    {id:'berry',name:'いちご',emoji:'🍓',price:6},
    {id:'rice',name:'おにぎり',emoji:'🍙',price:12},
    {id:'feast',name:'ごちそう',emoji:'🍗',price:15}
  ];
  var SHOPS = [
    {id:'orchard',name:'こもれび青果店',totalShares:20,sharePrice:10,foods:['apple','berry'],benefitItem:'apple',npcContribution:2},
    {id:'bakery',name:'ふんわり食堂',totalShares:30,sharePrice:10,foods:['cake','rice'],benefitItem:'rice',npcContribution:2}
  ];
  var RESIDENTS = [
    {id:'r_momo',name:'モモ'}, {id:'r_koto',name:'コト'}, {id:'r_haru',name:'ハル'},
    {id:'r_sora',name:'ソラ'}, {id:'r_nagi',name:'ナギ'}, {id:'r_yuzu',name:'ユズ'}
  ];
  var VISITORS = [
    {id:'v_lulu',name:'ルル'}, {id:'v_rin',name:'リン'}, {id:'v_poco',name:'ポコ'},
    {id:'v_fuu',name:'フウ'}, {id:'v_nono',name:'ノノ'}, {id:'v_toto',name:'トト'},
    {id:'v_suzu',name:'スズ'}, {id:'v_mugi',name:'ムギ'}
  ];
  var COMMANDS = ['placeVillageListing','cancelVillageListing','buyVillageOffer','advanceVillageEconomy',
    'contributeVillageShop','buyVillageShares','sellVillageShares','claimVillageBenefit'];
  var EVENTS = ['listed','cancelled','sale','purchase','contribution','npc_contribution','open','dividend','benefit','shares_bought','shares_sold','day'];
  var ECONOMY_KEYS = ['version','seed','day','lastActionAt','lastAdvanceAt','advanceJstDay','advances','nextListingId','nextEventId',
    'listings','offers','shops','salesRevenue','purchasesSpent','history'];
  var SHOP_KEYS = ['status','playerShares','npcShares','capitalRaised','playerCapital','npcCapital','constructionCost','costBasis','price','previousPrice',
    'buildReadyDay','openedDay','buybackCoins','revenue','costs','profitReserve','dividends','npcDividends','benefitCost',
    'pendingBenefit','claimedBenefits','lastDividendDay','realizedProfit','feesPaid','npcLiquidityIn','npcLiquidityOut','sharePurchases','shareSales'];
  function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
  function plain(v) { return v!==null&&typeof v==='object'&&!Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function fail(code) { var e=new Error(code);e.code=code;throw e; }
  function check(v,code) { if(!v)fail(code||'village_invalid'); }
  function integer(v,signed) { return typeof v==='number'&&Number.isSafeInteger(v)&&Math.abs(v)<=MAX&&(signed||v>=0); }
  function amount(v,signed) { return typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=MAX&&(signed||v>=0); }
  function keys(v,names) { return plain(v)&&Object.keys(v).length===names.length&&names.every(function(k){return own(v,k);}); }
  function byId(rows,id) { for(var i=0;i<rows.length;i++)if(rows[i].id===id)return rows[i];return null; }
  function food(id) { return byId(FOODS,id); }
  function shop(id) { return byId(SHOPS,id); }
  function sum(a,b) { var n=a+b;check(integer(n,true),'amount_overflow');return n; }
  function product(a,b) { var n=a*b;check(integer(n),'amount_overflow');return n; }
  function moneySum(a,b) { var n=a+b;check(amount(n,true),'amount_overflow');return n; }
  function hash(s) { var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0; }
  function dice(e,key,mod) { return hash(e.seed+':'+e.day+':'+key)%mod; }
  function jstDay(ms) { return Math.floor((ms+32400000)/86400000); }
  function people(e) {
    var count=Math.min(6,2+Math.floor((e.day-1)/4)), residents=RESIDENTS.slice(0,count).map(clone), visitors=[];
    var start=(e.day-1)%VISITORS.length;
    for(var i=0;i<3;i++)visitors.push(clone(VISITORS[(start+i)%VISITORS.length]));
    residents.concat(visitors).forEach(function(p){p.budget=24+dice(e,p.id+':budget',41);});
    return {residents:residents,visitors:visitors};
  }
  function newShop() {
    return {status:'funding',playerShares:0,npcShares:0,capitalRaised:0,playerCapital:0,npcCapital:0,constructionCost:0,costBasis:0,
      price:10,previousPrice:10,buildReadyDay:null,openedDay:null,buybackCoins:0,revenue:0,costs:0,
      profitReserve:0,dividends:0,npcDividends:0,benefitCost:0,pendingBenefit:0,claimedBenefits:0,
      lastDividendDay:0,realizedProfit:0,feesPaid:0,npcLiquidityIn:0,npcLiquidityOut:0,sharePurchases:0,shareSales:0};
  }
  function makeOffers(e) {
    var offers=[], visit=people(e).visitors;
    visit.forEach(function(n,i){
      var f=FOODS[(dice(e,n.id+':food',FOODS.length)+i)%FOODS.length];
      offers.push({id:n.id+'_'+f.id+'_d'+e.day,npcId:n.id,shopId:null,itemId:f.id,
        unitPrice:f.price+1+dice(e,n.id+':price',4),quantity:3,remaining:3});
    });
    SHOPS.forEach(function(spec){if(e.shops[spec.id].status!=='open')return;
      spec.foods.forEach(function(id){var f=food(id),q=4;
        offers.push({id:spec.id+'_'+id+'_d'+e.day,npcId:null,shopId:spec.id,itemId:id,
          unitPrice:f.price+2+dice(e,spec.id+':'+id+':price',4),quantity:q,remaining:q});
      });
    });return offers;
  }
  function initial(s) {
    var e={version:1,seed:hash('village-v1:'+s.createdAt),day:1,lastActionAt:null,lastAdvanceAt:null,
      advanceJstDay:null,advances:0,nextListingId:1,nextEventId:1,listings:[],offers:[],shops:{},
      salesRevenue:0,purchasesSpent:0,history:[]};
    SHOPS.forEach(function(spec){e.shops[spec.id]=newShop();});e.offers=makeOffers(e);return e;
  }
  function get(s) { if(own(s,'villageEconomy')){validate(s);return clone(s.villageEconomy);}return initial(s); }
  function validate(s,code) {
    if(!own(s,'villageEconomy'))return true;
    code=code||'corrupt_data';var e=s.villageEconomy;
    check(keys(e,ECONOMY_KEYS)&&e.version===1,code);
    check(integer(e.seed)&&e.seed<=4294967295&&integer(e.day)&&e.day>=1,code);
    ['lastActionAt','lastAdvanceAt','advanceJstDay'].forEach(function(k){check(e[k]===null||integer(e[k]),code);});
    check(e.lastAdvanceAt===null||e.lastActionAt!==null&&e.lastAdvanceAt<=e.lastActionAt,code);
    check((e.lastAdvanceAt===null)===(e.advanceJstDay===null),code);
    check(integer(e.advances)&&e.advances<=DAILY&&(e.lastAdvanceAt!==null||e.advances===0),code);
    if(e.lastAdvanceAt!==null)check(jstDay(e.lastAdvanceAt)===e.advanceJstDay&&e.advances>0&&e.day>=2,code);
    check(integer(e.nextListingId)&&e.nextListingId>0&&integer(e.nextEventId)&&e.nextEventId>0,code);
    check(integer(e.salesRevenue)&&integer(e.purchasesSpent)&&Array.isArray(e.listings)&&e.listings.length<=8,code);
    var ids={};e.listings.forEach(function(l){
      check(keys(l,['id','itemId','quantity','remaining','unitPrice','listedDay'])&&integer(l.id)&&l.id>0&&l.id<e.nextListingId&&!own(ids,l.id),code);ids[l.id]=true;
      check(!!food(l.itemId)&&integer(l.quantity)&&l.quantity>0&&l.quantity<=99&&integer(l.remaining)&&l.remaining>0&&l.remaining<=l.quantity,code);
      check(integer(l.unitPrice)&&l.unitPrice>=1&&l.unitPrice<=999&&integer(l.listedDay)&&l.listedDay>=1&&l.listedDay<=e.day,code);
    });
    check(keys(e.shops,SHOPS.map(function(x){return x.id;})),code);
    var value=0;SHOPS.forEach(function(spec){var p=e.shops[spec.id];
      check(keys(p,SHOP_KEYS)&&['funding','building','open'].indexOf(p.status)>=0,code);
      SHOP_KEYS.filter(function(k){return ['status','buildReadyDay','openedDay','realizedProfit','costBasis'].indexOf(k)<0;}).forEach(function(k){check(integer(p[k]),code);});
      check(amount(p.realizedProfit,true)&&amount(p.costBasis)&&p.costBasis<=p.playerShares*31&&p.playerShares+p.npcShares<=spec.totalShares&&(p.playerShares>0||p.costBasis===0),code);
      check(p.capitalRaised===(p.playerShares+p.npcShares)*spec.sharePrice,code);
      check(p.playerCapital+p.npcCapital===p.capitalRaised&&p.playerCapital%10===0&&p.npcCapital%10===0,code);
      check(p.price>=3&&p.price<=30&&p.previousPrice>=3&&p.previousPrice<=30&&p.buybackCoins<=80,code);
      check(p.buildReadyDay===null||integer(p.buildReadyDay)&&p.buildReadyDay>=2,code);
      check(p.openedDay===null||integer(p.openedDay)&&p.openedDay>=2&&p.openedDay<=e.day,code);
      if(p.status==='funding')check(p.capitalRaised<spec.totalShares*10&&p.buildReadyDay===null&&p.openedDay===null&&p.constructionCost===0,code);
      else check(p.capitalRaised===spec.totalShares*10&&p.buildReadyDay!==null,code);
      if(p.status==='building')check(p.buildReadyDay===e.day+1&&p.openedDay===null&&p.constructionCost===0,code);
      if(p.status==='open')check(p.openedDay===p.buildReadyDay&&p.constructionCost===spec.totalShares*10,code);
      else check(p.revenue===0&&p.costs===0&&p.profitReserve===0&&p.dividends===0&&p.npcDividends===0&&p.benefitCost===0&&p.pendingBenefit===0&&p.claimedBenefits===0&&p.buybackCoins===0&&p.lastDividendDay===0&&p.realizedProfit===0&&p.feesPaid===0&&p.price===10&&p.previousPrice===10&&p.costBasis===p.playerShares*10&&p.playerCapital===p.playerShares*10&&p.npcCapital===p.npcShares*10&&p.npcLiquidityIn===0&&p.npcLiquidityOut===0&&p.sharePurchases===0&&p.shareSales===0,code);
      check(p.buybackCoins===p.npcLiquidityIn+p.sharePurchases-p.shareSales-p.npcLiquidityOut,code);
      check(p.lastDividendDay<=e.day&&(p.lastDividendDay===0||p.lastDividendDay%3===0),code);
      check(p.benefitCost===(p.pendingBenefit+p.claimedBenefits)*food(spec.benefitItem).price,code);
      check(p.profitReserve===p.revenue-p.costs-p.dividends-p.npcDividends-p.benefitCost,code);
      value+=p.playerShares*p.price;
    });
    // Include the pre-existing independent market in the aggregate overflow bound.
    var oldValue=0;if(s.market&&s.market.holdings&&s.market.prices)Object.keys(s.market.holdings).forEach(function(id){oldValue+=s.market.holdings[id].quantity*s.market.prices[id];});
    check(integer(value)&&integer(oldValue)&&integer(s.coins)&&integer(s.coins+oldValue+value),'amount_overflow');
    var expected=makeOffers(e);check(Array.isArray(e.offers)&&e.offers.length===expected.length,code);
    e.offers.forEach(function(o,i){var x=expected[i];check(keys(o,['id','npcId','shopId','itemId','unitPrice','quantity','remaining'])&&
      ['id','npcId','shopId','itemId','unitPrice','quantity'].every(function(k){return o[k]===x[k];})&&integer(o.remaining)&&o.remaining<=o.quantity,code);});
    check(Array.isArray(e.history)&&e.history.length<=100,code);var prev=0;
    e.history.forEach(function(h){check(keys(h,['id','day','type','itemId','quantity','coins','shopId','profit'])&&integer(h.id)&&h.id>prev&&h.id<e.nextEventId,code);prev=h.id;
      check(integer(h.day)&&h.day>=1&&h.day<=e.day&&EVENTS.indexOf(h.type)>=0&&(h.itemId===null||!!food(h.itemId))&&
        (h.shopId===null||!!shop(h.shopId))&&integer(h.quantity)&&integer(h.coins,true)&&amount(h.profit,true),code);});
    return true;
  }
  function record(e,type,fields) {
    var h={id:e.nextEventId,day:e.day,type:type,itemId:null,quantity:0,coins:0,shopId:null,profit:0};
    Object.keys(fields||{}).forEach(function(k){h[k]=fields[k];});e.nextEventId=sum(e.nextEventId,1);e.history.push(h);
    if(e.history.length>100)e.history.shift();
  }
  function advanceInfo(e,ms) {
    if(!integer(ms)||e.lastActionAt!==null&&ms<e.lastActionAt)return {canAdvance:false,waitMs:0,dailyRemaining:0,reason:'clock_moved_back'};
    var day=jstDay(ms),n=e.advanceJstDay===day?e.advances:0,wait=e.lastAdvanceAt===null?0:Math.max(0,WAIT-(ms-e.lastAdvanceAt));
    if(e.advanceJstDay!==null&&day<e.advanceJstDay)return {canAdvance:false,waitMs:0,dailyRemaining:0,reason:'clock_moved_back'};
    if(n>=DAILY)return {canAdvance:false,waitMs:Math.max(wait,(day+1)*86400000-32400000-ms),dailyRemaining:0,reason:'daily_limit'};
    return {canAdvance:wait===0,waitMs:wait,dailyRemaining:DAILY-n,reason:wait?'village_wait':null};
  }
  function capitalize(e,spec) { var p=e.shops[spec.id];if(p.status==='funding'&&p.playerShares+p.npcShares===spec.totalShares){p.status='building';p.buildReadyDay=e.day+1;} }
  function shopSale(e,id,itemId,q,unitPrice) {
    var p=e.shops[id],gross=product(q,unitPrice),cost=product(q,food(itemId).price);
    p.revenue=sum(p.revenue,gross);p.costs=sum(p.costs,cost);p.profitReserve=sum(p.profitReserve,gross-cost);
  }
  function settle(e,tx) {
    var buyers=people(e);buyers.residents.concat(buyers.visitors).forEach(function(n){
      var budget=n.budget;
      FOODS.forEach(function(f){var demand=dice(e,n.id+':'+f.id+':demand',3),limit=Math.max(1,Math.floor(f.price*(.7+dice(e,n.id+':'+f.id+':limit',91)/100)));
        // Cheapest compatible stall first; immutable IDs break equal-price ties.
        e.listings.slice().sort(function(a,b){return a.unitPrice-b.unitPrice||a.id-b.id;}).forEach(function(l){
          if(!demand||!l.remaining||l.itemId!==f.id||l.unitPrice>limit)return;
          var q=Math.min(demand,l.remaining,Math.floor(budget/l.unitPrice));if(!q)return;
          var gross=product(q,l.unitPrice);l.remaining-=q;demand-=q;budget-=gross;tx.coins=sum(tx.coins,gross);e.salesRevenue=sum(e.salesRevenue,gross);
          record(e,'sale',{itemId:f.id,quantity:q,coins:gross});
        });
        e.offers.forEach(function(o){if(!demand||!o.shopId||!o.remaining||o.itemId!==f.id||o.unitPrice>limit)return;
          var q=Math.min(demand,o.remaining,Math.floor(budget/o.unitPrice));if(!q)return;
          o.remaining-=q;demand-=q;budget-=q*o.unitPrice;shopSale(e,o.shopId,f.id,q,o.unitPrice);
        });
      });
    });e.listings=e.listings.filter(function(l){return l.remaining>0;});
  }
  function advance(e,tx,ms) {
    var info=advanceInfo(e,ms);check(info.canAdvance,info.reason);
    var today=jstDay(ms);if(e.advanceJstDay!==today)e.advances=0;
    e.advanceJstDay=today;e.advances++;e.lastAdvanceAt=ms;e.day=sum(e.day,1);
    SHOPS.forEach(function(spec){var p=e.shops[spec.id];
      if(p.status==='building'&&e.day>=p.buildReadyDay){p.status='open';p.openedDay=e.day;p.constructionCost=spec.totalShares*10;record(e,'open',{shopId:spec.id});}
      if(p.status==='funding'){
        var q=Math.min(spec.npcContribution,spec.totalShares-p.playerShares-p.npcShares);
        p.npcShares+=q;p.capitalRaised+=q*10;p.npcCapital+=q*10;record(e,'npc_contribution',{shopId:spec.id,quantity:q,coins:q*10});capitalize(e,spec);
      }
      if(p.status==='open'){p.npcLiquidityIn=sum(p.npcLiquidityIn,80-p.buybackCoins);p.buybackCoins=80;}
    });
    e.offers=makeOffers(e);settle(e,tx);
    SHOPS.forEach(function(spec){var p=e.shops[spec.id];if(p.status!=='open')return;
      p.previousPrice=p.price;var shift=dice(e,spec.id+':quote',7)-3;
      p.price=Math.max(3,Math.min(30,p.price+shift));
      if(e.day%3!==0||p.lastDividendDay===e.day)return;
      p.lastDividendDay=e.day;
      var perShare=Math.floor(Math.floor(p.profitReserve/2)/spec.totalShares),player=product(perShare,p.playerShares),npc=product(perShare,p.npcShares);
      p.profitReserve-=player+npc;p.dividends=sum(p.dividends,player);p.npcDividends=sum(p.npcDividends,npc);tx.coins=sum(tx.coins,player);
      if(player)record(e,'dividend',{shopId:spec.id,quantity:p.playerShares,coins:player});
      var cost=food(spec.benefitItem).price;
      if(p.playerShares>=2&&p.profitReserve>=cost){p.profitReserve-=cost;p.benefitCost=sum(p.benefitCost,cost);p.pendingBenefit=sum(p.pendingBenefit,1);}
    });record(e,'day',{});
  }
  function transition(s,a,ms) {
    check(plain(a)&&COMMANDS.indexOf(a.type)>=0,'invalid_action');
    check(integer(a.expectedRevision)&&a.expectedRevision===s.revision,'stale_state');
    check(integer(ms),'invalid_clock');var e=get(s);
    check(ms>=s.updatedAt&&(e.lastActionAt===null||ms>=e.lastActionAt),'clock_moved_back');
    var tx={economy:e,coins:s.coins,inventory:clone(s.inventory),reward:{}};
    if(a.type==='placeVillageListing'){
      check(!!food(a.itemId)&&integer(a.quantity)&&a.quantity>=1&&a.quantity<=99&&integer(a.unitPrice)&&a.unitPrice>=1&&a.unitPrice<=999,'village_invalid');
      check(e.listings.length<8,'village_listing_limit');check((tx.inventory[a.itemId]||0)>=a.quantity,'not_owned');
      tx.inventory[a.itemId]-=a.quantity;e.listings.push({id:e.nextListingId,itemId:a.itemId,quantity:a.quantity,remaining:a.quantity,unitPrice:a.unitPrice,listedDay:e.day});
      e.nextListingId=sum(e.nextListingId,1);record(e,'listed',{itemId:a.itemId,quantity:a.quantity});
    } else if(a.type==='cancelVillageListing'){
      check(integer(a.listingId)&&a.listingId>0,'village_invalid');var l=byId(e.listings,a.listingId);check(l,'village_not_found');
      tx.inventory[l.itemId]=sum(tx.inventory[l.itemId]||0,l.remaining);e.listings=e.listings.filter(function(x){return x.id!==l.id;});record(e,'cancelled',{itemId:l.itemId,quantity:l.remaining});
    } else if(a.type==='buyVillageOffer'){
      check(typeof a.offerId==='string'&&integer(a.quantity)&&a.quantity>0&&a.quantity<=99,'village_invalid');var o=byId(e.offers,a.offerId);check(o&&o.remaining>=a.quantity,'village_not_found');
      var gross=product(o.unitPrice,a.quantity);check(tx.coins>=gross,'insufficient_coins');tx.coins-=gross;tx.inventory[o.itemId]=sum(tx.inventory[o.itemId]||0,a.quantity);o.remaining-=a.quantity;
      e.purchasesSpent=sum(e.purchasesSpent,gross);if(o.shopId)shopSale(e,o.shopId,o.itemId,a.quantity,o.unitPrice);
      record(e,'purchase',{itemId:o.itemId,quantity:a.quantity,coins:-gross,shopId:o.shopId});
    } else if(a.type==='advanceVillageEconomy')advance(e,tx,ms);
    else {
      var spec=shop(a.shopId);check(spec,'village_not_found');var p=e.shops[spec.id];
      if(a.type==='contributeVillageShop'){
        check(p.status==='funding','village_not_open');check(integer(a.quantity)&&a.quantity>0&&a.quantity<=spec.totalShares-p.playerShares-p.npcShares,'village_invalid');
        var capital=product(a.quantity,spec.sharePrice);check(tx.coins>=capital,'insufficient_coins');tx.coins-=capital;p.playerShares+=a.quantity;p.costBasis+=capital;p.capitalRaised+=capital;p.playerCapital+=capital;
        capitalize(e,spec);record(e,'contribution',{shopId:spec.id,quantity:a.quantity,coins:-capital});
      } else if(a.type==='buyVillageShares'){
        check(p.status==='open','village_not_open');check(integer(a.quantity)&&a.quantity>0&&a.quantity<=p.npcShares,'insufficient_shares');
        var paid=product(p.price,a.quantity),purchaseFee=Math.max(1,Math.ceil(paid/100));check(tx.coins>=paid+purchaseFee,'insufficient_coins');
        tx.coins-=paid+purchaseFee;p.playerShares+=a.quantity;p.npcShares-=a.quantity;p.costBasis=moneySum(p.costBasis,paid+purchaseFee);p.feesPaid=sum(p.feesPaid,purchaseFee);
        p.sharePurchases=sum(p.sharePurchases,paid);var overflow=Math.max(0,p.buybackCoins+paid-80);p.npcLiquidityOut=sum(p.npcLiquidityOut,overflow);p.buybackCoins=Math.min(80,p.buybackCoins+paid);tx.reward.fee=purchaseFee;
        record(e,'shares_bought',{shopId:spec.id,quantity:a.quantity,coins:-(paid+purchaseFee)});
      } else if(a.type==='sellVillageShares'){
        check(p.status==='open','village_not_open');check(integer(a.quantity)&&a.quantity>0&&a.quantity<=p.playerShares,'insufficient_shares');
        var proceeds=product(p.price,a.quantity),fee=Math.max(1,Math.ceil(proceeds/100));check(p.buybackCoins>=proceeds,'village_liquidity');
        var basis=a.quantity===p.playerShares?p.costBasis:p.costBasis*a.quantity/p.playerShares,profit=proceeds-fee-basis;
        p.playerShares-=a.quantity;p.npcShares+=a.quantity;p.costBasis=p.playerShares===0?0:p.costBasis-basis;p.buybackCoins-=proceeds;p.shareSales=sum(p.shareSales,proceeds);
        p.realizedProfit=moneySum(p.realizedProfit,profit);p.feesPaid=sum(p.feesPaid,fee);tx.coins=sum(tx.coins,proceeds-fee);tx.reward.realizedProfit=profit;tx.reward.fee=fee;
        record(e,'shares_sold',{shopId:spec.id,quantity:a.quantity,coins:proceeds-fee,profit:profit});
      } else if(a.type==='claimVillageBenefit'){
        check(p.pendingBenefit>0,'village_no_benefit');p.pendingBenefit--;p.claimedBenefits=sum(p.claimedBenefits,1);
        tx.inventory[spec.benefitItem]=sum(tx.inventory[spec.benefitItem]||0,1);record(e,'benefit',{shopId:spec.id,itemId:spec.benefitItem,quantity:1});
      }
    }
    e.lastActionAt=ms;validate({villageEconomy:e,coins:tx.coins,market:s.market});return tx;
  }
  function view(s,ms) {
    var e=get(s),ppl=people(e),totals={salesRevenue:e.salesRevenue,purchasesSpent:e.purchasesSpent,dividends:0,realizedProfit:0,feesPaid:0,currentValue:0,costBasis:0};
    var out={version:1,day:e.day,revision:s.revision,coins:s.coins,residents:ppl.residents,visitors:ppl.visitors,
      foods:FOODS.map(function(f){var x=clone(f);x.owned=s.inventory[f.id]||0;return x;}),
      listings:e.listings.map(function(l){var x=clone(l),f=food(l.itemId);x.name=f.name;x.emoji=f.emoji;return x;}),
      offers:e.offers.map(function(o){var x=clone(o),f=food(o.itemId),n=byId(VISITORS,o.npcId);x.name=o.shopId?shop(o.shopId).name:n.name;x.itemName=f.name;x.emoji=f.emoji;return x;}),
      shops:SHOPS.map(function(spec){var p=e.shops[spec.id],value=p.playerShares*p.price,maxBuy=0;
        if(p.status==='open')for(var q=1;q<=p.npcShares;q++){var gross=q*p.price;if(gross+Math.max(1,Math.ceil(gross/100))<=s.coins)maxBuy=q;else break;}
        totals.dividends+=p.dividends;totals.realizedProfit+=p.realizedProfit;totals.feesPaid+=p.feesPaid;totals.currentValue+=value;totals.costBasis+=p.costBasis;
        return {id:spec.id,name:spec.name,status:p.status,targetCapital:spec.totalShares*10,capitalRaised:p.capitalRaised,playerCapital:p.playerCapital,npcCapital:p.npcCapital,totalShares:spec.totalShares,
          playerShares:p.playerShares,npcShares:p.npcShares,sharePrice:10,remainingShares:spec.totalShares-p.playerShares-p.npcShares,canContribute:p.status==='funding',
          price:p.price,previousPrice:p.previousPrice,currentValue:value,costBasis:p.costBasis,unrealizedProfit:value-p.costBasis,realizedProfit:p.realizedProfit,
          dividends:p.dividends,profitReserve:p.profitReserve,revenue:p.revenue,costs:p.costs,buybackCoins:p.buybackCoins,
          maxSellQuantity:p.status==='open'?Math.min(p.playerShares,Math.floor(p.buybackCoins/p.price)):0,
          maxBuyQuantity:maxBuy,canBuyShares:p.status==='open'&&maxBuy>0,
          pendingBenefit:p.pendingBenefit,benefitItemName:food(spec.benefitItem).name,buildReadyDay:p.buildReadyDay};
      }),summary:totals,advance:ms<s.updatedAt?{canAdvance:false,waitMs:0,dailyRemaining:0,reason:'clock_moved_back'}:advanceInfo(e,ms),history:clone(e.history),
      rules:['ゲーム内のコインだけで遊べます。実際のお金は使いません。',
        '「村の一日を進める」で来村・売買が進みます。実時間60秒おき、JST一日12回まで。放置中は進みません。',
        '食品を好きな値段で出品。住民の予算や好みで、売れ残ることもあります。取り下げると残りが戻ります。',
        '住民と出資してお店を建てます。1株10コイン。満額で建設し、次のゲーム日に開店します。',
        '配当は3ゲーム日ごと、食品売上から仕入費を引いた利益の範囲内。出資元金は配当に使いません。',
        '2株以上の保有で食品優待の機会があります。利益がない日は配当・優待はありません。',
        '開店後はNPCが持つ株を時価で売買できます。売買手数料は1%、最低1コインです。',
        '株価は3〜30コインで変動。売却時に損益が出ます。NPCの買戻し予算は各店一日80コインです。']};
    return out;
  }
  return {commands:COMMANDS.slice(),handles:function(type){return COMMANDS.indexOf(type)>=0;},get:get,view:view,validate:validate,transition:transition,
    foods:clone(FOODS),shops:clone(SHOPS),limits:{waitMs:WAIT,advancesPerJstDay:DAILY,listings:8,listingQuantity:99,unitPrice:999,history:100}};
}));
