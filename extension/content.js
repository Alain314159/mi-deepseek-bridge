const PWA_URL='https://alain314159.github.io/mi-deepseek-bridge/';
const MSG={HELLO:'HELLO',EXEC:'EXEC',PING:'PING',READY:'READY',STREAM:'STREAM',RESULT:'RESULT',ERROR:'ERROR',PONG:'PONG'};
const VERSION=1;
const SYSTEM_PROMPT="Eres un asistente que trabaja en modo agente con el usuario a traves de un puente que ejecuta comandos en una terminal Linux real. REGLAS: 1. Cuando necesites ejecutar algo, responde UNICAMENTE con un bloque de codigo sh con el comando exacto. 2. Un comando por bloque. Espera el resultado. 3. El usuario te devuelve la salida en un bloque plaintext. 4. Nunca inventes resultados. 5. Avanza de a un paso. 6. Usa flags no interactivos (ej: < /dev/null).";

const pending=new Map();
let iframe=null,panel=null,pwaReady=false,autopilot=false;
const seen=new WeakSet();

function makeMsg(t,p={},id=null){return{v:VERSION,id:id||Math.random().toString(36).slice(2,10),type:t,ts:Date.now(),payload:p};}
function loadAP(){try{chrome.storage.local.get(['autopilot']).then(r=>{autopilot=!!r.autopilot;});}catch{}}
function saveAP(){try{chrome.storage.local.set({autopilot});}catch{}}

function ensurePanel(){
  if(panel)return;
  panel=document.createElement('div');
  panel.id='mdsb-panel';
  panel.innerHTML='<div class="header"><span>Bridge</span><div class="actions"><label class="toggle" id="mdsb-ap-toggle"><input type="checkbox" id="mdsb-ap"/>Auto</label><button id="mdsb-inject" title="Instrucciones">I</button><button id="mdsb-close">x</button></div></div>';
  iframe=document.createElement('iframe');
  iframe.src=PWA_URL;
  panel.appendChild(iframe);
  document.body.appendChild(panel);
  const ap=panel.querySelector('#mdsb-ap'),tgl=panel.querySelector('#mdsb-ap-toggle');
  ap.checked=autopilot;
  if(autopilot)tgl.classList.add('on');
  ap.onchange=()=>{autopilot=ap.checked;tgl.classList.toggle('on',autopilot);saveAP();updateFab();if(autopilot)runAuto();};
  panel.querySelector('#mdsb-close').onclick=()=>panel.classList.remove('open');
  panel.querySelector('#mdsb-inject').onclick=injectPrompt;
}

function ensureFab(){
  let f=document.getElementById('mdsb-fab');
  if(f){updateFab();return;}
  f=document.createElement('button');
  f.id='mdsb-fab';
  f.textContent='>';
  f.title='Mi DeepSeek Bridge (arrastrable)';
  document.body.appendChild(f);

  try{
    chrome.storage.local.get(['fabPos']).then(r=>{
      if(r&&r.fabPos){
        f.style.left=r.fabPos.left+'px';
        f.style.top=r.fabPos.top+'px';
        f.style.right='auto';
        f.style.bottom='auto';
      }
    });
  }catch{}

  let startX=0,startY=0,startL=0,startT=0,dragged=false,downAt=0,active=false;
  function getPoint(e){return e.touches?e.touches[0]:e;}
  function down(e){
    const p=getPoint(e);
    startX=p.clientX;startY=p.clientY;
    const r=f.getBoundingClientRect();
    startL=r.left;startT=r.top;
    dragged=false;active=true;downAt=Date.now();
    f.classList.add('dragging');
    f.style.transition='none';
  }
  function move(e){
    if(!active)return;
    const p=getPoint(e);
    const dx=p.clientX-startX,dy=p.clientY-startY;
    if(Math.abs(dx)>4||Math.abs(dy)>4)dragged=true;
    let nl=startL+dx,nt=startT+dy;
    const maxL=window.innerWidth-f.offsetWidth;
    const maxT=window.innerHeight-f.offsetHeight;
    nl=Math.max(0,Math.min(maxL,nl));
    nt=Math.max(0,Math.min(maxT,nt));
    f.style.left=nl+'px';f.style.top=nt+'px';
    f.style.right='auto';f.style.bottom='auto';
    if(dragged&&e.cancelable)e.preventDefault();
  }
  function up(){
    if(!active)return;
    active=false;
    f.classList.remove('dragging');
    f.style.transition='';
    if(dragged){
      const r=f.getBoundingClientRect();
      try{chrome.storage.local.set({fabPos:{left:r.left,top:r.top}});}catch{}
    } else if(Date.now()-downAt<400){
      ensurePanel();
      panel.classList.toggle('open');
      if(panel.classList.contains('open'))
        iframe.contentWindow.postMessage(makeMsg(MSG.HELLO,{role:'ext'}),'*');
    }
  }

  f.addEventListener('touchstart',down,{passive:true});
  f.addEventListener('touchmove',move,{passive:false});
  f.addEventListener('touchend',up);
  f.addEventListener('touchcancel',up);
  f.addEventListener('mousedown',down);
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);

  updateFab();
}
function updateFab(){const f=document.getElementById('mdsb-fab');if(!f)return;f.classList.toggle('autopilot',autopilot);f.textContent=autopilot?'A':'>';}

function setTextarea(txt){
  const ta=document.querySelector('textarea');
  if(!ta)return false;
  ta.focus();
  const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  s.call(ta,txt);
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
function injectPrompt(){setTextarea(SYSTEM_PROMPT);}
function clickSend(){
  const ta=document.querySelector('textarea');
  if(!ta)return false;
  const c=ta.closest('form')||(ta.parentElement&&ta.parentElement.parentElement);
  if(!c)return false;
  const btns=c.querySelectorAll('button');
  for(let i=btns.length-1;i>=0;i--){
    const b=btns[i];
    if(!b.disabled&&b.offsetParent!==null){b.click();return true;}
  }
  return false;
}

window.addEventListener('message',ev=>{
  const d=ev.data;
  if(!d||d.v!==VERSION)return;
  if(d.type===MSG.READY){pwaReady=true;return;}
  if(d.type===MSG.STREAM){
    const p=pending.get(d.payload.targetId);
    if(p&&p.onStream)p.onStream(d.payload);
    return;
  }
  if(d.type===MSG.RESULT||d.type===MSG.ERROR){
    const p=pending.get(d.payload.targetId);
    if(p){p.resolve(d.payload);pending.delete(d.payload.targetId);}
  }
});

function execInPwa(cmd,onStream){
  ensurePanel();
  if(!panel.classList.contains('open'))panel.classList.add('open');
  return new Promise((res,rej)=>{
    const id=Math.random().toString(36).slice(2,10);
    pending.set(id,{resolve:res,onStream});
    const sendExec=()=>{
      try{iframe.contentWindow.postMessage(makeMsg(MSG.EXEC,{cmd,timeout:180000},id),'*');}
      catch(e){pending.delete(id);rej(new Error('postMessage EXEC fallo: '+e.message));}
    };
    const waitReady=(tries)=>{
      if(pwaReady){sendExec();return;}
      if(tries<=0){pending.delete(id);rej(new Error('PWA no respondio READY (timeout 40s)'));return;}
      try{iframe.contentWindow.postMessage(makeMsg(MSG.HELLO,{role:'ext'}),'*');}
      catch(e){pending.delete(id);rej(new Error('postMessage HELLO fallo: '+e.message));return;}
      setTimeout(()=>waitReady(tries-1),800);
    };
    waitReady(50);
    setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout global 200s'));}},200000);
  });
}

function isCmd(t){
  t=t.trim();
  if(!t||t.length>4000)return false;
  if(/^(?:const|let|var|function|import|export|class|return|<\?|\/[a-z])/.test(t))return false;
  return /^(?:git|npm|node|ls|cd|cat|echo|mkdir|rm|cp|mv|curl|wget|grep|find|chmod|pwd|touch|head|tail|sed|awk|python|python3|pip|bash|sh|yarn|pnpm|tar|zip|unzip|which|whoami|env|export)\b/.test(t);
}

function findNew(){
  const r=[];
  document.querySelectorAll('pre code, pre').forEach(el=>{
    if(seen.has(el))return;
    if(el.closest('#mdsb-panel'))return;
    const t=el.textContent?el.textContent.trim():'';
    if(!isCmd(t))return;
    seen.add(el);
    r.push({el,cmd:t});
  });
  return r;
}

function decorate(el,cmd){
  if(el.dataset.mdsb==='1')return null;
  el.dataset.mdsb='1';
  const b=document.createElement('button');
  b.className='mdsb-run-btn';
  b.textContent='Ejecutar';
  b.onclick=()=>runBlock(b,cmd,{autoPaste:false});
  el.parentNode.insertBefore(b,el.nextSibling);
  return b;
}

async function runBlock(btn,cmd,opts){
  opts=opts||{};
  btn.disabled=true;
  btn.textContent='Ejecutando...';
  try{
    const r=await execInPwa(cmd,s=>{
      if(s.stream==='meta')btn.textContent=s.chunk.trim().slice(0,50);
    });
    if(r.exitCode===0){btn.textContent='Listo';btn.classList.add('done');}
    else{btn.textContent='exit '+r.exitCode;btn.classList.add('error');}
    const out=(r.stdout||'')+(r.stderr?'\n[stderr]\n'+r.stderr:'')+'\n[exit '+r.exitCode+']';
    if(opts.autoPaste){
      setTextarea('```plaintext\n'+out.trim()+'\n```');
      setTimeout(()=>clickSend(),400);
    }
    return r;
  } catch(e){
    btn.textContent='error';
    btn.classList.add('error');
    return {error:e};
  }
}

let busy=false;
async function runAuto(){
  if(!autopilot||busy)return;
  const bs=findNew();
  if(!bs.length)return;
  busy=true;
  try{
    for(const item of bs){
      const b=decorate(item.el,item.cmd);
      const t=b||item.el.nextElementSibling;
      if(t&&t.classList&&t.classList.contains('mdsb-run-btn'))
        await runBlock(t,item.cmd,{autoPaste:true});
      await new Promise(r=>setTimeout(r,1500));
    }
  } finally {
    busy=false;
  }
}

const mo=new MutationObserver(()=>{
  try{
    findNew().forEach(item=>decorate(item.el,item.cmd));
    if(autopilot)runAuto();
  } catch(e){console.error('[mdsb]',e);}
});
mo.observe(document.body,{childList:true,subtree:true});

loadAP();
setTimeout(()=>{ensureFab();ensurePanel();},500);
console.log('[mdsb] listo');
