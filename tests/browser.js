'use strict';
const output = document.getElementById('results');
const iframe = document.getElementById('app');
const results = [];
window.testResults = { done:false, results };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if(!value) throw new Error(message); };
const equal = (a,b,message) => assert(JSON.stringify(a)===JSON.stringify(b),message);
async function until(check, message, timeout=15000) {
  const start=performance.now();
  while(!check()) { if(performance.now()-start>timeout) throw new Error(message); await delay(25); }
}
async function test(name, body) {
  try { await body(); results.push({name,pass:true}); }
  catch(error) { results.push({name,pass:false,error:error.message}); }
  output.textContent=results.map(r => `${r.pass?'PASS':'FAIL'} ${r.name}${r.error?': '+r.error:''}`).join('\n');
}
(async () => {
  await until(() => iframe.contentWindow.jellyfishTest, 'Application did not initialize');
  const win=iframe.contentWindow, doc=win.document;
  const canvas=doc.getElementById('gl'), gl=canvas.getContext('webgl2');
  const api=win.jellyfishTest, snap=api.snapshot;
  const errors=[];
  win.addEventListener('error', e=>errors.push(e.message));
  const set=(id,value,event='input')=>{
    const el=doc.getElementById(id); el.value=value; el.dispatchEvent(new win.Event(event));
  };
  const hide=()=>win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));
  const show=()=>win.dispatchEvent(new win.PageTransitionEvent('pageshow',{persisted:true}));
  const nextFrames=async(n=2)=>{
    const start=snap().frames; await until(()=>snap().frames>=start+n,'Animation did not resume');
  };
  await test('WebGL2 starts, frames advance, all framebuffer attachments are complete',async()=>{
    await until(()=>snap().ready,'Renderer not ready'); await nextFrames();
    const r=api.resources();
    for(const name of ['fboScene','fboBloom1','fboBloom2']) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,r[name].fb);
      assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,name+' incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    assert(gl.getError()===gl.NO_ERROR,'GL error after startup');
  });
  await test('all presets and motion models render',async()=>{
    for(const button of doc.querySelectorAll('[data-preset]')) { button.click(); await nextFrames(); }
    for(const option of doc.getElementById('movementMode').options) {
      set('movementMode',option.value,'change'); await nextFrames();
      assert(gl.getError()===gl.NO_ERROR,'GL error for '+option.value);
    }
    assert(!snap().error,'Renderer error after presets');
  });
  await test('profile budgets, CSS resize, unchanged-size events avoid allocation',async()=>{
    for(const profile of ['quality','battery','balanced']) {
      set('performanceProfile',profile,'change'); await nextFrames();
      const s=snap(), p=api.policy.profiles[profile];
      assert(s.width*s.height<=p.maxPixels,profile+' pixel budget');
      assert(s.dpr<=p.maxDPR,profile+' DPR budget');
    }
    const before=snap();
    win.dispatchEvent(new win.Event('resize')); await nextFrames();
    assert(snap().allocations===before.allocations,'Unchanged size reallocated FBOs');
    const width=canvas.getBoundingClientRect().width;
    iframe.style.width='65%'; await delay(100); await nextFrames();
    assert(canvas.getBoundingClientRect().width<width,'Canvas CSS width frozen');
    iframe.style.width='100%'; await delay(100); await nextFrames();
  });
  await test('pagehide cancels animation; duplicate pageshow resumes safely without a time jump',async()=>{
    hide(); const before=snap(); await delay(200);
    equal(snap().state,before.state,'State moved while hidden');
    assert(snap().frames===before.frames && !snap().scheduled,'Loop survived pagehide');
    show(); show(); await nextFrames();
    assert(snap().time-before.time<0.15,'Hidden time entered simulation');
  });
  await test('visibilitychange stops and restarts (synthetic hidden flag)',async()=>{
    Object.defineProperty(doc,'hidden',{configurable:true,value:true});
    doc.dispatchEvent(new win.Event('visibilitychange'));
    const before=snap(); await delay(100);
    assert(snap().frames===before.frames&&!snap().scheduled,'Hidden document animated');
    delete doc.hidden; doc.dispatchEvent(new win.Event('visibilitychange')); await nextFrames();
  });
  const lose=gl.getExtension('WEBGL_lose_context');
  await test('WEBGL_lose_context is available (required, not silently skipped)',()=>assert(lose,'Extension unavailable'));
  if(lose) {
    await test('three real loss/restore cycles retain complete state and replace GPU objects while paused',async()=>{
      set('bellRadius',81); set('hueShift',37); set('glow',1.2); set('zoom',1.38);
      set('movementMode','jetting','change'); set('behaviorMode','manual','change');
      set('behaviorState','turn','change'); await nextFrames(); hide();
      for(let cycle=0;cycle<3;cycle++) {
        const before=snap(), old=api.resources();
        const lostEvent=new Promise(resolve=>canvas.addEventListener('webglcontextlost',resolve,{once:true}));
        lose.loseContext();
        const event=await lostEvent;
        assert(event.defaultPrevented,'Context loss not cancelled');
        assert(snap().lost&&!snap().scheduled,'Lost renderer kept running');
        await delay(100);
        equal(snap().state,before.state,'CPU state changed during loss');
        lose.restoreContext();
        await until(()=>snap().ready&&!snap().lost,'Restore failed');
        const after=snap(), fresh=api.resources();
        equal(after.state,before.state,'Settings, camera, behavior, motion or geometry reset');
        assert(after.time===before.time&&!after.scheduled,'Hidden restore advanced simulation');
        assert(after.generation===before.generation+1,'GPU generation did not advance');
        for(const key of Object.keys(old)) assert(fresh[key]&&fresh[key]!==old[key],key+' was not recreated');
        assert(gl.isProgram(fresh.pointProgram)&&gl.isBuffer(fresh.posBuffer)&&gl.isVertexArray(fresh.vao),'Invalid new GPU objects');
      }
      show(); await nextFrames(); assert(gl.getError()===gl.NO_ERROR,'GL error after restoration');
    });
    await test('visible recovery resumes, loss-time edits and resize survive',async()=>{
      const generation=snap().generation;
      lose.loseContext(); await until(()=>snap().lost,'Loss not handled');
      set('tentacles',22); set('hueShift',-44); set('performanceProfile','battery','change');
      iframe.style.width='85%'; const edited=snap();
      await delay(100); lose.restoreContext();
      await until(()=>snap().generation===generation+1,'Visible recovery failed'); await nextFrames();
      equal(snap().state.params,edited.state.params,'Edits during loss discarded');
      equal(snap().state.points,edited.state.points,'Geometry edits during loss discarded');
      assert(snap().profile==='battery'&&snap().scheduled,'Profile or animation not restored');
      iframe.style.width='100%';
    });
    await test('failed framebuffer restoration stops cleanly and retry preserves state',async()=>{
      hide(); const before=snap();
      lose.loseContext(); await until(()=>snap().lost,'Loss not handled');
      const original=gl.checkFramebufferStatus;
      gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_UNSUPPORTED;
      await delay(100); lose.restoreContext();
      await until(()=>snap().error,'Injected allocation error not reported');
      assert(!snap().ready&&!snap().scheduled,'Failed renderer still active');
      assert(!doc.getElementById('retryBtn').hidden,'No retry available');
      gl.checkFramebufferStatus=original;
      doc.getElementById('retryBtn').click();
      await until(()=>snap().ready,'Retry failed');
      equal(snap().state,before.state,'Retry changed settings');
      show(); await nextFrames();
    });
  }
  await test('PNG export after recovery contains a rendered scene',async()=>{
    await nextFrames();
    let href;
    const original=win.HTMLAnchorElement.prototype.click;
    win.HTMLAnchorElement.prototype.click=function(){href=this.href;};
    try {doc.getElementById('shotBtn').click();} finally {win.HTMLAnchorElement.prototype.click=original;}
    assert(href?.startsWith('data:image/png'),'PNG export missing');
    const image=new Image(); image.src=href; await image.decode();
    const sample=document.createElement('canvas'); sample.width=sample.height=128;
    const ctx=sample.getContext('2d'); ctx.drawImage(image,0,0,128,128);
    const data=ctx.getImageData(0,0,128,128).data;
    let min=255,max=0;
    for(let i=0;i<data.length;i+=4) {min=Math.min(min,data[i]+data[i+1]+data[i+2]);max=Math.max(max,data[i]+data[i+1]+data[i+2]);}
    assert(max-min>30,'Export is blank or flat');
  });
  await test('no unhandled browser errors or residual WebGL errors',()=>{
    assert(errors.length===0,errors.join('; ')); assert(gl.getError()===gl.NO_ERROR,'Residual GL error');
  });
  window.testResults={done:true,results,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},snapshot:snap()};
})().catch(error=>{output.textContent+='\nFATAL '+error.stack;window.testResults={done:true,results:[...results,{name:'harness',pass:false,error:error.message}]};});
