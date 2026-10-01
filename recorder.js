// Diplomacia request recorder — بيسجل طلبات الموقع الرسمي ويبعتها لسيرفر البوت (من غير التوكن)
(function(){
  if(location.hostname.indexOf('diplomacia.com.tr')<0)return;
  if(window.__dcap)return; window.__dcap=1;
  var ENDPOINT='https://diplomaciabot-9swm.onrender.com/api/capture', SESSION=Math.random().toString(36).slice(2,10);
  var KEY=''; try{KEY=localStorage.getItem('dcap_key')||'';}catch(e){}
  if(!KEY){KEY=(window.prompt('Recorder key (من لوحة الأدمن):')||'').trim(); try{if(KEY)localStorage.setItem('dcap_key',KEY);}catch(e){}}
  if(!KEY)return;
  var buf=[], seen={}, wsCount={}, st={cap:0,sent:0,fail:0,msg:'●'};
  var badge=document.createElement('div');
  badge.style.cssText='position:fixed;left:6px;bottom:6px;z-index:2147483647;font:10px monospace;background:rgba(0,0,0,.65);color:#7f7;padding:2px 6px;border-radius:6px;pointer-events:none';
  function paint(){badge.textContent='● rec '+st.cap+' / sent '+st.sent+(st.fail?' / fail '+st.fail:'')+(st.msg!=='●'?' '+st.msg:'');badge.style.color=st.fail||st.msg!=='●'?'#f77':'#7f7';}
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
  function flush(){
    if(!buf.length)return;
    var b=buf; buf=[];
    of.call(window,ENDPOINT,{method:'POST',keepalive:true,headers:{'Content-Type':'text/plain'},body:JSON.stringify({key:KEY,session:SESSION,ua:navigator.userAgent.slice(0,90),page:location.pathname,events:b})})
      .then(function(r){
        if(r.status===403){st.msg='KEY WRONG';try{localStorage.removeItem('dcap_key');}catch(e){}}
        else if(r.ok){st.sent+=b.length;st.msg='●';}
        else{st.fail+=b.length;st.msg='HTTP '+r.status;}
        paint();})
      .catch(function(){st.fail+=b.length;st.msg='blocked?';paint();});
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
