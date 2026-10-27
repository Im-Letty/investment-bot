/* Shared Talk and company-scoped voices keep their existing conversation stores. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = {create:factory};
  if (root && root.document) {
    var community = factory(root);
    root.openCommunity = community.open;
    root.closeCommunity = community.close;
    root.cmSend = community.send;
    root.cmCount = community.count;
    root.KNCommunity = community;
    root.knCreateConversation = factory;
  }
})(typeof window === 'undefined' ? null : window, function (w, config) {
  config=config||{};
  'use strict';
  var doc=w.document, state=null, sequence=0, replyDrafts=Object.create(null);
  var categories=config.categories||[['all','みんな'],['economy','経済'],['news','ニュース'],['life','暮らしのお金'],['learn','学び'],['chat','雑談']];
  var languages=[['ja','日本語'],['en','English'],['ko','한국어'],['zh','中文'],['other','その他']];
  var reasons=[['spam','広告・勧誘'],['abuse','攻撃的な投稿'],['privacy','個人情報'],['misinformation','誤った情報'],['other','その他']];
  var draftKey=config.stock?'kn_stock_talk_drafts_v1':'kn_community_drafts_v1',retryKey=config.stock?'kn_stock_talk_requests_v1':'kn_community_requests_v1';
  var english={
    'トーク':'Talk','みんなの銘柄':'Stock Talk','みんなの銘柄トーク':'Stock Talk','銘柄トーク':'Stock Talk','みんなのトーク':'Everyone’s Talk','みんなの声':'Community voices','トークの画面':'Talk views',
    '検索':'Search','会社名・銘柄コード':'Company name or stock code','投稿・返信を検索':'Search posts and replies','この銘柄の投稿・返信を検索':'Search this stock’s posts and replies',
    '投稿と返信から、関連する言葉を探せます。':'Find matching words in posts and replies.','返信の続きを見る':'Read the replies','検索は80文字以内にしてください。':'Keep your search within 80 characters.',
    '一致する投稿はありません。':'No posts or replies match your search.',
    'コミュニティ':'Community','みんな':'All topics','経済':'Economy','ニュース':'News','暮らしのお金':'Everyday money','学び':'Learning','雑談':'Conversation',
    '経済やニュース、暮らしのお金を気軽に話そう。':'Share thoughts about the economy, news and everyday money.',
    'この会社について、気軽に話そう。':'Share your thoughts about this company.',
    '会社情報に戻る':'Back to company information',
    '気になることを、自由につぶやこう。':'What’s on your mind?',
    '投稿を受け付けられませんでした。内容を残しています。':'We could not accept your post. Your draft is kept.',
    '投稿する銘柄を選んでください。':'Choose a stock for your post.',
    '話題や順番を決めず、気になることから交流できます。投稿は個人の意見です。相手を尊重し、気になる投稿は「…」から通報してください。日時は日本時間（JST）です。':'Start with whatever is on your mind. Posts are personal opinions. Respect others and use “…” to report a concern. Dates and times are in Japan Standard Time (JST).',
    '銘柄ごとの会話を読む':'Read stock conversations','いまの下書き':'Current draft','以前の下書き':'Earlier draft',
    'つぶやく':'Write a post','つぶやき':'Your post','ニックネーム':'Display name','投稿する話題':'Topic','投稿の言語':'Post language',
    '変更':'Change','保存':'Save','ニックネーム（20文字まで）':'Display name (up to 20 characters)',
    '経済ニュース共通のニックネーム':'Economic News display name','経済ニュース共通のニックネーム（20文字まで）':'Economic News display name (up to 20 characters)',
    '一度保存すると、同じブラウザで共通して使えます。':'Save once to use this name throughout Economic News in this browser.',
    'ニックネームを入力してください。':'Enter a display name.','ニックネームは20文字以内にしてください。':'Keep your display name within 20 characters.',
    'この端末に保存しました。':'Saved on this device.','この端末に保存できませんでした。入力した名前は残しています。':'Could not save on this device. Your entered name is kept.',
    '前回と同じニックネームで再送します。':'Retrying with the same display name as the previous attempt.',
    '投稿する':'Post','投稿を読み込み中…':'Loading posts…','まだ投稿はありません。':'No posts yet.','最初のひとことを、気軽にどうぞ。':'You can start the conversation.',
    'もっと見る':'Show more','読み込み中…':'Loading…','新しい投稿があります':'New posts are available','新しい投稿を表示しました。':'New posts are now displayed.',
    'いいね':'Like','いいね済み':'Liked','返信':'Reply','返信する':'Reply','投稿':'Posted','通報':'Report','削除':'Delete','投稿の操作':'Post options',
    '朝レターに戻る':'Back to the morning letter','コミュニティを閉じて朝レターへ戻る':'Close community and return to the morning letter',
    'この投稿を通報する':'Report this post','自分の投稿を削除する':'Delete my post','いいねを取り消す':'Remove like','この投稿にいいねする':'Like this post','返信を読む・書く':'Read and write replies',
    '話題のジャンル':'Topics','コミュニティの投稿':'Community posts','もう一度読む':'Try again','返信を読み込み中…':'Loading replies…','返信をもっと見る':'More replies','まだ返信はありません。':'No replies yet.',
    'この場所の使い方':'How this community works','個人情報や、利益を保証する勧誘は書き込まないでください。':'Do not share personal details or promises of guaranteed returns.',
    '株の話だけでなく、経済や日々のお金について交流できます。投稿は個人の意見です。相手を尊重し、気になる投稿は「…」から通報してください。日時は日本時間（JST）です。':'Discuss the economy and everyday money as well as investing. Posts are personal opinions. Respect others and use “…” to report a concern. Dates and times are in Japan Standard Time (JST).',
    'ただいま準備中です。しばらくしてからもう一度お試しください。':'This community is being prepared. Please try again later.',
    'ログインを確認できませんでした。ログインしてからもう一度お試しください。':'We could not verify your login. Sign in and try again.',
    'ログインを確認できませんでした。しばらくしてからもう一度お試しください。':'We could not verify your login. Please try again shortly.',
    'ログインを確認できませんでした。もう一度お試しください。':'We could not verify your login. Please try again.',
    '投稿や返信にはログインが必要です。':'Sign in to post or reply.','少し時間を置いてからお試しください。':'Please wait a moment before trying again.',
    '投稿する内容を入力してください。':'Write something before posting.','投稿は200文字以内にしてください。':'Keep your post within 200 characters.','投稿するジャンルを選んでください。':'Choose a topic for your post.',
    'この投稿は表示できなくなりました。':'This post is no longer available.','この操作はご本人の投稿で行ってください。':'This action is only available for your own posts.',
    '通信を確認できませんでした。内容を残しています。もう一度お試しください。':'We could not connect. Your draft is kept; please try again.',
    '新しい投稿の確認ができませんでした。表示中の投稿はそのまま読めます。':'We could not check for new posts. You can still read the posts already shown.',
    '返信しました。':'Reply posted.','投稿しました。':'Post published.','通報を受け付けました。':'Report received.','投稿を削除しました。':'Post deleted.',
    '投稿を通報':'Report a post','気になる点を選んでください。通報内容は投稿の一覧には表示されません。':'Choose your concern. Reports are not shown in the public feed.',
    '投稿を削除':'Delete a post','この投稿を削除します。削除した投稿は元に戻せません。':'Delete this post? This cannot be undone.',
    '通報する':'Send report','削除する':'Delete','やめる':'Cancel','確認する':'Confirm','通報の理由':'Report reason',
    '広告・勧誘':'Spam or solicitation','攻撃的な投稿':'Abusive content','個人情報':'Personal information','誤った情報':'Misinformation','その他':'Other',
    'これまでの会話':'Earlier conversations','これまでの会話を読み込み中…':'Loading earlier conversations…','これまでの会話はまだありません。':'No earlier conversations are available.',
    '過去の会話を読む':'Read earlier conversations','過去の会話です。現在の投稿とは分けて表示しています。':'These earlier conversations are separate from the current posts.',
    '日時不明':'Date unavailable','名無しさん':'Anonymous'
  };
  function lang() {var value=(doc.documentElement&&doc.documentElement.lang)||w.currentLang||stored('app_lang','ja');return /^ja(?:-|$)/i.test(value)?'ja':'en';}
  function t(value) {return lang()==='ja'?value:(english[value]||value);}
  function el(tag, cls, text) {var node=doc.createElement(tag);if(cls)node.className=cls;if(text!=null){var plain=cls==='cw-author'||cls==='cw-post-body'||cls==='cw-avatar'||cls==='cw-preview-name'||cls==='cw-preview-body';node.textContent=plain?text:t(text);if(!plain&&english[text])node.dataset.cwCopy=text;}return node;}
  function fieldLabel(text) {var node=el('label','cw-field-label');node.appendChild(el('span','cw-field-copy',text));return node;}
  function button(cls,text,label,fn) {var node=el('button',cls),copy=el('span','cw-button-copy',text);node.appendChild(copy);node.type='button';if(label){node.setAttribute('aria-label',t(label));node.dataset.cwLabel=label;}if(fn)node.addEventListener('click',fn);return node;}
  function chars(value) {return Array.from(String(value||'')).length;}
  function title(code) {var found=categories.find(function(item){return item[0]===code;});return found?found[1]:'みんな';}
  function stored(key,fallback) {try {return w.localStorage.getItem(key)||fallback;}catch(_){return fallback;}}
  function save(key,value) {try {w.localStorage.setItem(key,value);}catch(_) {}}
  function profileAccount(){return w.KNUserProfile?String(w.knUser&&w.knUser.id||''):null;}
  function profileAccountUnchanged(expected){return profileAccount()===expected||(expected===''&&w.knUser&&w.knUser.is_anonymous===true);}
  function savedNickname(fallback) {if(w.KNUserProfile&&typeof w.KNUserProfile.username==='function')return w.KNUserProfile.username();try {return Array.from((w.localStorage.getItem('cm_nick')||'').trim()).slice(0,20).join('');}catch(_){return fallback||'';}}
  function drafts() {try {var value=JSON.parse(stored(draftKey,'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(_){return {};}}
  function current() {return state&&state.root.isConnected!==false;}
  function prepare() {if(w.knPrepareTalkScreen)w.knPrepareTalkScreen();}
  function uuid() {
    if(w.crypto&&typeof w.crypto.randomUUID==='function')return w.crypto.randomUUID();
    var bytes=new Uint8Array(16);if(w.crypto&&w.crypto.getRandomValues)w.crypto.getRandomValues(bytes);else for(var i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    return Array.from(bytes).map(function(value,index){return (index===4||index===6||index===8||index===10?'-':'')+value.toString(16).padStart(2,'0');}).join('');
  }
  function date(value,kind) {
    var ms=Date.parse(value);if(!Number.isFinite(ms))return '日時不明';
    if(w.KNDateDisplay)return w.KNDateDisplay.label(ms/1000,t(kind||'投稿'),true);
    var d=new Date(ms+9*3600000),pad=function(n){return String(n).padStart(2,'0');};
    return d.getUTCFullYear()+'/'+pad(d.getUTCMonth()+1)+'/'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+' '+t(kind||'投稿');
  }
  function errorText(error) {
    var reason=error&&error.reason;
    if(reason==='storage_unavailable'||reason==='schema_unavailable'||reason==='not_configured')return 'ただいま準備中です。しばらくしてからもう一度お試しください。';
    if(reason==='auth_required'||reason==='auth_unavailable')return '通信を確認できませんでした。もう一度お試しください。';
    if(reason==='rate_limited')return '少し時間を置いてからお試しください。';
    if(reason==='empty')return '投稿する内容を入力してください。';
    if(reason==='too_long')return '投稿は200文字以内にしてください。';
    if(reason==='invalid_category')return config.stock?'投稿する銘柄を選んでください。':'投稿を受け付けられませんでした。内容を残しています。';
    if(reason==='not_found')return 'この投稿は表示できなくなりました。';
    if(reason==='forbidden')return 'この操作はご本人の投稿で行ってください。';
    return '通信を確認できませんでした。内容を残しています。もう一度お試しください。';
  }
  function message(text,bad) {if(!current())return;state.notice.textContent=t(text||'');state.notice.classList.toggle('cw-error',!!bad);}
  function persist() {
    if(!current())return;
    var collection=drafts();collection[state.legacyDraft||state.category]={body:state.input.value,category:state.categoryInput.value,language:state.languageInput.value};
    save(draftKey,JSON.stringify(collection));save(retryKey,JSON.stringify(state.retries));
  }
  // Reply drafts belong to this page's conversation instance and topic only.
  // Keep them across the two Talk views without persisting them or the feed.
  function rememberReplies(s) {
    Object.keys(s.replies).forEach(function(id){
      var model=s.replies[id],value=model.draft||'',key=s.category+'|'+id;
      if(value)replyDrafts[key]=value;else delete replyDrafts[key];
    });
  }
  function cancelReads(s) {s.readControllers.forEach(function(controller){controller.abort();});s.readControllers.clear();}
  function cancelRequests(s) {s.controllers.forEach(function(controller){controller.abort();});s.controllers.clear();}
  function request(path,options,s) {
    if(config.stock)path=path.replace('/api/community/','/api/stock-talk/');
    s=s||state;if(!s)return Promise.reject({reason:'closed'});
    var controller=new w.AbortController();s.controllers.add(controller);
    options=Object.assign({cache:'no-store'},options||{},{signal:controller.signal});
    if(!options.method||options.method==='GET')s.readControllers.add(controller);
    var optionalAuth=(!options.method||options.method==='GET')&&w.sb&&w.sb.auth&&w.sb.auth.getSession?Promise.resolve().then(function(){return w.sb.auth.getSession();}).then(function(result){var session=result&&result.data&&result.data.session;if(session&&session.access_token)options.headers=Object.assign({},options.headers,{'Authorization':'Bearer '+session.access_token});}).catch(function(){}):Promise.resolve();
    function fetchResult(){return w.fetch(path,options).then(function(response){return response.json().then(function(data){
      if(!response.ok||!data||!data.ok)throw {reason:data&&data.reason||'network_error',status:response.status};return data;
    });});}
    return optionalAuth.then(fetchResult).catch(function(error){
      if((!options.method||options.method==='GET')&&error.reason==='auth_required'&&options.headers&&options.headers.Authorization){options.headers=Object.assign({},options.headers);delete options.headers.Authorization;return fetchResult();}throw error;
    }).finally(function(){s.controllers.delete(controller);s.readControllers.delete(controller);});
  }
  function alive(s,epoch) {return state===s&&current()&&(epoch==null||s.epoch===epoch);}
  async function token(s) {
    if(w.knEnsureGuest){try{var guest=await w.knEnsureGuest();return guest.access_token;}catch(_){if(alive(s))message('通信を確認できませんでした。もう一度お試しください。',true);return null;}}
    if(w.knRequireAuth&&!w.knRequireAuth())return null;
    if(!w.sb||!w.sb.auth||!w.sb.auth.getSession){if(alive(s))message('ログインを確認できませんでした。しばらくしてからもう一度お試しください。',true);return null;}
    try {var result=await w.sb.auth.getSession(),session=result&&result.data&&result.data.session;
      if(result.error||!session||!session.access_token){if(w.openAuth)w.openAuth('login');if(alive(s))message('投稿や返信にはログインが必要です。',true);return null;}
      return session.access_token;
    } catch(_) {if(alive(s))message('ログインを確認できませんでした。もう一度お試しください。',true);return null;}
  }
  function jsonOptions(method,value,access) {var options={method:method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+access}};if(value!=null)options.body=JSON.stringify(value);return options;}
  function scrollCapture(s) {
    var first=Array.from(s.feed.children).find(function(node){return node.dataset.postId&&node.getBoundingClientRect().bottom>=s.scroller.getBoundingClientRect().top;});
    return {top:s.scroller.scrollTop,id:first&&first.dataset.postId,offset:first&&first.getBoundingClientRect().top};
  }
  function restoreScroll(s,snapshot) {
    var match=snapshot.id&&Array.from(s.feed.children).find(function(node){return node.dataset.postId===snapshot.id;});
    s.scroller.scrollTop=match&&Number.isFinite(snapshot.offset)?snapshot.top+match.getBoundingClientRect().top-snapshot.offset:snapshot.top;
  }
  function focusSnapshot(s) {
    var active=doc.activeElement;if(!active||!s.feed.contains(active)||!active.dataset.field)return null;
    return {field:active.dataset.field,start:active.selectionStart,end:active.selectionEnd};
  }
  function restoreFocus(s,snapshot) {if(!snapshot)return;var node=Array.from(s.feed.querySelectorAll('[data-field]')).find(function(item){return item.dataset.field===snapshot.field;});if(node){node.focus({preventScroll:true});if(typeof node.setSelectionRange==='function')node.setSelectionRange(snapshot.start,snapshot.end);}}
  function safeCount(value) {return Number.isFinite(Number(value))?Math.max(0,Number(value)):0;}
  function postNode(post,reply) {
    var s=state,article=el('article',reply?'cw-reply-post':'cw-post');article.dataset.postId=String(post.id);
    var head=el('div','cw-post-head'),name=el('span','cw-author',post.name||'名無しさん'),avatar=el('span','cw-avatar',Array.from(post.name||'名無しさん')[0]);avatar.setAttribute('aria-hidden','true');head.appendChild(avatar);head.appendChild(name);head.appendChild(el('span','cw-post-date',date(post.created_at,reply?'返信':'投稿')));
    var menu=el('details','cw-post-menu'),summary=el('summary','cw-menu-trigger','…');summary.setAttribute('aria-label','投稿の操作');menu.appendChild(summary);
    var menuBody=el('div','cw-menu-body');
    menuBody.appendChild(button('cw-menu-item','通報','この投稿を通報する',function(){menu.open=false;report(post);}));
    if(post.is_mine===true)menuBody.appendChild(button('cw-menu-item cw-delete','削除','自分の投稿を削除する',function(){menu.open=false;remove(post);}));
    menu.appendChild(menuBody);head.appendChild(menu);article.appendChild(head);
    article.appendChild(el('p','cw-post-body',post.body||''));
    var actions=el('div','cw-post-actions'),like=button('cw-like',post.liked_by_me?'いいね済み':'いいね',post.liked_by_me?'いいねを取り消す':'この投稿にいいねする',function(){toggleLike(post);});
    like.setAttribute('aria-pressed',String(!!post.liked_by_me));like.disabled=s.pending.has('like:'+post.id);like.appendChild(el('span','cw-action-count',String(safeCount(post.like_count))));actions.appendChild(like);
    if(!reply){var replyButton=button('cw-reply-toggle','返信','返信を読む・書く',function(){toggleReplies(post);});replyButton.appendChild(el('span','cw-action-count',String(safeCount(post.reply_count))));replyButton.setAttribute('aria-expanded',String(!!(s.replies[post.id]&&s.replies[post.id].open)));actions.appendChild(replyButton);}
    article.appendChild(actions);
    if(!reply&&s.replies[post.id]&&s.replies[post.id].open)article.appendChild(replyNode(post,s.replies[post.id]));
    else if(!reply&&post.reply_preview&&String(post.reply_preview.parent_id)===String(post.id)){
      var preview=post.reply_preview,excerpt=button('cw-reply-preview',null,'返信の続きを見る',function(){toggleReplies(post);});excerpt.replaceChildren();excerpt.appendChild(el('span','cw-preview-name',preview.name||'名無しさん'));excerpt.appendChild(el('span','cw-preview-body',preview.body||''));article.appendChild(excerpt);
    }
    return article;
  }
  function render() {
    if(!current())return;var s=state,snapshot=scrollCapture(s),focused=focusSnapshot(s);s.feed.replaceChildren();
    var shown=s.posts;
    shown.forEach(function(post){s.feed.appendChild(postNode(post,false));});
    s.empty.hidden=!!s.searchTerm||s.posts.length>0||s.loading||!!s.loadError;
    if(s.searchEmpty)s.searchEmpty.hidden=!s.searchTerm||!!shown.length||s.loading||!!s.loadError;
    s.loadingNode.hidden=!s.loading;s.failure.hidden=!s.loadError;s.failureCopy.textContent=s.loadError?t(errorText(s.loadError)):'';
    s.more.hidden=!s.hasMore||s.loading;s.more.disabled=s.paging;s.more.querySelector('.cw-button-copy').textContent=t(s.paging?'読み込み中…':'もっと見る');
    s.newButton.hidden=!s.newPosts;
    restoreScroll(s,snapshot);restoreFocus(s,focused);
  }
  function applyPage(data,append) {
    var s=state,rows=Array.isArray(data.posts)?data.posts:[];
    if(append){var seen=new Set(s.posts.map(function(post){return String(post.id);}));rows.forEach(function(post){if(!seen.has(String(post.id))){s.posts.push(post);seen.add(String(post.id));}});}
    else s.posts=rows;
    s.hasMore=!!data.has_more;s.cursor=data.next_cursor;s.loading=false;s.paging=false;s.loadError=null;s.newPosts=null;render();
  }
  function flushRefreshes(s,epoch) {
    if(!alive(s,epoch)||s.pending.size)return;
    if(s.searchQueued){s.searchQueued=false;if(searchNow(s))return;}
    if(s.feedRefresh){var append=s.feedRefresh==='append';s.feedRefresh=null;load(append);}
    s.posts.forEach(function(post){var model=s.replies[post.id];if(model&&model.refresh&&!model.loading){model.refresh=false;loadReplies(post,false);}});
  }
  function feedPath(s) {return '/api/community/posts?category='+encodeURIComponent(s.category)+'&limit=20'+(s.searchTerm?'&q='+encodeURIComponent(s.searchTerm):'');}
  function searchNow(s) {
    if(!alive(s))return;if(s.searchTimer){w.clearTimeout(s.searchTimer);s.searchTimer=null;}
    if(s.pending.size){s.searchQueued=true;return true;}
    var query=String(s.searchInput.value||'').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
    if(chars(query)>80){message('検索は80文字以内にしてください。',true);return false;}
    if(query===s.searchTerm)return false;
    var archivePending=s.archiveLoading;rememberReplies(s);cancelReads(s);s.archiveLoading=false;s.epoch++;s.searchTerm=query;s.posts=[];s.replies={};s.loading=false;s.paging=false;s.polling=false;s.loadError=null;s.hasMore=false;s.cursor=null;s.newPosts=null;s.feedRefresh=null;s.restoreTop=0;message('');load(false);if(archivePending&&s.archive.open)loadArchive();return true;
  }
  async function load(append) {
    if(!current())return;var s=state,epoch=s.epoch,writeVersion=s.writes;if(s.loading||s.paging)return;
    if(append)s.paging=true;else s.loading=true;render();
    var path=feedPath(s);if(append&&s.cursor!=null)path+='&before='+encodeURIComponent(s.cursor);
    try {var data=await request(path,null,s);if(!alive(s,epoch))return;
      if(s.writes!==writeVersion){s.loading=false;s.paging=false;s.feedRefresh=append?'append':'replace';render();flushRefreshes(s,epoch);return;}
      applyPage(data,append);if(!append&&s.restoreTop!=null){s.scroller.scrollTop=s.restoreTop;s.restoreTop=null;}}
    catch(error){if(!alive(s,epoch)||error.name==='AbortError')return;s.loading=false;s.paging=false;s.loadError=error;render();}
  }
  async function poll() {
    if(!current()||doc.hidden||state.loading||state.paging||state.polling||state.pending.size)return;
    var s=state,epoch=s.epoch,writeVersion=s.writes;s.polling=true;
    try {var data=await request(feedPath(s),null,s);if(!alive(s,epoch)||s.writes!==writeVersion)return;
      var known=new Set(s.posts.map(function(post){return String(post.id);})),rows=Array.isArray(data.posts)?data.posts:[];
      var refreshReplies=[],byId=new Map(rows.map(function(post){return [String(post.id),post];})),headFloor=rows.length?Math.min.apply(null,rows.map(function(post){return Number(post.id);})):Infinity;
      s.posts=s.posts.filter(function(post){return byId.has(String(post.id))||data.has_more&&Number(post.id)<headFloor;}).map(function(post){var update=byId.get(String(post.id));if(update){var model=s.replies[post.id];if(model&&model.open&&safeCount(update.reply_count)!==safeCount(post.reply_count))refreshReplies.push(post);Object.assign(post,update);}return post;});
      if(rows.some(function(post){return !known.has(String(post.id));}))s.newPosts=data;
      else s.newPosts=null;
      render();refreshReplies.forEach(function(post){loadReplies(post,false);});
    } catch(error){if(alive(s,epoch)&&error.name!=='AbortError')message('新しい投稿の確認ができませんでした。表示中の投稿はそのまま読めます。',true);}
    finally{if(alive(s,epoch))s.polling=false;}
  }
  function switchCategory(category) {
    if(!current()||category===state.category)return;var s=state;persist();rememberReplies(s);s.positions[s.category]=s.scroller.scrollTop;
    cancelRequests(s);if(s.searchTimer)w.clearTimeout(s.searchTimer);s.searchTimer=null;s.searchQueued=false;s.searchTerm='';s.searchInput.value='';s.feedRefresh=null;s.epoch++;s.category=category;if(s.roomPicker)s.roomPicker.open=false;if(config.stock)config.lastCategory=category;if(s.destination)s.destination.textContent='投稿先：'+title(category);s.posts=[];s.replies={};s.pending.clear();s.loading=false;s.paging=false;s.polling=false;s.loadError=null;s.hasMore=false;s.newPosts=null;s.restoreTop=s.positions[category]||0;
    s.categoryButtons.forEach(function(item){item.button.setAttribute('aria-pressed',String(item.code===category));});
    if(s.archive){s.archive.hidden=config.stock?false:category!=='all';s.archiveLoading=false;if(config.stock)s.archiveLoaded=false;if(!s.archiveLoaded){s.archive.open=false;s.archiveBody.replaceChildren();}}restoreDraft();if(config.stock){s.archive.open=false;s.archiveBody.replaceChildren();}s.categoryNote.textContent=config.stock?title(category):category==='all'?'':(lang()==='ja'?title(category)+'について、気軽に話そう。':'Talk about '+t(title(category)).toLowerCase()+'.');s.categoryToolbar.hidden=!config.stock&&category==='all';message('');load(false);
  }
  function restoreDraft() {
    var s=state,collection=drafts(),saved=collection[s.category]||{};if(!config.stock&&s.legacyDraft&&collection[s.legacyDraft])saved=collection[s.legacyDraft];s.input.value=typeof saved.body==='string'?saved.body:'';
    s.categoryInput.value=s.category==='all'?(categories.some(function(item){return item[0]===saved.category&&item[0]!=='all';})?saved.category:'chat'):s.category;
    s.languageInput.value=languages.some(function(item){return item[0]===saved.language;})?saved.language:'ja';count();
  }
  function count() {if(!current())return;var n=chars(state.input.value);state.counter.textContent=n+' / 200';state.counter.classList.toggle('cw-error',n>200);}
  function retryId(key,payload) {
    var s=state,old=s.retries[key],previous,account=profileAccount();
    try {previous=old&&JSON.parse(old.identity);}catch(_) {}
    // A changed saved nickname must not turn an unknown-outcome retry into a
    // second post. Names remain part of the original idempotent payload.
    if(previous&&typeof previous.name==='string'&&chars(previous.name)<=20&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(previous.name)&&['body','category','language','parent_id'].every(function(field){return previous[field]===payload[field];})){
      if(old.owner!==undefined&&old.owner!==account)return null;payload.name=previous.name;return old.id;
    }
    var identity=JSON.stringify(payload);if(!old||old.identity!==identity)s.retries[key]={identity:identity,id:uuid(),owner:account};return s.retries[key].id;
  }
  async function submitPost(parent,replyModel) {
    if(!current())return;var s=state,epoch=s.epoch,key=parent?'reply:'+parent.id:'compose:'+s.category,input=parent?replyModel.input:s.input,submittedInput=input.value,body=input.value.trim();
    if(s.pending.has(key))return;if(!body){message('投稿する内容を入力してください。',true);return;}if(chars(body)>200){message('投稿は200文字以内にしてください。',true);return;}
    if(w.KNUserProfile&&typeof w.KNUserProfile.ready==='function'){if(s.preparingName)return;s.preparingName=true;var preparingAccount=profileAccount();try{await w.KNUserProfile.ready();if(!profileAccountUnchanged(preparingAccount))throw new Error('account_changed');}catch(_){if(alive(s,epoch))message('ユーザー名を確認できませんでした。メニューのプロフィールを確認してください。',true);return;}finally{s.preparingName=false;}if(!alive(s,epoch))return;}
    var postingAccount=profileAccount();s.syncNickname();var payload={name:s.committedNickname,body:body,category:parent?parent.category:s.categoryInput.value,language:s.languageInput.value,parent_id:parent?parent.id:null},currentName=payload.name;
    s.pending.add(key);s.writes++;var sendButton=parent?replyModel.send:s.sendButton;sendButton.disabled=true;if(!parent&&s.draftSelect)s.draftSelect.disabled=true;persist();
    try {var access=await token(s);if(!access||!alive(s,epoch))return;if(!profileAccountUnchanged(postingAccount)){message('アカウントが切り替わりました。内容を確認して、もう一度投稿してください。',true);return;}
      payload.request_id=retryId(key,payload);if(!payload.request_id){message('別のアカウントで送信を確認中の内容です。元のアカウントで確認してください。',true);return;}persist();if(payload.name!==currentName)message('前回と同じニックネームで再送します。');
      var result=await request('/api/community/posts',jsonOptions('POST',payload,access),s);if(!alive(s,epoch))return;
      s.writes++;delete s.retries[key];var unchanged=parent?replyModel.draft===submittedInput:input.value===submittedInput;if(unchanged)input.value='';
      if(parent){if(result.post&&!parent.reply_preview)parent.reply_preview={id:result.post.id,name:result.post.name,body:result.post.body,created_at:result.post.created_at,parent_id:parent.id};if(unchanged){replyModel.draft='';delete replyDrafts[s.category+'|'+parent.id];}if(result.post){var existingReply=replyModel.posts.find(function(post){return String(post.id)===String(result.post.id);});if(existingReply)Object.assign(existingReply,result.post);else{replyModel.posts.push(result.post);parent.reply_count=safeCount(parent.reply_count)+1;}}}
      else{count();persist();if(s.searchTerm)s.feedRefresh='replace';if(result.post&&!s.searchTerm&&(s.category==='all'||result.post.category===s.category)){var existingPost=s.posts.find(function(post){return String(post.id)===String(result.post.id);});if(existingPost)Object.assign(existingPost,result.post);else s.posts.unshift(result.post);}s.loadError=null;}
      persist();message(parent?'返信しました。':'投稿しました。');render();
    } catch(error){if(alive(s,epoch)&&error.name!=='AbortError'){if(error.reason==='invalid_name'&&error.status===400){delete s.retries[key];persist();}message(errorText(error),true);}}
    finally{if(alive(s,epoch)){s.pending.delete(key);sendButton.disabled=false;if(!parent&&s.draftSelect)s.draftSelect.disabled=false;if(parent)render();flushRefreshes(s,epoch);}}
  }
  function send() {return submitPost(null,null);}
  function replyNode(post,model) {
    var category=state.category,box=el('section','cw-replies');box.setAttribute('aria-label','返信');
    if(model.loading)box.appendChild(el('p','cw-small','返信を読み込み中…'));
    if(model.error){box.appendChild(el('p','cw-small cw-error',errorText(model.error)));box.appendChild(button('cw-text-button','もう一度読む',null,function(){loadReplies(post,false);}));}
    model.posts.forEach(function(reply){box.appendChild(postNode(reply,true));});
    if(!model.loading&&!model.error&&!model.posts.length)box.appendChild(el('p','cw-small','まだ返信はありません。'));
    if(model.hasMore)box.appendChild(button('cw-text-button','返信をもっと見る',null,function(){loadReplies(post,true);}));
    var replyLabel=lang()==='ja'?post.name+'さんへ返信':'Reply to '+post.name;
    var form=el('form','cw-reply-form'),label=fieldLabel(replyLabel),input=el('textarea','cw-input');input.rows=2;input.value=model.draft||'';input.dataset.field='reply:'+post.id;input.setAttribute('aria-label',replyLabel);label.appendChild(input);form.appendChild(label);model.input=input;
    var bottom=el('div','cw-form-bottom'),counter=el('span','cw-small',chars(input.value)+' / 200'),sendButton=button('cw-primary','返信する');sendButton.type='submit';sendButton.disabled=state.pending.has('reply:'+post.id);model.send=sendButton;bottom.appendChild(counter);bottom.appendChild(sendButton);form.appendChild(bottom);
    input.addEventListener('input',function(){model.draft=input.value;var key=category+'|'+post.id;if(model.draft)replyDrafts[key]=model.draft;else delete replyDrafts[key];counter.textContent=chars(input.value)+' / 200';counter.classList.toggle('cw-error',chars(input.value)>200);});
    form.addEventListener('submit',function(event){event.preventDefault();submitPost(post,model);});box.appendChild(form);return box;
  }
  function toggleReplies(post) {var s=state,model=s.replies[post.id];if(model){model.open=!model.open;if(model.open)loadReplies(post,false);else render();return;}s.replies[post.id]={open:true,posts:[],draft:replyDrafts[s.category+'|'+post.id]||'',loading:false};loadReplies(post,false);}
  async function loadReplies(post,append) {
    var s=state,epoch=s.epoch,writeVersion=s.writes,model=s.replies[post.id];if(model.loading)return;model.loading=true;model.error=null;render();
    var path='/api/community/posts/'+encodeURIComponent(post.id)+'/replies?limit=50';if(append&&model.cursor!=null)path+='&after='+encodeURIComponent(model.cursor);
    try{var data=await request(path,null,s);if(!alive(s,epoch))return;
      if(s.writes!==writeVersion){model.loading=false;model.refresh=true;render();flushRefreshes(s,epoch);return;}
      var rows=Array.isArray(data.posts)?data.posts:[];model.posts=append?model.posts.concat(rows):rows;model.hasMore=!!data.has_more;model.cursor=data.next_cursor;model.loading=false;render();}
    catch(error){if(alive(s,epoch)&&error.name!=='AbortError'){model.loading=false;model.error=error;render();}}
  }
  async function toggleLike(post) {
    var s=state,epoch=s.epoch,key='like:'+post.id;if(s.pending.has(key))return;s.pending.add(key);s.writes++;render();
    try{var access=await token(s);if(!access||!alive(s,epoch))return;var result=await request('/api/community/posts/'+encodeURIComponent(post.id)+'/like',jsonOptions('POST',{liked:!post.liked_by_me},access),s);if(!alive(s,epoch))return;s.writes++;post.liked_by_me=!!result.liked;post.like_count=safeCount(result.like_count);message('');}
    catch(error){if(alive(s,epoch)&&error.name!=='AbortError')message(errorText(error),true);}
    finally{if(alive(s,epoch)){s.pending.delete(key);render();flushRefreshes(s,epoch);}}
  }
  function confirmDialog(heading,copy,action) {
    var s=state,dialog=el('dialog','cw-dialog'),form=el('form','cw-dialog-form');form.method='dialog';form.appendChild(el('h2','cw-dialog-title',heading));form.appendChild(el('p','cw-dialog-copy',copy));var controls=el('div','cw-dialog-controls');controls.appendChild(button('cw-text-button','やめる',null,function(){dialog.close();}));var go=button('cw-primary','確認する');controls.appendChild(go);form.appendChild(controls);dialog.appendChild(form);s.root.appendChild(dialog);
    go.addEventListener('click',function(){action(dialog,go,form);});dialog.addEventListener('close',function(){dialog.remove();});dialog.showModal();return {dialog:dialog,form:form,button:go};
  }
  async function report(post) {
    var s=state,epoch=s.epoch,picker,access=await token(s);if(!access||!alive(s,epoch))return;
    var modal=confirmDialog('投稿を通報','気になる点を選んでください。通報内容は投稿の一覧には表示されません。',async function(dialog,go){
      go.disabled=true;try{await request('/api/community/posts/'+encodeURIComponent(post.id)+'/report',jsonOptions('POST',{reason:picker.value},access),s);if(alive(s,epoch)){dialog.close();message('通報を受け付けました。');}}
      catch(error){if(alive(s,epoch)&&error.name!=='AbortError'){modal.error.textContent=t(errorText(error));message(errorText(error),true);}}finally{go.disabled=false;}
    });picker=el('select','cw-select');picker.setAttribute('aria-label',t('通報の理由'));reasons.forEach(function(item){var option=el('option','',item[1]);option.value=item[0];picker.appendChild(option);});modal.form.insertBefore(picker,modal.form.lastElementChild);modal.button.querySelector('.cw-button-copy').textContent=t('通報する');modal.error=el('p','cw-small cw-error');modal.error.setAttribute('role','alert');modal.form.appendChild(modal.error);
  }
  async function remove(post) {
    if(post.is_mine!==true)return;var s=state,epoch=s.epoch,access=await token(s);if(!access||!alive(s,epoch))return;
    var modal=confirmDialog('投稿を削除','この投稿を削除します。削除した投稿は元に戻せません。',async function(dialog,go){
      go.disabled=true;s.writes++;try{await request('/api/community/posts/'+encodeURIComponent(post.id),jsonOptions('DELETE',null,access),s);if(!alive(s,epoch))return;s.writes++;dialog.close();s.posts=s.posts.filter(function(item){return item.id!==post.id;});Object.values(s.replies).forEach(function(model){model.posts=model.posts.filter(function(item){return item.id!==post.id;});});var parent=s.posts.find(function(item){return item.id===post.parent_id;});if(parent){parent.reply_count=Math.max(0,safeCount(parent.reply_count)-1);if(parent.reply_preview&&String(parent.reply_preview.id)===String(post.id))parent.reply_preview=null;}s.feedRefresh='replace';message('投稿を削除しました。');render();}
      catch(error){if(alive(s,epoch)&&error.name!=='AbortError'){modal.error.textContent=t(errorText(error));message(errorText(error),true);}}finally{go.disabled=false;flushRefreshes(s,epoch);}
    });modal.button.querySelector('.cw-button-copy').textContent=t('削除する');modal.error=el('p','cw-small cw-error');modal.error.setAttribute('role','alert');modal.form.appendChild(modal.error);
  }
  function close() {if(!state)return;var s=state;persist();rememberReplies(s);state=null;sequence++;cancelRequests(s);if(s.searchTimer)w.clearTimeout(s.searchTimer);if(s.timer)w.clearInterval(s.timer);if(s.visibility)doc.removeEventListener('visibilitychange',s.visibility);if(s.languageChanged)doc.removeEventListener('langChanged',s.languageChanged);if(s.authChanged)doc.removeEventListener('knAuthChange',s.authChanged);if(s.profileChanged)doc.removeEventListener('knProfileChange',s.profileChanged);s.root.remove();prepare();return {morningTop:s.morningTop};}
  function home() {
    var s=state,top=s&&s.morningTop||0,onReturn=s&&s.onReturn;if(config.stock&&w.KNStockTalk)w.KNStockTalk.close();else close();if(onReturn){if(s.scope.wasMorning)doc.body.classList.add('view-asaletter');onReturn();return;}var nav=doc.querySelector('#knBottomNav [data-act="morning"]');if(nav)nav.click();else doc.body.classList.add('view-asaletter');
    var morning=doc.getElementById('morning-section');if(morning)morning.scrollTop=top;var entrance=doc.getElementById('knHomeATalk');if(entrance)entrance.focus({preventScroll:true});
  }
  function select(options,label) {var node=el('select','cw-select');node.setAttribute('aria-label',label);options.forEach(function(item){var option=el('option','',item[1]);option.value=item[0];node.appendChild(option);});return node;}
  function openRoom(room,options) {
    if(!config.stock||!room||typeof room.code!=='string'||!/^[0-9][0-9A-Z]{3}$/.test(room.code)||room.category!=='stock:'+room.code||typeof room.name!=='string'||!room.name.trim())return false;
    var clean={code:room.code,category:room.category,name:room.name.trim().slice(0,160)};
    if(!categories.some(function(item){return item[0]===clean.category;}))categories.push([clean.category,clean.name+' '+clean.code]);
    var wasMorning=doc.body.classList.contains('view-asaletter');close();return open(options,{room:clean,wasMorning:wasMorning,onReturn:options&&typeof options.onReturn==='function'?options.onReturn:null});
  }
  function open(entryOrigin,scope) {
    var origin;
    if(!config.stock&&w.KNStockTalk)origin=w.KNStockTalk.close();
    if(config.stock&&w.KNCommunity)origin=w.KNCommunity.close();
    if(!origin||!Number.isFinite(origin.morningTop))origin=entryOrigin;
    var hub=doc.getElementById('knMyTalkHub'),otherHub=doc.getElementById('talkHubOv');
    if(hub)hub.style.display='none';if(otherHub){otherHub.classList.remove('open');otherHub.style.display='';}
    if(current())return true;var morning=doc.getElementById('morning-section'),root=el('section','cw-screen'),screenLabel=config.stock?'みんなの声':'みんなのトーク';root.id=config.stock?'stockTalkOv':'cmOv';root.setAttribute('aria-label',t(screenLabel));root.dataset.cwLabel=screenLabel;
    var savedRetries;try{savedRetries=JSON.parse(stored(retryKey,'{}'));}catch(_){savedRetries={};}
    var s={root:root,epoch:++sequence,category:config.stock?(scope?scope.room.category:config.lastCategory||categories[0][0]):'all',scope:scope||null,onReturn:scope&&scope.onReturn,posts:[],replies:{},retries:savedRetries&&typeof savedRetries==='object'?savedRetries:{},pending:new Set(),controllers:new Set(),readControllers:new Set(),searchTerm:'',positions:{},writes:0,morningTop:origin&&Number.isFinite(origin.morningTop)?origin.morningTop:(morning?morning.scrollTop:0),loading:false,paging:false,polling:false,hasMore:false};state=s;doc.body.classList.remove('view-asaletter');
    var header=el('header','cw-header'),heading=el('h1','cw-title',screenLabel);heading.tabIndex=-1;header.appendChild(heading);header.appendChild(button('cw-close','×',scope&&scope.onReturn?'会社情報に戻る':config.stock?'銘柄トークを閉じて朝レターへ戻る':'コミュニティを閉じて朝レターへ戻る',home));root.appendChild(header);
    var scroller=el('div','cw-scroll');s.scroller=scroller;var content=el('div','cw-content');scroller.appendChild(content);root.appendChild(scroller);
    content.appendChild(el('h1','cw-context-title',screenLabel));
    if(scope){var company=el('p','cw-company-context');company.textContent=scope.room.name+' '+scope.room.code;content.appendChild(company);}
    var intro=el('p','cw-intro',config.stock?(scope?'この会社について、気軽に話そう。':'会社名・銘柄コードで選び、その銘柄について話そう。'):'');intro.hidden=!config.stock;content.appendChild(intro);
    var nav=el('nav','cw-categories');nav.setAttribute('aria-label',config.stock?'銘柄・指数を選ぶ':'話題のジャンル');s.categoryButtons=[];categories.forEach(function(item){var b=button('cw-category',item[1],null,function(){switchCategory(item[0]);});b.setAttribute('aria-pressed',String(item[0]===s.category));nav.appendChild(b);s.categoryButtons.push({code:item[0],button:b});});if(config.stock)content.appendChild(nav);
    if(config.stock){
      var finder=el('form','cw-stock-search cw-search'),query=el('input','cw-input'),find=button('cw-primary','検索','検索');query.type='search';query.placeholder=t('会社名・銘柄コード');query.dataset.cwPlaceholder='会社名・銘柄コード';query.setAttribute('aria-label',t('会社名・銘柄コード'));query.dataset.cwLabel='会社名・銘柄コード';find.type='submit';finder.appendChild(find);finder.appendChild(query);content.insertBefore(finder,intro);
      var matches=el('div','cw-stock-results');content.insertBefore(matches,nav);var searchEpoch=0;
      function chooseRoom(room){if(!alive(s))return;if(!categories.some(function(c){return c[0]===room.category;})){categories.push([room.category,room.name+' '+room.code]);s.categoryInput.appendChild(el('option','',room.name+' '+room.code));s.categoryInput.lastChild.value=room.category;}switchCategory(room.category);s.categoryNote.textContent=room.name+' '+room.code;matches.replaceChildren();}
      finder.addEventListener('submit',async function(e){e.preventDefault();var serial=++searchEpoch;matches.replaceChildren(el('p','cw-small','銘柄を検索中…'));try{var result=await request('/api/stock-talk/rooms?q='+encodeURIComponent(query.value),null,s);if(!alive(s)||serial!==searchEpoch)return;matches.replaceChildren();if(!result.rooms.length)matches.appendChild(el('p','cw-small','銘柄が見つかりませんでした。'));result.rooms.forEach(function(room){matches.appendChild(button('cw-category',room.name+' '+room.code,null,function(){chooseRoom(room);}));});}catch(e){if(alive(s)&&serial===searchEpoch)matches.replaceChildren(el('p','cw-small','検索できませんでした。もう一度お試しください。'));}});
      s.chooseRoom=chooseRoom;
      var roomPicker=el('details','cw-room-picker'),roomSummary=el('summary','','銘柄を選ぶ');roomPicker.appendChild(roomSummary);roomPicker.appendChild(finder);roomPicker.appendChild(matches);roomPicker.appendChild(nav);roomPicker.hidden=!!scope;content.insertBefore(roomPicker,intro);s.roomPicker=roomPicker;
    }
    var search=el('form',(config.stock?'cw-stock-post-search':'cw-community-search')+' cw-search'),postQuery=el('input','cw-input'),searchButton=button('cw-primary','検索','検索');
    var searchLabel=config.stock?'この銘柄の投稿・返信を検索':'投稿・返信を検索';postQuery.type='search';postQuery.maxLength=80;postQuery.placeholder=t(searchLabel);postQuery.dataset.cwPlaceholder=searchLabel;postQuery.setAttribute('aria-label',t(searchLabel));postQuery.dataset.cwLabel=searchLabel;s.searchInput=postQuery;searchButton.type='submit';search.appendChild(searchButton);search.appendChild(postQuery);content.appendChild(search);
    function queueSearch(){if(s.searchTimer)w.clearTimeout(s.searchTimer);s.searchTimer=w.setTimeout(function(){s.searchTimer=null;searchNow(s);},350);}
    postQuery.addEventListener('input',queueSearch);postQuery.addEventListener('search',function(){searchNow(s);});search.addEventListener('submit',function(event){event.preventDefault();searchNow(s);});


    var toolbar=el('div','cw-toolbar');s.categoryToolbar=toolbar;toolbar.hidden=!config.stock;s.categoryNote=el('p','cw-description');toolbar.appendChild(s.categoryNote);var composeToggle=button('cw-primary cw-compose-toggle','つぶやく',null,function(){s.composer.hidden=!s.composer.hidden;composeToggle.setAttribute('aria-expanded',String(!s.composer.hidden));if(!s.composer.hidden)s.input.focus({preventScroll:true});});composeToggle.setAttribute('aria-expanded','false');composeToggle.setAttribute('aria-controls',root.id+'Composer');if(config.stock)toolbar.appendChild(composeToggle);content.appendChild(toolbar);
    var composer=el('form','cw-composer');composer.id=root.id+'Composer';composer.hidden=!!config.stock;if(!config.stock)composer.classList.add('cw-composer-inline');s.composer=composer;if(config.stock){s.destination=el('p','cw-description','投稿先：'+title(s.category));composer.appendChild(s.destination);}
    var fields=el('div','cw-composer-fields'),nicknameBox=el('div','cw-nickname'),nicknameSummary=el('div','cw-nickname-summary'),nicknameValue=el('span','cw-nickname-value'),nicknameEditor=el('div','cw-nickname-editor'),nicknameLabel=fieldLabel('経済ニュース共通のニックネーム'),nickname=el('input','cw-input');
    s.committedNickname=savedNickname('');nickname.id='cmNick';nickname.type='text';nickname.maxLength=20;nickname.value=s.committedNickname;nickname.setAttribute('aria-label',t('経済ニュース共通のニックネーム（20文字まで）'));nickname.dataset.cwLabel='経済ニュース共通のニックネーム（20文字まで）';nicknameLabel.appendChild(nickname);s.nickname=nickname;
    var nicknameStatus=el('p','cw-small cw-nickname-status');nicknameStatus.setAttribute('role','status');nicknameStatus.setAttribute('aria-live','polite');
    function nicknameNotice(text,bad){nicknameStatus.textContent=t(text);nicknameStatus.dataset.cwCopy=text;nicknameStatus.classList.toggle('cw-error',!!bad);}
    s.syncNickname=function(){s.committedNickname=savedNickname(s.committedNickname);nicknameValue.textContent=s.committedNickname||t('名無しさん');};
    function editNickname(edit){nicknameSummary.hidden=edit;nicknameEditor.hidden=!edit;}
    var nicknameChange=button('cw-text-button cw-nickname-change','変更',null,function(){s.syncNickname();nickname.value=s.committedNickname;nicknameNotice('',false);editNickname(true);nickname.focus({preventScroll:true});});
    async function saveNickname(){
      var value=nickname.value.trim();if(!value){nicknameNotice('ニックネームを入力してください。',true);return;}if(chars(value)>20){nicknameNotice('ニックネームは20文字以内にしてください。',true);return;}
      try {if(w.KNUserProfile&&typeof w.KNUserProfile.saveUsername==='function'){if(nicknameSave.disabled)return;nicknameSave.disabled=true;await w.KNUserProfile.saveUsername(value);if(!alive(s))return;}else{w.localStorage.setItem('cm_nick',value);if(w.localStorage.getItem('cm_nick')!==value)throw new Error('nickname_not_saved');}}
      catch(_){if(alive(s))nicknameNotice('保存できませんでした。入力した名前は残しています。',true);return;}finally{nicknameSave.disabled=false;}
      s.committedNickname=value;nickname.value=value;nicknameValue.textContent=value;editNickname(false);nicknameNotice(w.KNUserProfile?'プロフィールに保存しました。':'この端末に保存しました。',false);nicknameChange.focus({preventScroll:true});
    }
    var nicknameSave=button('cw-primary cw-nickname-save','保存',null,saveNickname),nicknameCancel=button('cw-text-button cw-nickname-cancel','やめる',null,function(){s.syncNickname();nickname.value=s.committedNickname;nicknameNotice('',false);editNickname(false);nicknameChange.focus({preventScroll:true});}),nicknameActions=el('div','cw-nickname-actions');
    nickname.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(event.stopPropagation)event.stopPropagation();saveNickname();}});
    nicknameSummary.appendChild(el('span','cw-nickname-caption','経済ニュース共通のニックネーム'));nicknameSummary.appendChild(nicknameValue);nicknameSummary.appendChild(nicknameChange);nicknameEditor.appendChild(nicknameLabel);nicknameActions.appendChild(nicknameSave);nicknameActions.appendChild(nicknameCancel);nicknameEditor.appendChild(nicknameActions);nicknameBox.appendChild(nicknameSummary);nicknameBox.appendChild(nicknameEditor);nicknameBox.appendChild(el('p','cw-small cw-nickname-scope',w.KNUserProfile?'メニューのプロフィールと共通のユーザー名です。':'一度保存すると、同じブラウザで共通して使えます。'));nicknameBox.appendChild(nicknameStatus);fields.appendChild(nicknameBox);s.syncNickname();editNickname(!s.committedNickname);
    var categoryLabel=fieldLabel('投稿する話題');s.categoryInput=select(config.stock?categories:categories.slice(1),'投稿する話題');categoryLabel.appendChild(s.categoryInput);categoryLabel.hidden=true;fields.appendChild(categoryLabel);if(config.stock)s.categoryInput.disabled=true;
    var languageLabel=fieldLabel('投稿の言語');s.languageInput=select(languages,'投稿の言語');languageLabel.appendChild(s.languageInput);fields.appendChild(languageLabel);composer.appendChild(fields);
    var inputLabel=fieldLabel('つぶやき'),input=el('textarea','cw-input cw-compose-body');input.id='cmInput';input.rows=3;var composePlaceholder=config.stock?'気になったことや、みんなへの質問を書いてみよう。':'気になることを、自由につぶやこう。';input.placeholder=t(composePlaceholder);input.dataset.cwPlaceholder=composePlaceholder;input.setAttribute('aria-label','つぶやき（200文字まで）');inputLabel.appendChild(input);if(config.stock)composer.appendChild(inputLabel);else composer.insertBefore(inputLabel,fields);s.input=input;
    var composerBottom=el('div','cw-form-bottom');s.counter=el('span','cw-small','0 / 200');s.counter.id='cmCount';composerBottom.appendChild(s.counter);s.sendButton=button('cw-primary','投稿する');s.sendButton.type='submit';composerBottom.appendChild(s.sendButton);composer.appendChild(composerBottom);composer.appendChild(el('p','cw-small','個人情報や、利益を保証する勧誘は書き込まないでください。'));content.appendChild(composer);
    input.addEventListener('input',function(){count();persist();});[s.categoryInput,s.languageInput].forEach(function(field){field.addEventListener('change',persist);});composer.addEventListener('submit',function(event){event.preventDefault();send();});
    s.notice=el('p','cw-notice');s.notice.setAttribute('role','status');s.notice.setAttribute('aria-live','polite');content.appendChild(s.notice);
    s.newButton=button('cw-new-posts','新しい投稿があります',null,function(){if(!s.newPosts)return;applyPage(s.newPosts,false);message('新しい投稿を表示しました。');});s.newButton.hidden=true;content.appendChild(s.newButton);
    s.loadingNode=el('p','cw-state','投稿を読み込み中…');s.loadingNode.setAttribute('role','status');content.appendChild(s.loadingNode);
    s.empty=el('div','cw-state');s.empty.appendChild(el('p','','まだ投稿はありません。'));s.empty.appendChild(el('p','cw-small','最初のひとことを、気軽にどうぞ。'));content.appendChild(s.empty);
    {s.searchEmpty=el('p','cw-search-empty','一致する投稿はありません。');s.searchEmpty.hidden=true;s.searchEmpty.setAttribute('role','status');content.appendChild(s.searchEmpty);}
    s.failure=el('div','cw-state cw-error-state');s.failureCopy=el('p','');s.failure.appendChild(s.failureCopy);s.failure.appendChild(button('cw-text-button','もう一度読む',null,function(){load(false);}));content.appendChild(s.failure);
    s.feed=el('div','cw-feed');s.feed.setAttribute('aria-label','コミュニティの投稿');content.appendChild(s.feed);s.more=button('cw-more','もっと見る',null,function(){load(true);});content.appendChild(s.more);
    var guide=el('details','cw-guide'),summary=el('summary','','この場所の使い方');guide.appendChild(summary);guide.appendChild(el('p','',config.stock?'選んだ会社や指数について交流できます。投稿は個人の意見です。相手を尊重し、気になる投稿は「…」から通報してください。日時は日本時間（JST）です。':'話題や順番を決めず、気になることから交流できます。投稿は個人の意見です。相手を尊重し、気になる投稿は「…」から通報してください。日時は日本時間（JST）です。'));content.appendChild(guide);
    s.archive=el('details','cw-archive');s.archive.appendChild(el('summary','','これまでの会話'));s.archiveBody=el('div','cw-archive-body');s.archive.appendChild(s.archiveBody);s.archiveLoaded=false;s.archive.addEventListener('toggle',function(){if(s.archive.open&&!s.archiveLoaded)loadArchive();});content.appendChild(s.archive);
    if(!config.stock){var oldDrafts=drafts(),savedTopics=categories.slice(1).filter(function(item){return oldDrafts[item[0]]&&oldDrafts[item[0]].body;});if(savedTopics.length){var draftChooser=el('label','cw-field-label cw-saved-draft-label','保存した下書き'),draftSelect=select([['all','いまの下書き']].concat(savedTopics.map(function(item,index){return [item[0],t('以前の下書き')+' '+(index+1)];})),'保存した下書き');draftSelect.querySelectorAll('option').forEach(function(option,index){if(index)option.dataset.cwDraftNumber=String(index);});draftChooser.appendChild(draftSelect);composer.insertBefore(draftChooser,fields);s.draftSelect=draftSelect;draftSelect.addEventListener('change',function(){if(s.pending.has('compose:'+s.category)){draftSelect.value=s.legacyDraft||'all';return;}persist();s.legacyDraft=draftSelect.value==='all'?null:draftSelect.value;restoreDraft();});}}
    doc.body.appendChild(root);restoreDraft();if(config.stock){s.archive.hidden=false;s.categoryNote.textContent=title(s.category);if(config.onReady)config.onReady(s);}w.knTalkLastView=config.stock?'stock':'community';prepare();load(false);s.timer=w.setInterval(poll,30000);s.visibility=function(){if(!doc.hidden)poll();};doc.addEventListener('visibilitychange',s.visibility);
    s.languageChanged=function(){if(!alive(s))return;s.root.querySelectorAll('[data-cw-copy]').forEach(function(node){node.textContent=t(node.dataset.cwCopy);});s.root.querySelectorAll('[data-cw-label]').forEach(function(node){node.setAttribute('aria-label',t(node.dataset.cwLabel));});s.root.querySelectorAll('[data-cw-placeholder]').forEach(function(node){node.placeholder=t(node.dataset.cwPlaceholder);});s.root.querySelectorAll('[data-cw-draft-number]').forEach(function(node){node.textContent=t('以前の下書き')+' '+node.dataset.cwDraftNumber;});s.syncNickname();s.categoryNote.textContent=config.stock?title(s.category):s.category==='all'?'':(lang()==='ja'?title(s.category)+'について、気軽に話そう。':'Talk about '+t(title(s.category)).toLowerCase()+'.');render();};doc.addEventListener('langChanged',s.languageChanged);s.authChanged=poll;doc.addEventListener('knAuthChange',s.authChanged);s.profileChanged=function(){if(alive(s))s.syncNickname();};doc.addEventListener('knProfileChange',s.profileChanged);return true;
  }
  async function loadArchive() {
    if(!current()||state.archiveLoading)return;var s=state,epoch=s.epoch;s.archiveLoading=true;s.archiveBody.replaceChildren(el('p','cw-small','これまでの会話を読み込み中…'));
    try{var data=await request(config.stock?'/api/stock-comments?symbol='+encodeURIComponent(s.category.indexOf('stock:')===0?s.category.slice(6)+'.T':s.category.slice(6)):'/api/messages',null,s);if(!alive(s,epoch))return;s.archiveLoaded=true;s.archiveBody.replaceChildren(el('p','cw-small','過去の会話です。現在の投稿とは分けて表示しています。'));var rows=Array.isArray(config.stock?data.comments:data.messages)?(config.stock?data.comments:data.messages):[];
      if(!rows.length)s.archiveBody.appendChild(el('p','cw-small','これまでの会話はまだありません。'));
      rows.forEach(function(post){var article=el('article','cw-legacy-post');article.appendChild(el('span','cw-author',post.name||'名無しさん'));article.appendChild(el('p','cw-post-body',post.body||''));article.appendChild(el('p','cw-post-date',date(post.created_at,'投稿')));s.archiveBody.appendChild(article);});
    }catch(error){if(alive(s,epoch)&&error.name!=='AbortError'){s.archiveLoaded=false;s.archiveBody.replaceChildren(el('p','cw-small cw-error',errorText(error)),button('cw-text-button','もう一度読む',null,loadArchive));}}
    finally{if(alive(s,epoch))s.archiveLoading=false;}
  }
  return {open:open,openRoom:openRoom,close:close,send:send,count:count,categories:categories.map(function(item){return item.slice();}),formatDate:date,errorText:errorText};
});
