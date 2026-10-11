/* Keep simulator surfaces neutral; share the morning letter's selected accent. */
(function () {
  'use strict';
  var names = ['bg', 'paper', 'ink', 'muted', 'line', 'button', 'chip'];
  var defaults = {bg:'#f6f5f1',paper:'#fffefb',ink:'#303638',muted:'#626966',line:'#dbded9',button:'#607765',chip:'#eeeee8'};
  var palette, signature = '', timer;
  var probe = document.createElement('span');
  probe.hidden = true;
  document.body.appendChild(probe);
  var pixel = document.createElement('canvas');
  pixel.width = pixel.height = 1;
  var ctx = pixel.getContext('2d', {willReadFrequently:true});
  function normalize(value, fallback) {
    if (!value || !CSS.supports('color', value)) return fallback;
    probe.style.color = value;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    var rgb = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + Array.from(rgb).slice(0,3).map(function(v){return v.toString(16).padStart(2,'0');}).join('');
  }
  function rgb(hex) {return [1,3,5].map(function(i){return parseInt(hex.slice(i,i+2),16);});}
  function mix(color, base, weight) {
    var a=rgb(color), b=rgb(base);
    return '#'+a.map(function(v,i){return Math.round(v*weight+b[i]*(1-weight)).toString(16).padStart(2,'0');}).join('');
  }
  function alpha(color, opacity) {return 'rgba('+rgb(color).join(',')+','+opacity+')';}
  function luminance(color) {
    var v=rgb(color).map(function(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
    return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
  }
  function contrast(a,b) {var x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
  function fallbackPalette() {
    var result=Object.assign({},defaults), brand, custom;
    try {brand=localStorage.getItem('userBrandColor');custom=localStorage.getItem('userBrandColorCustom')==='1'||(brand&&brand!=='#3da060');} catch (_) {}
    if(custom && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand||'')) {
      brand=normalize(brand,'#3da060');
      result.button=mix(brand,'#4c6150',.45);
    }
    return result;
  }
  function readPalette() {
    var result=fallbackPalette();
    try {
      if(window.parent!==window && window.parent.location.origin===location.origin) {
        var source=window.parent.document.getElementById('morning-section');
        if(source && window.parent.document.body.classList.contains('kn-home-a')) {
          var style=window.parent.getComputedStyle(source);
          result.button=normalize(style.getPropertyValue('--kn-a-button').trim(),result.button);
        }
      }
    } catch (_) {}
    // A very light selected color still needs a visible control/chart outline.
    for(var step=0;contrast(result.button,result.paper)<3.5 && step<12;step++)
      result.button=mix(result.button,'#303638',.85);
    result.onButton=contrast(result.button,result.paper)>contrast(result.button,result.ink)?result.paper:result.ink;
    if(contrast(result.button,result.onButton)<4.5) result.onButton=contrast(result.button,'#000000')>contrast(result.button,'#ffffff')?'#000000':'#ffffff';
    result.chartBg=result.paper;
    result.chartMain=result.button;
    result.chartPrincipal='#7b8580';
    return result;
  }
  function applyChart(chart) {
    if(!chart || !palette) return;
    chart.data.datasets.forEach(function(ds,index){
      var principal=index===0;
      ds.borderColor=principal?palette.chartPrincipal:palette.chartMain;
      ds.backgroundColor=alpha(principal?palette.chartPrincipal:palette.chartMain,principal ? 0.01 : 0.07);
      ds.borderDash=principal?[5,4]:[];
    });
    var plugins=chart.options.plugins;
    if(plugins.legend && plugins.legend.labels) plugins.legend.labels.color=palette.muted;
    if(plugins.tooltip) Object.assign(plugins.tooltip,{backgroundColor:palette.paper,titleColor:palette.ink,bodyColor:palette.ink,borderColor:palette.line});
    Object.keys(chart.options.scales||{}).forEach(function(k){
      var scale=chart.options.scales[k];
      if(scale.ticks) scale.ticks.color=palette.muted;
      if(scale.grid) scale.grid.color=alpha(palette.line,.65);
    });
    chart.update('none');
  }
  function sync() {
    var next=readPalette(), nextSignature=JSON.stringify(next);
    if(signature===nextSignature) return;
    palette=next;signature=nextSignature;
    names.forEach(function(k){document.documentElement.style.setProperty('--sim-'+k,palette[k]);});
    document.documentElement.style.setProperty('--sim-on-button',palette.onButton);
    document.documentElement.style.setProperty('--sim-chart-bg',palette.chartBg);
    window.__coinRGB=rgb(palette.ink).join(',');
    if(window.Chart) {
      Chart.defaults.color=palette.muted;
      document.querySelectorAll('.chart-wrap canvas').forEach(function(canvas){applyChart(Chart.getChart(canvas));});
    }
  }
  function schedule() {clearTimeout(timer);timer=setTimeout(sync,0);}
  window.KNSimulatorTheme={applyChart:applyChart};
  sync();
  try {
    if(window.parent!==window && window.parent.location.origin===location.origin) {
      var observer=new MutationObserver(schedule), parentDocument=window.parent.document;
      observer.observe(parentDocument.documentElement,{attributes:true,attributeFilter:['style','class','data-custom-brand-color']});
      observer.observe(parentDocument.body,{attributes:true,attributeFilter:['class','style','data-theme','data-kn-a-custom-color']});
      window.addEventListener('pagehide',function(){observer.disconnect();});
      window.addEventListener('pageshow',function(){
        observer.observe(parentDocument.documentElement,{attributes:true,attributeFilter:['style','class','data-custom-brand-color']});
        observer.observe(parentDocument.body,{attributes:true,attributeFilter:['class','style','data-theme','data-kn-a-custom-color']});
        schedule();
      });
    }
  } catch (_) {}
  window.addEventListener('storage',function(e){if(!e.key||e.key==='userBrandColor'||e.key==='userBrandColorCustom')schedule();});
  window.addEventListener('focus',schedule);
  document.addEventListener('visibilitychange',schedule);
  // Cover delayed home initialization without a permanent polling timer.
  [100,500,1500].forEach(function(delay){setTimeout(schedule,delay);});
})();
