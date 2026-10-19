import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
const origin=process.env.MONITOR_URL;
if(!origin?.startsWith('https://') || !process.env.MONITOR_TOKEN) throw new Error('Monitor URL/token required');
const s3=new S3Client({region:process.env.BACKUP_REGION||'auto',endpoint:process.env.BACKUP_ENDPOINT,credentials:{accessKeyId:process.env.BACKUP_ACCESS_KEY_ID||'',secretAccessKey:process.env.BACKUP_SECRET_ACCESS_KEY||''}});
const bucket=process.env.BACKUP_BUCKET, stateKey='criar-rota/monitor/state.json';
async function read(key){try{const r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));return JSON.parse(await r.Body.transformToString());}catch(error){if(error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404)return null;throw error;}}
async function health(path,authorized=false){
  const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(8000),headers:authorized?{Authorization:`Bearer ${process.env.MONITOR_TOKEN}`}:{}});
  if(!response.ok)throw new Error(path+'/status-'+response.status);
  const data=await response.json();if(data.status!=='ok')throw new Error(path+'/not-ready');
}
try {
  let failures=[];
  for(let attempt=0;attempt<3;attempt++){
    failures=[];
    for(const [path,auth]of [['/api/health',false],['/api/health/monitor',true]]){
      try{await health(path,auth);}catch{failures.push(path);}
    }
    if(!failures.length)break;
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,10000));
  }
  const backup=await read('criar-rota/database/latest.json');
  if(!backup?.restoreVerified || !Number.isFinite(Date.parse(backup.completedAt)) || Date.now()-Date.parse(backup.completedAt)>36*3600000)failures.push('backup-not-verified-or-stale');
  const old=await read(stateKey),now=Date.now();
  const alert=failures.length>0&&(!old?.failed||now-(old.lastAlert||0)>6*3600000);
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:stateKey,Body:JSON.stringify({checkedAt:new Date(now).toISOString(),failed:failures.length>0,lastAlert:alert?now:old?.lastAlert||0}),ContentType:'application/json'}));
  console.log(JSON.stringify({event:failures.length?'monitor_unhealthy':old?.failed?'monitor_recovered':'monitor_healthy',failures,alert,backupVerified:!!backup?.restoreVerified}));
  if(alert)process.exitCode=1; // Railway crash notification targets the owner's user rule.
} catch(error) {
  console.error(JSON.stringify({event:'monitor_failed',error:error.name}));process.exitCode=1;
} finally{s3.destroy();}
