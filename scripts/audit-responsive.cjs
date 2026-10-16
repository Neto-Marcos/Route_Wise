// Local responsive UI regression audit. Uses synthetic data; never contacts production APIs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('.tools/responsive-results');
fs.mkdirSync(output, { recursive: true });
const phase = process.argv[2] || 'audit';
const baseUrl = process.env.RESPONSIVE_BASE_URL || 'http://127.0.0.1:3135';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error('Use somente um servidor local: as APIs serão simuladas.');
const driver = { id: 'test-driver', name: 'Motorista de demonstração com nome completo', phone: '00000000000', active: true };
const vehicle = { id: 'test-vehicle', name: 'Caminhão de demonstração', plate: 'ABC1D23', capacity_m3: 95, active: true };
const routeData = { id:'test-route', public_id:'test-public', name:'Rota de demonstração Campina Grande e região', route_date:new Date().toISOString().slice(0,10), status:'assigned', driver_id:driver.id,driver_name:driver.name, vehicle_name:vehicle.name,plate:vehicle.plate,deliveries:2,delivered:0,estimated_km:125,stops:[] };
routeData.route_date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
routeData.stops=[{id:'origin',position:0,name:'Base da operação',address:'Campina Grande / PB',lat:-7.23,lng:-35.88,is_origin:true,status:'pending'},{id:'delivery',position:1,name:'Cliente de demonstração com nome completo',address:'Endereço de demonstração para verificar a quebra de texto em telas pequenas',lat:-7.2,lng:-35.9,is_origin:false,status:'pending',boxes:10,volume_m3:12,order_ids:['12345']}];
const bucket = { orders: 2, value: 1234567.89 };
const order={city:'João Pessoa',uf:'PB',client:'Cliente de demonstração',orderId:'12345',volumeM3:22,weightKg:1200,boxes:10,totalValue:50000,freightType:'CIF',lat:-7.12,lng:-34.84,extra:{'total item':'50000'}};
const suggestion={index:1,name:'Rota de demonstração',stops:[{position:1,city:order.city,clientName:order.client,address:order.city,lat:order.lat,lng:order.lng,orders:[order],volumeM3:22,weightKg:1200,boxes:10,loadingSequence:1}],totalVolumeM3:22,totalWeightKg:1200,totalBoxes:10,totalOrders:1,occupancyPct:23,cityPath:[order.city],estimatedKm:125,state:'PB'};
const commercial = { filename:'Carteira de demonstração.xlsx', period:'Outubro de 2026',selectedMonth:'2026-10',availableMonths:['2026-10'],total:{...bucket,itemLines:5,requestedQty:12,availableQty:10},freight:{CIF:bucket,FOB:bucket,OUTRO:bucket},invoiced:bucket,pending:bucket,ready:bucket,blocked:bucket,stock:{inStockLines:3,totalLines:5,coveragePct:60},topBlockedProducts:[],invoicedNotesSummary:{count:1,totalValue:1234567.89,totalWeightKg:120},invoicedNotes:[{invoiceNumber:'0000123',orderId:'12345',issueDate:'2026-10-15',client:'Cliente demonstração',city:'Campina Grande',uf:'PB',freightType:'CIF',totalValue:1234567.89,weightKg:120,itemsCount:2}] };
(async()=>{
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const findings=[];
  async function inspect(page, scenario, width, theme){
    await page.locator('body').waitFor();
    await page.waitForTimeout(300);
    const result=await page.evaluate(()=>{
      const vw=document.documentElement.clientWidth;
      const elements=[...document.querySelectorAll('body *')].filter(el=>{
        const r=el.getBoundingClientRect();if(!r.width||!r.height||r.right<=vw+1&&r.left>=-1)return false;
        if(el.closest('.leaflet-pane, .leaflet-control-container'))return false;
        for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflowX))return false;}
        return true;
      }).slice(0,8).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,65),right:Math.round(el.getBoundingClientRect().right)}));
      return {viewport:vw,scroll:document.documentElement.scrollWidth,overflow:elements,home:document.querySelector('.access-panel')?.getBoundingClientRect().width};
    });
    findings.push({scenario,width,theme,...result});
    fs.writeFileSync(path.join(output,`${phase}.json`),JSON.stringify(findings,null,2));
    console.log(`${scenario} ${width} ${theme}: viewport=${result.viewport}, scroll=${result.scroll}`);
    if(result.scroll>width+1||scenario==='home'||scenario==='operations'||width===390)await page.screenshot({path:path.join(output,`${phase}-${scenario}-${width}-${theme}.png`),fullPage:true});
  }
  for(const width of (process.env.RESPONSIVE_WIDTHS||'320,390,768,1024,1920').split(',').map(Number)){
    const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Sao_Paulo',serviceWorkers:'block',isMobile:width<800,hasTouch:width<=1024});
    let authenticated=false;
    await context.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      let data=[];
      if(p==='/api/session/me')data=authenticated?{authenticated:true,role:'dispatcher',userRole:'admin',companyId:'test-company',companyName:'Empresa demonstração',companyCode:'281'}:{authenticated:false};
      else if(p==='/api/routes')data=[routeData];else if(p.startsWith('/api/routes/'))data=routeData;
      else if(p==='/api/drivers')data=[driver];else if(p==='/api/vehicles')data=[vehicle];
      else if(p==='/api/dispatchers')data=[];
      else if(p==='/api/analytics/commercial')data=commercial;
      else if(p==='/api/notifications/subscribe')data={enabled:false,publicKey:null};
      else if(p==='/api/routerizador/workbook')data={workbook:{filename:'Demonstração.xlsx',updatedAt:new Date().toISOString(),rows:[order]}};
      else if(p==='/api/routerizador/generate')data={routes:[suggestion],unassigned:[],stats:{totalOrders:1,totalRoutes:1,totalVolumeM3:22,avgOccupancyPct:23}};
      else if(p==='/api/analytics/summary')return route.fulfill({status:503,json:{error:'Sem dados analíticos na demonstração'}});
      await route.fulfill({json:data});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror',e=>findings.push({scenario:'runtime-error',width,error:e.message}));
    await page.goto(baseUrl,{waitUntil:'networkidle',timeout:120000});
    await inspect(page,'home',width,'light');
    await page.getByRole('button',{name:/Administrador Acesso/}).click();await inspect(page,'login',width,'light');
    authenticated=true;await page.reload({waitUntil:'networkidle'});
    await page.locator('.dashboard').waitFor();
    await inspect(page,'overview',width,'light');
    // All pages use the real client navigation and isolated in-memory API fixtures.
    for(const [tab,name] of [['operations','Central operacional'],['ssw','Rastreio SSW'],['routes','Rotas'],['people','Motoristas'],['vehicles','Veículos'],['roteirizador','Roteirizador'],['planner','Planejar rota']]){
      const nav=page.locator('.sidebar-nav-items button').filter({hasText:name});
      if(await nav.count()===1){await nav.click();await inspect(page,tab,width,'light');}
      if(tab==='operations'){
        await page.getByRole('button',{name:'Aprovar pagamentos',exact:true}).click();await inspect(page,'payment-review',width,'light');await page.getByRole('button',{name:'Fechar pagamentos',exact:true}).click();
        const input=page.getByPlaceholder('Mensagem para toda a operação');
        const box=await input.boundingBox();if(!box||box.width<100)throw new Error(`Campo de mensagem inutilizável em ${width}px`);
      }
      if(tab==='routes'){
        await page.getByRole('button',{name:'Detalhes',exact:true}).first().click();await page.locator('.detail-modal-shell').waitFor();await inspect(page,'route-detail',width,'light');await page.locator('.detail-modal-shell button[title="Fechar"]').click();
      }
      if(tab==='roteirizador'){
        await page.getByRole('button',{name:'Usar carteira salva',exact:true}).click();await inspect(page,'routing-config',width,'light');
        await page.getByRole('button',{name:'Aplicar configuração',exact:true}).click();await page.getByRole('button',{name:'Dedicada 1',exact:true}).waitFor();await inspect(page,'routing-results',width,'light');
        await page.getByRole('button',{name:'Dedicada 1',exact:true}).click();await inspect(page,'routing-detail',width,'light');
      }
    }
    await page.evaluate(()=>{sessionStorage.setItem('rw_dispatcher_tab','overview');localStorage.setItem('rw_theme','dark')});
    await page.reload({waitUntil:'networkidle'});await page.locator('.dashboard').waitFor();
    await page.getByRole('button',{name:/Métricas Comerciais/}).click();await inspect(page,'commercial',width,'dark');
    await page.getByRole('button',{name:/Notas Faturadas|Notas Fiscais|Notas do Mês/i}).first().click();await inspect(page,'invoices',width,'dark');
    if(width<=768){
      await page.evaluate(()=>{localStorage.setItem('rw_sidebar_collapsed','true')});await page.reload({waitUntil:'networkidle'});await page.locator('.dashboard').waitFor();
      await inspect(page,'collapsed-menu',width,'dark');
      const navLabel=await page.locator('.sidebar-nav-items button span').first().isVisible();if(!navLabel)throw new Error(`Menu perdeu texto em ${width}px`);
      authenticated=false;await page.evaluate(()=>sessionStorage.clear());await page.reload({waitUntil:'networkidle'});
      await page.getByRole('button',{name:/^Motorista Acessar/}).click();await page.getByPlaceholder('Ex.: MINHA-EMPRESA').fill('TESTE');
      await page.locator('.profile-item').first().click();await inspect(page,'driver-pin',width,'dark');
      await page.locator('.driver-pin-input').fill('1234');await page.getByRole('button',{name:'Ver minhas rotas',exact:true}).click();await page.locator('.driver-shell').waitFor();await inspect(page,'driver-home',width,'dark');
      await page.getByRole('button',{name:'Meu perfil e configurações'}).click();await page.getByRole('button',{name:'Solicitar pagamento / diária'}).click();await page.locator('.payment-dialog').waitFor();await inspect(page,'driver-payment',width,'dark');
      await page.getByRole('button',{name:'Fechar pagamentos',exact:true}).click();
      routeData.status='active';await page.locator('.driver-routes > button').first().click();await page.locator('.active-route').waitFor();await inspect(page,'driver-route',width,'dark');
      await page.getByRole('button',{name:'Entrega feita',exact:true}).click();await page.locator('.modal').waitFor();await inspect(page,'driver-proof',width,'dark');routeData.status='assigned';
    }
    await context.close();
  }
  await browser.close();fs.writeFileSync(path.join(output,`${phase}.json`),JSON.stringify(findings,null,2));
  const failures=findings.filter(f=>f.scroll>f.width+1||f.scenario==='runtime-error');
  console.log(JSON.stringify({checks:findings.length,failures},null,2));
  if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
