(function () {
  'use strict';
  var colors=['bg','paper','ink','muted','line','button','chip'];
  var defaults=['#f0eedf','#fdfcf6','#3d4b3c','#606b57','#d5d6c3','#607765','#eeeddf'];
  var fonts={gothic:'"Noto Sans JP",sans-serif',round:'"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Noto Sans JP",sans-serif',mincho:'"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',klee:'"Klee One",cursive',pop:'"Shippori Mincho",serif'};
  var chartFrame, variableColors=new WeakMap(), colorProbe, colorCanvas, lastBrandSource;
  function setToken(root,name,value) {
    if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);
  }
  function setDark(value) {
    if(document.body.getAttribute('data-kn-ledger-dark')!==value)document.body.setAttribute('data-kn-ledger-dark',value);
  }
  function brandSource() {
    var root=document.documentElement;
    return root.style.getPropertyValue('--brand-color')+'|'+root.getAttribute('data-custom-brand-color');
  }
  function canvasColor(value,fallback) {
    value=(value||'').trim();
    if(!value)return fallback;
    if(/^#[0-9a-f]{3,8}$/i.test(value)||/^rgba?\(/i.test(value))return value;
    // Computed custom properties may still contain color-mix(). Canvas needs a concrete colour.
    if(!colorProbe){colorProbe=document.createElement('span');colorProbe.hidden=true;document.body.appendChild(colorProbe);}
    colorProbe.style.color=value;
    var computed=getComputedStyle(colorProbe).color||'';
    if(/^#[0-9a-f]{3,8}$/i.test(computed)||/^rgba?\(/i.test(computed))return computed;
    try {
      if(!colorCanvas){colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=1;}
      var context=colorCanvas.getContext('2d');
      if(context&&context.getImageData&&computed){
        context.clearRect(0,0,1,1);context.fillStyle=computed;context.fillRect(0,0,1,1);
        var pixel=context.getImageData(0,0,1,1).data;
        return 'rgba('+pixel[0]+','+pixel[1]+','+pixel[2]+','+(pixel[3]/255)+')';
      }
    } catch(ignore) { /* Old canvas implementations retain a readable fallback. */ }
    return fallback;
  }
  function translucent(color,alpha) {
    var hex=color.match(/^#([0-9a-f]{6})$/i),rgb=color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if(hex)rgb=[null,parseInt(hex[1].slice(0,2),16),parseInt(hex[1].slice(2,4),16),parseInt(hex[1].slice(4,6),16)];
    return rgb?'rgba('+rgb[1]+','+rgb[2]+','+rgb[3]+','+alpha+')':color;
  }
  function luminance(color) {
    var hex=color.match(/^#([0-9a-f]{6})$/i),rgb=color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if(hex)rgb=[null,parseInt(hex[1].slice(0,2),16),parseInt(hex[1].slice(2,4),16),parseInt(hex[1].slice(4,6),16)];
    if(!rgb)return null;
    var values=rgb.slice(1,4).map(function(value){value=Number(value)/255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);});
    return .2126*values[0]+.7152*values[1]+.0722*values[2];
  }
  function contrastRatio(first,second) {
    var a=luminance(first),b=luminance(second);
    return a===null||b===null?0:(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  }
  function syncButtonForeground() {
    var style=getComputedStyle(document.body),button=canvasColor(style.getPropertyValue('--kn-ledger-button')||style.getPropertyValue('--kn-sh-button'),defaults[5]);
    function contrast(color){return contrastRatio(color,button);}
    var paper=canvasColor(style.getPropertyValue('--kn-sh-paper'),defaults[1]),ink=canvasColor(style.getPropertyValue('--kn-ledger-ink')||style.getPropertyValue('--kn-sh-ink'),defaults[2]);
    var foreground=contrast(paper)>=4.5?paper:contrast(ink)>=4.5?ink:contrast('#ffffff')>=contrast('#000000')?'#ffffff':'#000000';
    setToken(document.documentElement,'--kn-ledger-on-button',foreground);
    // Keep the shared palette intact; only ledger captions need a local readable fallback.
    var muted=canvasColor(style.getPropertyValue('--kn-sh-muted'),defaults[3]);
    setToken(document.body,'--kn-ledger-muted',contrastRatio(muted,paper)>=4.5?muted:ink);
  }
  function readingCharts(chart) {
    var style=getComputedStyle(document.body), scale=parseFloat(style.getPropertyValue('--kn-sh-scale'))||1;
    var roleMuted=canvasColor(style.getPropertyValue('--kn-sh-muted'),defaults[3]);
    var muted=canvasColor(style.getPropertyValue('--kn-ledger-muted')||style.getPropertyValue('--kn-sh-muted'),defaults[3]), line=canvasColor(style.getPropertyValue('--kn-sh-line'),defaults[4]);
    var numeric=(chart.canvas&&chart.canvas.id==='lineChart'&&chart.config.type==='line')||(chart.canvas&&chart.canvas.id==='barChart'&&chart.config.type==='bar');
    var paper=canvasColor(style.getPropertyValue('--kn-sh-paper'),defaults[1]),ink=canvasColor(style.getPropertyValue('--kn-ledger-ink')||style.getPropertyValue('--kn-sh-ink'),defaults[2]);
    var seriesColors=numeric?[
      canvasColor(style.getPropertyValue('--kn-ledger-button')||style.getPropertyValue('--kn-sh-button'),defaults[5]),
      roleMuted,
      ink
    ].map(function(color){return contrastRatio(color,paper)>=3?color:ink;}):[];
    var family=style.fontFamily, caption=parseFloat(style.getPropertyValue('--kn-type-caption'))||12, options=chart.options;
    if(options.plugins&&options.plugins.legend&&options.plugins.legend.labels) {
      var labels=options.plugins.legend.labels;
      labels.color=muted;labels.font={family:family,size:Math.max(11,caption*scale)};
    }
    Object.keys(options.scales||{}).forEach(function(key){
      var axis=options.scales[key];
      if(axis.ticks){axis.ticks.color=muted;axis.ticks.font={family:family,size:Math.max(11,caption*scale)};}
      if(axis.grid)axis.grid.color=line;
      if(axis.border)axis.border.color=line;
    });
    // Only the two fixed financial charts use role colours; category palettes retain their mapping.
    chart.data.datasets.forEach(function(dataset,index){
      if(numeric&&seriesColors[index]){
        var color=seriesColors[index];
        dataset.borderColor=dataset.pointBackgroundColor=dataset.pointBorderColor=color;
        dataset.backgroundColor=translucent(color,chart.config.type==='line'?.1:.75);
        dataset.pointHoverBackgroundColor=dataset.pointHoverBorderColor=color;
        if(chart.config.type==='line'&&index===1)dataset.borderDash=[4,3];
        return;
      }
      var original=variableColors.get(dataset)||{};
      ['borderColor','pointBackgroundColor'].forEach(function(key){
        if(dataset[key]==='var(--brand-color)')original[key]=true;
        if(original[key])dataset[key]=canvasColor(style.getPropertyValue('--kn-ledger-button')||style.getPropertyValue('--kn-sh-button'),defaults[5]);
      });
      variableColors.set(dataset,original);
      if(chart.config.type==='pie'||chart.config.type==='doughnut')
        dataset.borderColor=canvasColor(style.getPropertyValue('--kn-sh-paper'),defaults[1]);
    });
  }
  function syncCharts() {
    if(!window.Chart||!Chart.getChart)return;
    document.querySelectorAll('canvas').forEach(function(canvas){var chart=Chart.getChart(canvas);if(chart)chart.update('none');});
  }
  function scheduleCharts() {
    if(chartFrame)return;
    chartFrame=requestAnimationFrame(function(){chartFrame=0;syncCharts();});
  }
  function sync(brandOverride,customOverride) {
    var root=document.documentElement;
    lastBrandSource=brandSource();
    document.body.classList.add('kn-ledger-letter');
    try {
      if(window.parent!==window&&window.parent.location.origin===location.origin&&window.parent.document.body.classList.contains('kn-home-a')) {
        document.body.classList.add('kn-ledger-embedded');
        var style=window.parent.getComputedStyle(window.parent.document.documentElement);
        colors.forEach(function(name,index){setToken(root,'--kn-sh-'+name,style.getPropertyValue('--kn-sh-'+name).trim()||defaults[index]);});
        ['sans','serif'].forEach(function(name){
          var value=window.parent.getComputedStyle(window.parent.document.body).getPropertyValue('--kn-a-'+name).trim();
          if(value)setToken(root,'--kn-sh-'+name,value);
        });
        setToken(root,'--kn-sh-scale',window.parent.getComputedStyle(window.parent.document.body).getPropertyValue('--kn-a-scale').trim()||'1');
        setDark(String(window.parent.document.body.getAttribute('data-theme')==='dark'));
        syncButtonForeground();
        return;
      }
    } catch(ignore) { /* Standalone and different-origin pages use the local preference. */ }
    var color='',font='',size='m',customFlag='';try{color=localStorage.getItem('userBrandColor')||'';font=localStorage.getItem('ui_font')||'';size=localStorage.getItem('ui_fontscale')||'m';customFlag=localStorage.getItem('userBrandColorCustom')||'';}catch(ignore){}
    if(typeof brandOverride==='string'){color=brandOverride;customFlag=customOverride||'';}
    var custom=/^#[0-9a-f]{6}$/i.test(color)&&(color.toLowerCase()!=='#3da060'||customFlag==='1');
    var values=custom?[
      'color-mix(in srgb,'+color+' 10%,#f5f2e9)',defaults[1],
      'color-mix(in srgb,'+color+' 30%,#303c30)',
      'color-mix(in srgb,'+color+' 20%,#606b57)',
      'color-mix(in srgb,'+color+' 12%,#dedccf)',
      'color-mix(in srgb,'+color+' 45%,#4c6150)',
      'color-mix(in srgb,'+color+' 6%,#f0eedf)'
    ]:defaults;
    colors.forEach(function(name,index){setToken(root,'--kn-sh-'+name,values[index]);});
    setToken(root,'--kn-sh-sans',fonts[font]||'-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif');
    setToken(root,'--kn-sh-serif',fonts[font]||'"Hiragino Mincho ProN","Yu Mincho",Georgia,serif');
    setToken(root,'--kn-sh-scale',String(({s:.9,m:1,l:1.15,xl:1.3})[size]||1));
    setDark('false');
    syncButtonForeground();
  }
  sync();window.addEventListener('storage',sync);window.addEventListener('focus',sync);
  var registeredChart;
  function chartsReady(){
    if(!window.Chart||!Chart.register)return;
    if(registeredChart!==Chart){Chart.register({id:'knLedgerReading',beforeUpdate:readingCharts});registeredChart=Chart;}
    scheduleCharts();
  }
  window.addEventListener('kkChartsReady',chartsReady);
  chartsReady();
  new MutationObserver(function(){
    if(brandSource()!==lastBrandSource){
      var root=document.documentElement;
      sync(root.style.getPropertyValue('--brand-color').trim(),root.getAttribute('data-custom-brand-color')!==null?'1':'');
    }
    syncButtonForeground();
    scheduleCharts();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['style','data-custom-brand-color']});
  new MutationObserver(function(){syncButtonForeground();scheduleCharts();}).observe(document.body,{attributes:true,attributeFilter:['data-kn-ledger-dark']});
  syncCharts();
  if(document.fonts){document.fonts.ready.then(scheduleCharts);document.fonts.addEventListener('loadingdone',scheduleCharts);}
})();
