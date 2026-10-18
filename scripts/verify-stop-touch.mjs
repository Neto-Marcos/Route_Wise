import assert from 'node:assert/strict';

const endpoint = process.env.HOTFIX_CDP_URL;
if (!endpoint || !endpoint.startsWith('ws://127.0.0.1:')) throw new Error('Observed local browser CDP endpoint required');
const socket = new WebSocket(endpoint);
await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
let counter=0;
const pending = new Map();
socket.onmessage = event => {
  const result = JSON.parse(event.data);
  const task = pending.get(result.id);
  if (!task) return;
  pending.delete(result.id);
  result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result);
};
const send = (method,params={},sessionId) => new Promise((resolve,reject) => {
  const id=++counter; pending.set(id,{resolve,reject});
  socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});
try {
  const {targetInfos}=await send('Target.getTargets');
  const target=targetInfos.find(target=>target.type==='page' && target.url.startsWith('http://127.0.0.1:3004/'));
  assert.ok(target,'Only the isolated hotfix tab may be controlled');
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const command=(method,params)=>send(method,params,sessionId);
  const evaluate=async expression => {
    const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(value.exceptionDetails) throw new Error(value.exceptionDetails.text);
    return value.result.value;
  };
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  let before=[];
  const deadline=Date.now()+20000;
  while(Date.now()<deadline) {
    before=await evaluate('Array.from(document.querySelectorAll(".stop-item-name")).map(row=>row.textContent)');
    if(before.length===4) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(before.length,4);
  const points=await evaluate(`Array.from(document.querySelectorAll('.stop-drag-handle')).map(element=>{
    const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})`);
  assert.ok(points.length>=2);
  const touch=(type,point)=>command('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1,radiusX:2,radiusY:2}]:[]});
  await touch('touchStart',points[1]);
  for(let step=1;step<=8;step++) await touch('touchMove',{
    x:points[1].x,y:points[1].y+(points[0].y-points[1].y)*step/8});
  await touch('touchEnd');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const after=await evaluate('Array.from(document.querySelectorAll(".stop-item-name")).map(row=>row.textContent)');
  assert.deepEqual(after,[before[0],before[2],before[1],before[3]]);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true,'No horizontal overflow');
  const scrollState = () => evaluate('Array.from(document.querySelectorAll("*" )).filter(e=>e.scrollHeight>e.clientHeight).map(e=>e.scrollTop).concat(window.scrollY)');
  const scrollBefore = await scrollState();
  const row = await evaluate(`(()=>{const e=document.querySelectorAll('.stop-item-info')[2],b=e.getBoundingClientRect();
    return {x:b.x+b.width/2,y:Math.min(b.y+b.height/2,700)};})()`);
  await touch('touchStart',row);
  for(let step=1;step<=8;step++) {
    await touch('touchMove',{x:row.x,y:row.y-step*20});
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await touch('touchEnd');
  await new Promise(resolve=>setTimeout(resolve,150));
  const scrollAfter = await scrollState();
  assert.notDeepEqual(scrollAfter,scrollBefore,'Touch outside handle scrolls normally');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".stop-item-name")).map(row=>row.textContent)'),after);
  console.log(JSON.stringify({touch:'PASS',normalScroll:'PASS',viewport:'390x844',originFixed:true,before,after}));
} finally { socket.close(); }
