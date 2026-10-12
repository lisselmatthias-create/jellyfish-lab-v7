import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = html.slice(html.indexOf('  const PERFORMANCE_PROFILES'), html.indexOf('  // END PERFORMANCE POLICY'));
const { renderSize, createPerformanceMeter, measureFrame, profiles } = runInNewContext(policy +
  '\n({renderSize, createPerformanceMeter, measureFrame, profiles:PERFORMANCE_PROFILES})');
function simulate(fps, seconds, scale=1, target=60) {
  const meter = createPerformanceMeter();
  let result;
  for(let i=0; i<fps*seconds; i++) {
    const sample = measureFrame(meter, 1000/fps, target, scale);
    if(sample) { result=sample; scale=sample.scale; }
  }
  return { scale, result, meter };
}

test('standalone application parses without dependencies', () => {
  new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=["']https?:/);
});

test('portrait, landscape, desktop and 4K stay inside profile and GPU budgets', () => {
  for(const [w,h] of [[1,1],[390,844],[820,1180],[1180,820],[2560,1440],[3840,2160],[7680,4320]]) {
    for(const dpr of [1,1.25,2,3]) for(const profile of Object.values(profiles)) {
      const size = renderSize(w,h,dpr,1,profile,[4096,4096]);
      assert.ok(size.width>=1 && size.height>=1);
      assert.ok(size.width<=4096 && size.height<=4096);
      assert.ok(size.width*size.height<=profile.maxPixels);
      assert.ok(size.dpr<=dpr && size.dpr<=profile.maxDPR);
      const low = renderSize(w,h,dpr,0.5,profile,[4096,4096]);
      assert.ok(low.width<=size.width && low.height<=size.height);
    }
  }
});

test('dimension limits apply independently; zero CSS sizes remain valid', () => {
  const size = renderSize(10000,400,3,1,profiles.quality,[2048,1024]);
  assert.equal(size.width,2048);
  assert.ok(size.height<=1024);
  const tiny=renderSize(0,0,0,0.5,profiles.balanced,[4096,4096]);
  assert.equal(tiny.width,1); assert.equal(tiny.height,1);
});

test('sustained overload reduces resolution but never below 50 percent', () => {
  assert.ok(simulate(24,8).scale<1);
  assert.equal(simulate(10,90).scale,0.5);
});

test('a single slow frame does not trigger reallocation', () => {
  const meter=createPerformanceMeter(); meter.warmup=0;
  let scale=1;
  for(const interval of [250,...Array(180).fill(1000/60)]) {
    const result=measureFrame(meter,interval,60,scale);
    if(result) scale=result.scale;
  }
  assert.equal(scale,1);
});

test('recovery is gradual and capped at native budget', () => {
  assert.equal(simulate(60,6,0.6).scale,0.6);
  assert.ok(simulate(60,14,0.6).scale>0.6);
  assert.equal(simulate(60,100,0.95).scale,1);
});

test('battery 30 fps is healthy; high-refresh samples do not over-allocate', () => {
  assert.equal(simulate(30,20,1,30).scale,1);
  assert.equal(simulate(120,20,1,60).scale,1);
});

test('FPS uses wall time even below 20 fps, with a real P95 interval', () => {
  const {result}=simulate(5,5);
  assert.equal(result.fps,5); assert.equal(result.p95,200);
});

test('resume warmup and invalid samples never become FPS or pressure data', () => {
  const meter=createPerformanceMeter();
  for(const interval of [0,-1,NaN,Infinity,500,500]) assert.equal(measureFrame(meter,interval,60,1),null);
  assert.equal(meter.frames,0); assert.equal(meter.elapsed,0);
});
