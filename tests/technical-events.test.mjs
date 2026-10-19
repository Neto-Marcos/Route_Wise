import test from 'node:test';
import assert from 'node:assert/strict';
import {technicalPath,validateTechnicalEvent} from '../lib/technical-events.ts';
test('telemetry strips query strings, IDs and arbitrary payload fields',()=>{
  const event=validateTechnicalEvent({kind:'upload_failure',path:'/api/routes/abcdef01-2345-6789-abcd-123456789012?token=SECRET',message:'private customer address'});
  assert.deepEqual(event,{kind:'upload_failure',path:'/api/routes/:id'});
  assert.equal(technicalPath('/api/orders/12345#private'),'/api/orders/:number');
});
test('only known kinds and relative paths are accepted',()=>{
  for(const value of [null,{kind:'other',path:'/'},{kind:'api_failure',path:'https://third.party/'},{kind:'api_failure',path:'//third.party/'}])assert.equal(validateTechnicalEvent(value),null);
});
