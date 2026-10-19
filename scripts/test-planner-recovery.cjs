const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=process.env.RELEASE_TEST_URL||'http://127.0.0.1:3136';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw new Error('Isolated localhost required');
const data={id:'test-route',name:'Rota original',route_date:'2026-10-19',status:'draft',deliveries:1,delivered:0,stops:[{id:'base',position:0,name:'Base',address:'Campina Grande',lat:-7.23,lng:-35.88,is_origin:true},{id:'delivery',position:1,name:'Cliente',address:'João Pessoa',lat:-7.12,lng:-34.84,is_origin:false,order_ids:['12345']}]};
(async()=>{
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
  let company='company-a',user='user-a',saved=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/telemetry/client-error')return route.fulfill({status:204,body:''});
   let result=[];
   if(url.pathname==='/api/session/me')result={authenticated:true,role:'dispatcher',userRole:'admin',companyId:company,dispatcherId:user,companyName:'Synthetic company',companyCode:'TEST'};
   else if(url.pathname==='/api/routes')result=[data];
   else if(url.pathname.startsWith('/api/routes/test-route')){result=data;if(route.request().method()==='PUT'){saved++;const body=route.request().postDataJSON();assert.equal(body.expectedStopIds.join(','),'base,delivery');assert.equal(body.stops[1].order_ids[0],'12345');}}
   else if(url.pathname.startsWith('/api/osrm/'))result={code:'Ok',routes:[{distance:120000,duration:7200,geometry:{coordinates:[[-35.88,-7.23],[-34.84,-7.12]]}}]};
   else if(url.pathname==='/api/notifications/subscribe')result={enabled:false,publicKey:null};
   else if(/analytics|dashboard/.test(url.pathname))return route.fulfill({status:503,json:{error:'Synthetic empty data'}});
   return route.fulfill({json:result});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Rotas',exact:true}).click();await page.locator('button[title="Adicionar, remover ou reorganizar cidades"]').first().click();
  const name=()=>page.getByPlaceholder('Nome da rota (opcional)');
  await name().fill('Minha rota recuperável');
  await page.getByText('Rascunho salvo neste aparelho',{exact:true}).waitFor();
  const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('rw_planner_draft_v1:')).map(k=>JSON.parse(localStorage.getItem(k))));
  assert.equal(stored.length,1);assert.equal(stored[0].routeId,'test-route');assert.equal(stored[0].stops[1].order_ids[0],'12345');
  await page.reload();await page.getByRole('button',{name:'Recuperar rota',exact:true}).click();
  assert.equal(await name().inputValue(),'Minha rota recuperável');assert.equal(await page.locator('.stop-item-name').count(),2);
  // Persist the final keystroke even when another tab is selected immediately.
  await name().fill('Última edição');await page.getByRole('button',{name:'Rotas',exact:true}).click();
  await page.getByRole('button',{name:'Planejar rota',exact:true}).click();await page.getByRole('button',{name:'Recuperar rota',exact:true}).click();
  assert.equal(await name().inputValue(),'Última edição');
  await page.reload();await page.getByRole('button',{name:'Recuperar rota',exact:true}).click();
  await page.waitForTimeout(500);
  // Simulate a newer same-account tab. Current work must not overwrite it.
  const other=await context.newPage();await other.goto(base);await other.getByRole('button',{name:'Planejar rota',exact:true}).click();
  await other.getByRole('button',{name:'Recuperar rota',exact:true}).click();
  await other.getByPlaceholder('Nome da rota (opcional)').fill('Versão da outra aba');
  await other.getByText('Rascunho salvo neste aparelho',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Recuperar rota',exact:true}).waitFor();
  await name().fill('Não deve sobrescrever');await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('rw_planner_draft_v1:')))).routeName),'Versão da outra aba');
  await other.close();
  await page.getByRole('button',{name:'Recuperar rota',exact:true}).click();
  assert.equal(await name().inputValue(),'Versão da outra aba');
  await page.locator('.btn-save-draft').click();await page.getByRole('button',{name:'Rotas',exact:true}).waitFor();await page.waitForTimeout(500);
  assert.equal(saved,1);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('rw_planner_draft_v1:')).length),0);
  // Company/user scopes cannot see another account's recovery copy.
  await page.getByRole('button',{name:'Rotas',exact:true}).click();await page.locator('button[title="Adicionar, remover ou reorganizar cidades"]').first().click();await name().fill('Privado da empresa A');await page.waitForTimeout(500);
  company='company-b';await page.reload();await page.locator('.planner-panel').waitFor();assert.equal(await page.getByRole('button',{name:'Recuperar rota',exact:true}).count(),0);
  company='company-a';user='user-b';await page.reload();await page.locator('.planner-panel').waitFor();assert.equal(await page.getByRole('button',{name:'Recuperar rota',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: edited route recovery after reload/navigation, last keystroke, order IDs, multi-tab conflict, successful save clears recovery, company and user isolation. Synthetic APIs; no production writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
