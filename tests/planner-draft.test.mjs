import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlannerDraft, writePlannerDraft, removePlannerDraft, draftKey } from '../lib/planner-draft.ts';
const storage = () => { const data = new Map(); return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
const draft = (scope='company-a:user-a',revision='revision-1') => ({version:1,revision,scope,savedAt:Date.now(),routeName:'Rota João Pessoa',routeDate:'2026-10-19',circular:false,optimizeBy:'manual',routeId:'route-a',stops:[{id:'origin',name:'Base',address:'Campina Grande',lat:-7.23,lng:-35.88,is_origin:true},{id:'delivery',name:'Cliente',address:'João Pessoa',lat:-7.12,lng:-34.84,order_ids:['12345'],volume_m3:1.234}],baselineStops:[],routingTransfer:{routingProof:{token:'test-only-proof'}}});
test('draft round trip preserves order numbers, coordinates and edit identity',()=>{
  const s=storage(),value=draft();assert.equal(writePlannerDraft(s,value,null).status,'saved');assert.deepEqual(readPlannerDraft(s,value.scope),value);
});
test('company and user boundaries never share drafts',()=>{
  const s=storage();writePlannerDraft(s,draft(),null);
  assert.equal(readPlannerDraft(s,'company-b:user-a'),null);assert.equal(readPlannerDraft(s,'company-a:user-b'),null);
  s.setItem(draftKey('company-b:user-a'),JSON.stringify(draft()));assert.equal(readPlannerDraft(s,'company-b:user-a'),null);
});
test('a second tab cannot silently overwrite or delete a newer draft',()=>{
  const s=storage();writePlannerDraft(s,draft(),null);assert.equal(writePlannerDraft(s,draft(undefined,'revision-2'),null).status,'conflict');
  assert.equal(writePlannerDraft(s,draft(undefined,'revision-2'),'revision-1').status,'saved');assert.equal(removePlannerDraft(s,draft().scope,'revision-1'),false);
  assert.equal(readPlannerDraft(s,draft().scope).revision,'revision-2');assert.equal(removePlannerDraft(s,draft().scope,'revision-2'),true);
});
test('invalid, expired or future drafts are rejected',()=>{
  for(const transform of [v=>({...v,version:2}),v=>({...v,stops:[{name:'Bad',address:'x',lat:200,lng:0}]}),v=>({...v,savedAt:0}),v=>({...v,savedAt:Date.now()+120000}),v=>({...v,routeDate:'invalid'})]){
    const s=storage(),v=transform(draft());s.setItem(draftKey(v.scope),JSON.stringify(v));assert.equal(readPlannerDraft(s,v.scope),null);
  }
  const s=storage();s.setItem(draftKey(draft().scope),'{broken');assert.equal(readPlannerDraft(s,draft().scope),null);
});
test('storage failure does not report a false successful save',()=>{
  const s=storage();s.setItem=()=>{throw new Error('QuotaExceededError')};assert.throws(()=>writePlannerDraft(s,draft(),null),/Quota/);
});
