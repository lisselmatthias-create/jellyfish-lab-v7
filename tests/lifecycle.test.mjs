import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Deterministic DOM/GL doubles test scheduling and failure paths, not rendering.
// Real WebGL behavior is covered separately by browser.html + WEBGL_lose_context.
function fixture({shaderFailure=false}={}) {
  function target(extra={}) {
    const listeners=new Map();
    return Object.assign({
      value:'',textContent:'',style:{},hidden:false,disabled:false,
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
      removeEventListener(){},
      emit(type,extra={}){const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of listeners.get(type)||[])fn(event);return event;},
      click(){this.emit('click');},
    },extra);
  }
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],target()]));
  for(const m of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]+)"/g)) elements.get(m[1]).value=m[2];
  const settings={lost:false,failFBO:false,failShader:shaderFailure,epoch:0,width:1200,height:900,draws:0};
  const live=new Set(); let constant=100;
  const constants=new Map();
  const gl=new Proxy({}, {get(_,name){
    if(/^[A-Z_0-9]+$/.test(name)){if(!constants.has(name)) constants.set(name,constant++);return constants.get(name);}
    if(name==='isContextLost')return()=>settings.lost;
    return (...args)=>{
      assert.equal(settings.lost,false,'GL call while context lost: '+name);
      if(name.startsWith('create')){const object={kind:name.slice(6),epoch:settings.epoch};live.add(object);return object;}
      if(name.startsWith('delete')){live.delete(args[0]);return;}
      if(name==='getShaderParameter')return !settings.failShader;
      if(name==='getError')return gl.NO_ERROR;
      if(name==='getShaderInfoLog')return 'injected shader failure';
      if(name==='getProgramParameter')return args[1]===gl.ACTIVE_UNIFORMS?0:true;
      if(name==='getParameter')return args[0]===gl.MAX_VIEWPORT_DIMS?[4096,4096]:4096;
      if(name==='checkFramebufferStatus')return settings.failFBO?gl.FRAMEBUFFER_UNSUPPORTED:gl.FRAMEBUFFER_COMPLETE;
      if(name==='drawArrays')settings.draws++;
      for(const arg of args) if(arg&&typeof arg==='object'&&'epoch' in arg) {
        assert.equal(arg.epoch,settings.epoch,'Stale handle used by '+name);
        assert.ok(live.has(arg),'Deleted handle used by '+name);
      }
    };
  }});
  const canvas=elements.get('gl');
  canvas.getContext=()=>gl;
  canvas.getBoundingClientRect=()=>({width:settings.width,height:settings.height});
  const document=target({hidden:false,getElementById:id=>elements.get(id),querySelectorAll:()=>[],body:target()});
  const window=target({devicePixelRatio:2,matchMedia:()=>target(),visualViewport:target()});
  let serial=0,clock=0;
  const queue=new Map();
  const context=vm.createContext({document,window,performance:{now:()=>clock},URLSearchParams,
    location:{search:'?test=1'},console:{error(){}},Float32Array,
    requestAnimationFrame:fn=>{const id=++serial;queue.set(id,fn);return id;},
    cancelAnimationFrame:id=>queue.delete(id)});
  vm.runInContext(script,context);
  const snap=()=>JSON.parse(JSON.stringify(window.jellyfishTest.snapshot()));
  function tick(ms=1000/60){clock+=ms;const jobs=[...queue.values()];queue.clear();for(const job of jobs)job(clock);}
  function lose(){settings.lost=true;live.clear();return canvas.emit('webglcontextlost');}
  function restore(){settings.lost=false;settings.epoch++;canvas.emit('webglcontextrestored');}
  return {settings,live,canvas,document,window,elements,queue,snap,tick,lose,restore};
}

test('only one RAF exists across repeated visibility and page transitions',()=>{
  const f=fixture(); f.tick();
  for(let i=0;i<10;i++){
    f.window.emit('pageshow'); f.document.emit('visibilitychange');
    assert.equal(f.queue.size,1);
  }
  f.document.hidden=true;f.document.emit('visibilitychange');
  const before=f.snap();assert.equal(f.queue.size,0);
  f.tick(30000);assert.deepEqual(f.snap().state,before.state);
  f.document.hidden=false;f.document.emit('visibilitychange');f.tick();
  assert.equal(f.snap().time,before.time,'First resumed frame must have dt=0');
  assert.equal(f.queue.size,1);
});

test('loss cancels RAF and rebuilds every GPU object without changing CPU state',()=>{
  const f=fixture();f.tick();f.tick();f.window.emit('pagehide');const before=f.snap();
  for(let i=0;i<5;i++){
    assert.equal(f.lose().defaultPrevented,true);assert.equal(f.queue.size,0);
    f.elements.get('shotBtn').click();f.window.emit('resize');f.tick(5000);
    f.restore();assert.equal(f.queue.size,0);
    assert.deepEqual(f.snap().state,before.state);assert.equal(f.snap().time,before.time);
    assert.equal(f.snap().generation,before.generation+i+1);
    assert.equal(f.live.size,15,'No leaked shaders or old GPU resources');
  }
  f.window.emit('pageshow');f.tick();assert.equal(f.queue.size,1);
});

test('edits and resized viewport during loss survive restoration',()=>{
  const f=fixture();f.lose();
  f.elements.get('bellRadius').value='88';f.elements.get('bellRadius').emit('input');
  f.settings.width=600;f.settings.height=1000;f.window.emit('resize');
  const edited=f.snap().state;f.restore();
  assert.deepEqual(f.snap().state,edited);assert.equal(f.canvas.width,1200);assert.equal(f.canvas.height,2000);
});

test('unchanged resize allocates nothing; orientation and DPR changes do',()=>{
  const f=fixture();f.tick();const before=f.snap().allocations;
  f.window.emit('resize');f.tick();assert.equal(f.snap().allocations,before);
  f.settings.width=500;f.settings.height=1000;f.window.emit('resize');f.tick();
  assert.equal(f.canvas.width,1000);assert.equal(f.canvas.height,2000);
  f.window.devicePixelRatio=1;f.window.emit('resize');f.tick();assert.equal(f.canvas.width,500);
  assert.equal(f.live.size,15,'Resize leaked framebuffer objects');
});

test('framebuffer restore failure is recoverable and releases partial allocations',()=>{
  const f=fixture();f.tick();f.window.emit('pagehide');const before=f.snap();
  f.lose();f.settings.failFBO=true;f.restore();
  assert.equal(f.snap().ready,false);assert.match(f.snap().error,/Framebuffer incomplete/);
  assert.equal(f.queue.size,0);assert.equal(f.live.size,0);
  f.settings.failFBO=false;f.elements.get('retryBtn').click();
  assert.equal(f.snap().ready,true);assert.deepEqual(f.snap().state,before.state);
  assert.equal(f.queue.size,0);
});

test('shader startup failure releases partial resources and supports retry',()=>{
  const f=fixture({shaderFailure:true});assert.equal(f.snap().ready,false);
  assert.equal(f.live.size,0);assert.equal(f.queue.size,0);
  f.settings.failShader=false;f.elements.get('retryBtn').click();f.tick();
  assert.equal(f.snap().ready,true);assert.equal(f.queue.size,1);
});

test('battery profile limits rendering on 60Hz and measures the effective 30fps',()=>{
  const f=fixture();f.elements.get('performanceProfile').value='battery';f.elements.get('performanceProfile').emit('change');
  for(let i=0;i<301;i++)f.tick();
  assert.ok(f.snap().frames>=149&&f.snap().frames<=152);
  assert.ok(Math.abs(f.snap().fps-30)<0.01);
});

test('prolonged slow frames are reported honestly and lower resolution',()=>{
  const f=fixture();for(let i=0;i<100;i++)f.tick(100);
  assert.equal(f.snap().fps,10);assert.ok(f.snap().scale<1);
  assert.equal(f.queue.size,1);
});


test('60fps pacing remains near target at 90, 120 and 144Hz',()=>{
  for(const refresh of [90,120,144]){
    const f=fixture();for(let i=0;i<refresh*3;i++)f.tick(1000/refresh);
    assert.ok(f.snap().frames>=179&&f.snap().frames<=181,`${refresh} Hz: ${f.snap().frames} frames`);
    assert.ok(f.snap().scale===1,'Refresh cadence caused a false downgrade');
  }
});
