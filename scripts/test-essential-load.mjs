// Destructive fixture setup is allowed ONLY on a dedicated localhost test DB.
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {SignJWT} from 'jose';
import bcrypt from 'bcryptjs';
const url=new URL(process.env.ESSENTIAL_TEST_DATABASE_URL||'http://invalid');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/criarrota_[a-z0-9_]+_test$/.test(url.pathname))throw new Error('Dedicated localhost criarrota_*_test database required; production is forbidden');
const secret=randomBytes(32).toString('hex'),monitorToken=randomBytes(32).toString('hex'),base='http://127.0.0.1:3140';
const db=new pg.Client({connectionString:url.toString()});
let server,output='';
const durations=[];
async function request(path,cookie,body){const start=performance.now();const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'X-RouteWise-Role':'driver','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});durations.push(performance.now()-start);return response;}
try{
  await db.connect();
  const existing=await db.query("SELECT to_regclass('public.routes') AS table");
  if(existing.rows[0].table)throw new Error('Fixture database must be empty; refusing to alter existing data');
  await db.query('CREATE TABLE schema_migrations(filename text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
  for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort()){
    // Never run the legacy fixed-credential seed, even in fixtures.
    if(file!=='0008_superadmin_marcos.sql')await db.query((await readFile('db/migrations/'+file,'utf8')).replace(/^\uFEFF/,''));
    await db.query('INSERT INTO schema_migrations(filename)VALUES($1)',[file]);
  }
  const companies=[randomUUID(),randomUUID()],people=[];
  const hash=await bcrypt.hash(randomUUID(),4);
  for(let c=0;c<2;c++){
    await db.query('INSERT INTO companies(id,code,name)VALUES($1,$2,$3)',[companies[c],'LOAD_'+randomUUID().slice(0,8),'Synthetic company '+c]);
    for(let i=0;i<25;i++){
      const driver=randomUUID(),route=randomUUID(),stop=randomUUID();
      await db.query('INSERT INTO drivers(id,name,pin_hash,company_id)VALUES($1,$2,$3,$4)',[driver,'Synthetic driver '+c+'-'+i,hash,companies[c]]);
      await db.query("INSERT INTO routes(id,name,route_date,status,driver_id,company_id)VALUES($1,$2,current_date,'active',$3,$4)",[route,'Synthetic route '+c+'-'+i,driver,companies[c]]);
      await db.query("INSERT INTO route_stops(route_id,position,name,address,lat,lng,is_origin)VALUES($1,0,'Base','Synthetic base',-7.23,-35.88,true)",[route]);
      await db.query("INSERT INTO route_stops(id,route_id,position,name,address,lat,lng,is_origin)VALUES($1,$2,1,'Delivery','Synthetic address',-7.12,-34.84,false)",[stop,route]);
      const token=await new SignJWT({role:'driver',userRole:'driver',companyId:companies[c],driverId:driver}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      people.push({company:c,driver,route,stop,cookie:'rw_driver_session='+token});
    }
  }
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3140','-H','127.0.0.1'],{env:{...process.env,DATABASE_URL:url.toString(),SESSION_SECRET:secret,MONITOR_TOKEN:monitorToken,APP_ENV:'essential-load-test',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>output=(output+data).slice(-8000));server.stderr.on('data',data=>output=(output+data).slice(-8000));
  const deadline=Date.now()+60000;let ready=false;
  while(Date.now()<deadline){try{if((await fetch(base+'/api/version')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}
  assert(ready,'Isolated application did not become ready');
  const started=performance.now();
  await Promise.all(people.map(async person=>{
    const list=await request('/api/routes',person.cookie);assert.equal(list.status,200);const routes=await list.json();assert.equal(routes.length,1);assert.equal(routes[0].id,person.route);
    const detail=await request('/api/routes/'+person.route,person.cookie);assert.equal(detail.status,200);
    const other=people.find(p=>p.company!==person.company);
    const foreign=await request('/api/routes/'+other.route,person.cookie);assert([403,404].includes(foreign.status));
    const location={operationId:randomUUID(),lat:-7.12,lng:-34.84,recordedAt:new Date().toISOString()};
    assert.equal((await request('/api/routes/'+person.route+'/location',person.cookie,location)).status,200);
    assert([403,404].includes((await request('/api/routes/'+other.route+'/location',person.cookie,{...location,operationId:randomUUID()})).status));
    const proof={operationId:randomUUID(),lat:-7.12,lng:-34.84,photoBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=',photoContentType:'image/png'};
    const deliveries=await Promise.all([request(`/api/routes/${person.route}/deliveries/${person.stop}/complete`,person.cookie,proof),request(`/api/routes/${person.route}/deliveries/${person.stop}/complete`,person.cookie,proof)]);
    for(const response of deliveries)assert.equal(response.status,200);
    assert([403,404].includes((await request(`/api/routes/${other.route}/deliveries/${other.stop}/complete`,person.cookie,{...proof,operationId:randomUUID()})).status));
  }));
  assert.equal(Number((await db.query('SELECT count(*) FROM delivery_events')).rows[0].count),50,'Proof idempotency failed');
  assert.equal(Number((await db.query('SELECT count(*) FROM location_points')).rows[0].count),50,'Unauthorized GPS write or duplicate');
  assert.equal(Number((await db.query('SELECT count(*) FROM upload_objects')).rows[0].count),50,'Rejected cross-company request created an orphan upload');
  const unauthorized=await db.query('SELECT count(*) FROM location_points l JOIN routes r ON r.id=l.route_id WHERE l.driver_id<>r.driver_id');assert.equal(Number(unauthorized.rows[0].count),0);
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/health/monitor')).status,401);
  assert.equal((await fetch(base+'/api/health/monitor',{headers:{Authorization:'Bearer '+monitorToken}})).status,200);
  const rejected=await fetch(base+'/api/telemetry/client-error',{method:'POST',headers:{Origin:'not-an-origin',Cookie:people[0].cookie,'X-RouteWise-Role':'driver','Content-Type':'application/json'},body:'{}'});assert.equal(rejected.status,403);
  for(let i=0;i<5;i++)assert.equal((await request('/api/telemetry/client-error',people[0].cookie,{kind:'api_failure',path:'/api/routes/'+randomUUID()+'?token=PRIVATE',message:'MUST_NOT_BE_STORED'})).status,204);
  assert.equal((await request('/api/telemetry/client-error',people[0].cookie,{kind:'api_failure',path:'/api/test'})).status,429);
  assert.equal((await fetch(base+'/api/health/monitor',{headers:{Authorization:'Bearer '+monitorToken}})).status,503);
  const events=await db.query("SELECT details FROM audit_log WHERE entity_type='technical_event'");assert.equal(events.rows.length,5);assert(!JSON.stringify(events.rows).includes('PRIVATE'));assert(!JSON.stringify(events.rows).includes('MUST_NOT_BE_STORED'));
  durations.sort((a,b)=>a-b);
  const result={status:'PASS',drivers:50,companies:2,concurrentUsers:50,requests:durations.length,durationMs:Math.round(performance.now()-started),p95Ms:Math.round(durations[Math.floor(durations.length*.95)]),proofs:50,duplicateProofs:0,unauthorizedWrites:0,environment:'isolated localhost PostgreSQL; not a production capacity certification'};
  await mkdir('.tools',{recursive:true});await writeFile('.tools/essential-load.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error);if(output)console.error(output);process.exitCode=1;}
finally{server?.kill('SIGTERM');await db.end().catch(()=>{});}
