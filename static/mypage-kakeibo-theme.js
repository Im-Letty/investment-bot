(function () {
  'use strict';
  var colors=['bg','paper','ink','muted','line','button','chip'];
  var defaults=['#f0eedf','#fdfcf6','#3d4b3c','#606b57','#d5d6c3','#607765','#eeeddf'];
  var fonts={gothic:'"Noto Sans JP",sans-serif',round:'"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Noto Sans JP",sans-serif',mincho:'"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',klee:'"Klee One",cursive',pop:'"Shippori Mincho",serif'};
  var chartFrame, variableColors=new WeakMap();
  function readingCharts(chart) {
    var style=getComputedStyle(document.body), scale=parseFloat(style.getPropertyValue('--kn-sh-scale'))||1;
    var muted=style.getPropertyValue('--kn-sh-muted').trim(), line=style.getPropertyValue('--kn-sh-line').trim();
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
    // Canvas cannot resolve CSS variables. Resolve the existing presentation colours only.
    chart.data.datasets.forEach(function(dataset){
      var original=variableColors.get(dataset)||{};
      ['borderColor','pointBackgroundColor'].forEach(function(key){
        if(dataset[key]==='var(--brand-color)')original[key]=true;
        if(original[key])dataset[key]=style.getPropertyValue('--kn-ledger-income').trim();
      });
      variableColors.set(dataset,original);
      if(chart.config.type==='pie'||chart.config.type==='doughnut')
        dataset.borderColor=style.getPropertyValue('--kn-sh-paper').trim();
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
  function sync() {
    var root=document.documentElement;
    document.body.classList.add('kn-ledger-letter');
    try {
      if(window.parent!==window&&window.parent.location.origin===location.origin&&window.parent.document.body.classList.contains('kn-home-a')) {
        document.body.classList.add('kn-ledger-embedded');
        var style=window.parent.getComputedStyle(window.parent.document.documentElement);
        colors.forEach(function(name,index){root.style.setProperty('--kn-sh-'+name,style.getPropertyValue('--kn-sh-'+name).trim()||defaults[index]);});
        ['sans','serif'].forEach(function(name){
          var value=window.parent.getComputedStyle(window.parent.document.body).getPropertyValue('--kn-a-'+name).trim();
          if(value)root.style.setProperty('--kn-sh-'+name,value);
        });
        root.style.setProperty('--kn-sh-scale',window.parent.getComputedStyle(window.parent.document.body).getPropertyValue('--kn-a-scale').trim()||'1');
        document.body.setAttribute('data-kn-ledger-dark',String(window.parent.document.body.getAttribute('data-theme')==='dark'));
        return;
      }
    } catch(ignore) { /* Standalone and different-origin pages use the local preference. */ }
    var color='',font='',size='m',customFlag='';try{color=localStorage.getItem('userBrandColor')||'';font=localStorage.getItem('ui_font')||'';size=localStorage.getItem('ui_fontscale')||'m';customFlag=localStorage.getItem('userBrandColorCustom')||'';}catch(ignore){}
    var custom=/^#[0-9a-f]{6}$/i.test(color)&&(color.toLowerCase()!=='#3da060'||customFlag==='1');
    var values=custom?[
      'color-mix(in srgb,'+color+' 10%,#f5f2e9)',defaults[1],
      'color-mix(in srgb,'+color+' 30%,#303c30)',
      'color-mix(in srgb,'+color+' 20%,#606b57)',
      'color-mix(in srgb,'+color+' 12%,#dedccf)',
      'color-mix(in srgb,'+color+' 45%,#4c6150)',
      'color-mix(in srgb,'+color+' 6%,#f0eedf)'
    ]:defaults;
    colors.forEach(function(name,index){root.style.setProperty('--kn-sh-'+name,values[index]);});
    root.style.setProperty('--kn-sh-sans',fonts[font]||'-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif');
    root.style.setProperty('--kn-sh-serif',fonts[font]||'"Hiragino Mincho ProN","Yu Mincho",Georgia,serif');
    root.style.setProperty('--kn-sh-scale',String(({s:.9,m:1,l:1.15,xl:1.3})[size]||1));
    document.body.setAttribute('data-kn-ledger-dark','false');
  }
  sync();window.addEventListener('storage',sync);window.addEventListener('focus',sync);
  if(window.Chart&&Chart.register)Chart.register({id:'knLedgerReading',beforeUpdate:readingCharts});
  new MutationObserver(scheduleCharts).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  new MutationObserver(scheduleCharts).observe(document.body,{attributes:true,attributeFilter:['data-kn-ledger-dark']});
  syncCharts();
  if(document.fonts){document.fonts.ready.then(scheduleCharts);document.fonts.addEventListener('loadingdone',scheduleCharts);}
})();
