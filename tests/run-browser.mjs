// Node >= 22 + an existing Chromium/Chrome installation. No npm dependencies.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)) {res.writeHead(403).end();return;}
    const data=await readFile(path);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript'})[extname(path)]||'text/plain');
    res.end(data);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const userData=await mkdtemp(join(tmpdir(),'jellyfish-chrome-'));
const args=['--headless','--no-first-run','--disable-dev-shm-usage','--enable-unsafe-swiftshader',
  '--use-angle=swiftshader','--remote-debugging-pipe',`--user-data-dir=${userData}`];
if(process.env.CHROME_NO_SANDBOX==='1') args.push('--no-sandbox');
const browser=spawn(process.env.CHROME_BIN||'chromium',args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
let stderr='',id=0,buffer='';
const pending=new Map();
browser.stderr.on('data',data=>{stderr=(stderr+data).slice(-5000);});
function rejectAll(error){for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(error);}pending.clear();}
browser.on('error',rejectAll);
browser.on('exit',code=>rejectAll(new Error('Browser exited '+code+'\n'+stderr)));
browser.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();
  let end;
  while((end=buffer.indexOf('\0'))>=0){
    const packet=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    const request=pending.get(packet.id);
    if(request){pending.delete(packet.id);clearTimeout(request.timer);packet.error?request.reject(new Error(JSON.stringify(packet.error))):request.resolve(packet.result);}
  }
});
function send(method,params={},sessionId){
  return new Promise((resolve,reject)=>{
    const requestId=++id;
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('CDP timeout: '+method));},30000);
    pending.set(requestId,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id:requestId,method,params,sessionId})+'\0');
  });
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const summaries=[];
try {
  const version=await send('Browser.getVersion');
  console.log('Browser:',version.product,'(SwiftShader; not a physical GPU benchmark)');
  const profiles=[
    {name:'desktop',width:2560,height:1440,deviceScaleFactor:1,cpu:1},
    {name:'tablet-portrait',width:820,height:1180,deviceScaleFactor:2,cpu:1},
    {name:'tablet-landscape-throttled',width:1180,height:820,deviceScaleFactor:2,cpu:4},
    {name:'4k',width:3840,height:2160,deviceScaleFactor:1,cpu:1},
    {name:'phone-dpr3',width:390,height:844,deviceScaleFactor:3,cpu:1}
  ];
  for(const profile of profiles){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width:profile.width,height:profile.height,deviceScaleFactor:profile.deviceScaleFactor,mobile:false},sessionId);
    await send('Emulation.setCPUThrottlingRate',{rate:profile.cpu},sessionId);
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tests/browser.html`},sessionId);
    const start=Date.now();
    let result;
    while(Date.now()-start<120000){
      const {result:remote}=await send('Runtime.evaluate',{expression:'window.testResults?.done ? JSON.stringify(window.testResults) : null',returnByValue:true},sessionId);
      if(remote.value){result=JSON.parse(remote.value);break;}
      await delay(250);
    }
    if(!result) throw new Error('Suite timed out: '+profile.name);
    const summary={profile:profile.name,viewport:result.viewport,results:result.results};
    summaries.push(summary);
    for(const test of result.results) console.log(`${test.pass?'PASS':'FAIL'} [${profile.name}] ${test.name}${test.error?': '+test.error:''}`);
    if(process.env.TEST_SCREENSHOT && profile.name==='desktop') {
      // Capture the application, not the test page, for optional visual review.
      await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html`},sessionId);
      await delay(1000);
      const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);
      await writeFile(process.env.TEST_SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    await send('Target.closeTarget',{targetId});
  }
  if(process.env.TEST_REPORT) await writeFile(process.env.TEST_REPORT,JSON.stringify({browser:version.product,summaries},null,2)+'\n');
  const failed=summaries.flatMap(s=>s.results).filter(r=>!r.pass);
  console.log(`${summaries.flatMap(s=>s.results).length-failed.length} passed, ${failed.length} failed`);
  if(failed.length) process.exitCode=1;
} catch(error){console.error(error);process.exitCode=1;}
finally {
  browser.kill();
  server.close();
  await rm(userData,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
