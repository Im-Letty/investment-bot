(function () {
  'use strict';
  var colors=['bg','paper','ink','muted','line','button','chip'];
  var defaults=['#f0eedf','#fdfcf6','#3d4b3c','#606b57','#d5d6c3','#607765','#eeeddf'];
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
        document.body.setAttribute('data-kn-ledger-dark',String(window.parent.document.body.getAttribute('data-theme')==='dark'));
        return;
      }
    } catch(ignore) { /* Standalone and different-origin pages use the local preference. */ }
    var color='';try{color=localStorage.getItem('userBrandColor')||'';}catch(ignore){}
    var custom=/^#[0-9a-f]{6}$/i.test(color)&&color.toLowerCase()!=='#3da060';
    var values=custom?[
      'color-mix(in srgb,'+color+' 10%,#f5f2e9)',defaults[1],
      'color-mix(in srgb,'+color+' 30%,#303c30)',
      'color-mix(in srgb,'+color+' 20%,#606b57)',
      'color-mix(in srgb,'+color+' 12%,#dedccf)',
      'color-mix(in srgb,'+color+' 45%,#4c6150)',
      'color-mix(in srgb,'+color+' 6%,#f0eedf)'
    ]:defaults;
    colors.forEach(function(name,index){root.style.setProperty('--kn-sh-'+name,values[index]);});
    document.body.setAttribute('data-kn-ledger-dark','false');
  }
  sync();window.addEventListener('storage',sync);window.addEventListener('focus',sync);
})();
