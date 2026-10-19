import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, clearQueue, flushQueue, getQueueItems } from '../lib/offline.ts';
test('proof survives more than ten server errors and succeeds when server recovers',async()=>{
  await clearQueue();const original=globalThis.fetch;
  try{
    await enqueue({url:'/api/routes/test/stops/test/deliver',body:{photoBase64:'TEST_PROOF'}});
    globalThis.fetch=async()=>new Response('{}',{status:503});
    for(let i=0;i<12;i++) await flushQueue();
    const items=await getQueueItems();assert.equal(items.length,1);assert.equal(items[0].body.photoBase64,'TEST_PROOF');assert.equal(items[0].attempts,12);
    globalThis.fetch=async()=>new Response('{}',{status:200});assert.equal(await flushQueue(),1);assert.equal((await getQueueItems()).length,0);
  }finally{globalThis.fetch=original;await clearQueue();}
});
test('validation rejection retains evidence instead of silently deleting it',async()=>{
  await clearQueue();const original=globalThis.fetch;
  try{await enqueue({url:'/api/test',body:{photoBase64:'EVIDENCE'}});globalThis.fetch=async()=>new Response('{}',{status:422});await flushQueue();assert.equal((await getQueueItems())[0].body.photoBase64,'EVIDENCE');}
  finally{globalThis.fetch=original;await clearQueue();}
});
