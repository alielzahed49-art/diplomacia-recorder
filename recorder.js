// ==UserScript==
// @name         Diplomacia Recorder
// @namespace    diplomacia-recorder
// @version      1.2
// @description  Records the official Diplomacia client requests (no tokens) and sends them to the bot server
// @match        https://diplomacia.com.tr/*
// @match        https://*.diplomacia.com.tr/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function(){
  if(location.hostname.indexOf('diplomacia.com.tr')<0)return;
  if(window.__dcap)return; window.__dcap=1;
  var ENDPOINT='https://diplomaciabot-9swm.onrender.com/api/capture', SESSION=Math.random().toString(36).slice(2,10);
  var KEY=''; try{KEY=localStorage.getItem('dcap_key')||'';}catch(e){}
  function ensureKey(){
    if(KEY)return true;
    KEY=(window.prompt('Recorder key (من لوحة الأدمن):')||'').trim();
    try{if(KEY)localStorage.setItem('dcap_key',KEY);}catch(e){}
    return !!KEY;
  }
  // السؤال عن المفتاح بيتأجل لحد ما الصفحة تحمل (السكربت بيشتغل في بداية التحميل عشان يمسك أول الطلبات)
  if(!KEY){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(ensureKey,1500);});
    else setTimeout(ensureKey,1500);
  }
  var buf=[], seen={}, wsCount={}, st={cap:0,sent:0,fail:0,msg:'',via:''};
  var badge=document.createElement('div');
  badge.style.cssText='position:fixed;left:6px;bottom:6px;z-index:2147483647;font:10px monospace;background:rgba(0,0,0,.65);color:#7f7;padding:2px 6px;border-radius:6px;pointer-events:none';
  function paint(){badge.textContent='● rec '+st.cap+' / sent '+st.sent+(st.via?' ['+st.via+']':'')+(st.fail?' / fail '+st.fail:'')+(st.msg?' '+st.msg:'');badge.style.color=(st.fail&&!st.sent)||st.msg?'#f77':'#7f7';}
  function mount(){if(document.body&&!badge.parentNode){document.body.appendChild(badge);paint();}}
  if(document.body)mount(); else document.addEventListener('DOMContentLoaded',mount);
  function redact(s){return String(s).replace(/eyJ[A-Za-z0-9._-]{20,}/g,'<jwt>').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g,'<email>').replace(/("(?:token|password|pass|authorization)"\s*:\s*")[^"]*/ig,'$1<x>');}
  function shape(v,d){
    if(v===null)return 'null';
    if(Array.isArray(v))return '['+(v.length?JSON.stringify(shape(v[0],d+1)):'')+']x'+v.length;
    if(typeof v==='object'){if(d>2)return '{..}';var o={};Object.keys(v).slice(0,30).forEach(function(k){o[k]=shape(v[k],d+1);});return o;}
    return typeof v;
  }
  var of=window.fetch;
  // موقع اللعبة ممكن يمنع الاتصال بسيرفرات تانية (CSP) — فبنجرب أكتر من طريقة إرسال بالترتيب
  // وبنحفظ اللي نجحت: gm (GM_xmlhttpRequest لو Via بيوفرها) ← img (صورة 1x1 بتشيل البيانات في الرابط) ← fetch
  var METHOD=''; try{METHOD=localStorage.getItem('dcap_m')||'';}catch(e){}
  function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function trimEv(e){return {t:e.t,m:e.m,u:(e.u||'').slice(0,150),s:e.s,ms:e.ms,rb:(e.rb||'').slice(0,200),sh:(e.sh||'').slice(0,500),sa:(e.sa||'').slice(0,400),len:e.len};}
  function body(evs){return JSON.stringify({key:KEY,session:SESSION,ua:navigator.userAgent.slice(0,90),page:location.pathname,events:evs});}
  var T={
    gm:function(evs,cb){
      var f=typeof GM_xmlhttpRequest==='function'?GM_xmlhttpRequest:(window.GM&&GM.xmlHttpRequest);
      if(!f)return cb(-1);
      try{f({method:'POST',url:ENDPOINT,data:body(evs),headers:{'Content-Type':'text/plain'},timeout:15000,
        onload:function(r){cb(r.status);},onerror:function(){cb(0);},ontimeout:function(){cb(0);}});}catch(e){cb(0);}
    },
    img:function(evs,cb){
      var chunks=[],cur=[],size=0;
      evs.forEach(function(e){var t=trimEv(e),l=JSON.stringify(t).length;if(cur.length&&size+l>2000){chunks.push(cur);cur=[];size=0;}cur.push(t);size+=l;});
      if(cur.length)chunks.push(cur);
      var left=chunks.length,bad=0; if(!left)return cb(200);
      chunks.forEach(function(c){
        var im=new Image();
        im.onload=function(){if(--left===0)cb(bad?0:200);};
        im.onerror=function(){bad++;if(--left===0)cb(0);};
        im.src=ENDPOINT+'.gif?k='+encodeURIComponent(KEY)+'&d='+enc({session:SESSION,page:location.pathname,events:c})+'&r='+Math.random().toString(36).slice(2,6);
      });
    },
    fetch:function(evs,cb){
      try{of.call(window,ENDPOINT,{method:'POST',keepalive:true,headers:{'Content-Type':'text/plain'},body:body(evs)})
        .then(function(r){cb(r.status);}).catch(function(){cb(0);});}catch(e){cb(0);}
    }
  };
  function send(evs){
    var order=['gm','img','fetch'];
    if(METHOD&&order.indexOf(METHOD)>-1){order.splice(order.indexOf(METHOD),1);order.unshift(METHOD);}
    (function next(i){
      if(i>=order.length){st.fail+=evs.length;st.msg='blocked?';paint();return;}
      var name=order[i];
      T[name](evs,function(status){
        if(status>=200&&status<300){st.sent+=evs.length;st.msg='';st.via=name;METHOD=name;try{localStorage.setItem('dcap_m',name);}catch(e){}paint();}
        else if(status===403&&name!=='img'){st.msg='KEY WRONG';KEY='';try{localStorage.removeItem('dcap_key');}catch(e){}paint();}
        else next(i+1);
      });
    })(0);
  }
  function flush(){
    if(!buf.length)return;
    if(!KEY){if(buf.length>200)buf=buf.slice(-200);return;}
    var b=buf; buf=[];
    send(b);
  }
  function record(method,url,status,ms,body,txt){
    try{
      if(url.indexOf(ENDPOINT)===0)return;
      var u=url.replace(location.origin,'');
      var path=u.split('?')[0], q=u.indexOf('?')>-1?u.slice(u.indexOf('?')):'';
      if(path.indexOf('/api/')<0&&url.indexOf('/api/')<0)return;
      var sh='',sample='',key=method+' '+path.replace(/[0-9a-f]{8,}|\d+/g,'N')+' '+status;
      try{var j=JSON.parse(txt);sh=JSON.stringify(shape(j,0)).slice(0,1500);}catch(e){sh='(non-json)';}
      seen[key]=(seen[key]||0)+1;
      if(seen[key]<=2)sample=redact(txt).slice(0,1200);
      buf.push({t:Date.now(),m:method,u:path.slice(0,200),s:status,ms:ms,rb:redact((q||'')+' '+(body||'')).slice(0,500),sh:sh,sa:sample,len:(txt||'').length});
      st.cap++;paint();
      if(buf.length>=30)flush();
    }catch(e){}
  }
  window.fetch=function(input,init){
    var t0=Date.now();
    var url=(typeof input==='string'?input:(input&&input.url))||'';
    var method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
    var body=init&&typeof init.body==='string'?init.body:'';
    var p=of.apply(this,arguments);
    p.then(function(res){try{res.clone().text().then(function(txt){record(method,res.url||url,res.status,Date.now()-t0,body,txt);});}catch(e){}}).catch(function(){});
    return p;
  };
  var oo=XMLHttpRequest.prototype.open, os=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__m=(m||'GET').toUpperCase();this.__u=u||'';return oo.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(b){
    var x=this,t0=Date.now();
    x.addEventListener('loadend',function(){try{var txt='';try{txt=x.responseText||'';}catch(e){}record(x.__m,new URL(x.__u,location.href).href,x.status,Date.now()-t0,typeof b==='string'?b:'',txt);}catch(e){}});
    return os.apply(this,arguments);
  };
  var OW=window.WebSocket;
  if(OW){window.WebSocket=function(url,pr){
    var ws=pr?new OW(url,pr):new OW(url);
    try{buf.push({t:Date.now(),m:'WS',u:String(url).replace(/(token|key)=[^&]*/ig,'$1=<x>').slice(0,200),s:0,ms:0,rb:'',sh:'',sa:'',len:0});
      ws.addEventListener('message',function(){var k=String(url).slice(0,80);wsCount[k]=(wsCount[k]||0)+1;});}catch(e){}
    return ws;};
    window.WebSocket.prototype=OW.prototype;
    ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){window.WebSocket[k]=OW[k];});
  }
  setInterval(function(){
    Object.keys(wsCount).forEach(function(k){if(wsCount[k]){buf.push({t:Date.now(),m:'WSMSG',u:k,s:0,ms:0,rb:'',sh:'',sa:'',len:wsCount[k]});wsCount[k]=0;}});
    flush();
  },15000);
  addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',function(){if(document.hidden)flush();});
})();
