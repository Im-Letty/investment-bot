/* Shared metadata dates. Calendar cells keep their month/day layout. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.KNDateDisplay=factory();
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function pad(value){return String(value).padStart(2,'0');}
  function day(value){
    if(typeof value==='string'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
      var parsed=new Date(value+'T00:00:00Z');
      return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value.replace(/-/g,'/'):'';
    }
    var date=tokyo(value);
    return date?date.getUTCFullYear()+'/'+pad(date.getUTCMonth()+1)+'/'+pad(date.getUTCDate()):'';
  }
  function tokyo(value){
    if(typeof value!=='number'||!Number.isFinite(value))return null;
    var date=new Date(value*1000+9*3600000);
    return Number.isFinite(date.getTime())?date:null;
  }
  function timestamp(value){
    var date=tokyo(value);
    return date?day(value)+' '+pad(date.getUTCHours())+':'+pad(date.getUTCMinutes()):'';
  }
  function label(value,kind,withTime){
    var text=withTime?timestamp(value):day(value);
    return text?text+(kind?' '+kind:''):'';
  }
  function price(value,kind='株価'){
    var prefix=kind?String(kind)+' ':'';
    if(typeof value==='string'){
      var dateOnly=day(value);
      if(!dateOnly)return '';
      var parts=dateOnly.split('/');
      return prefix+Number(parts[1])+'/'+Number(parts[2]);
    }
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return '';
    var date=tokyo(value);
    return date?prefix+(date.getUTCMonth()+1)+'/'+date.getUTCDate()+' '+pad(date.getUTCHours())+':'+pad(date.getUTCMinutes())+' JST':'';
  }
  return Object.freeze({date:day,timestamp:timestamp,label:label,price:price});
});
