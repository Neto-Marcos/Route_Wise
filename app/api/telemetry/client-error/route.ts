import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/db";
import { validateTechnicalEvent } from "@/lib/technical-events";
const recent = new Map<string, { since:number; count:number }>();
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({error:"Origem inválida"},{status:403});
  } catch {return NextResponse.json({error:"Origem inválida"},{status:403});}
  const role = request.headers.get("X-RouteWise-Role") === "driver" ? "driver" : "dispatcher";
  const session = await getSession(role);
  if (!session) return NextResponse.json({error:"Sessão necessária"},{status:401});
  const now=Date.now(), key=`${session.companyId}:${session.dispatcherId||session.driverId}`;
  for(const [id,value] of recent) if(now-value.since>60_000) recent.delete(id);
  const limit=recent.get(key)||{since:now,count:0};
  if(limit.count>=5 || recent.size>=2000) return NextResponse.json({error:"Tente depois"},{status:429});
  limit.count++;recent.set(key,limit);
  const reader=request.body?.getReader();let raw="";
  if(!reader) return NextResponse.json({error:"Evento inválido"},{status:400});
  const decoder=new TextDecoder();
  for(;;){const part=await reader.read();if(part.done)break;raw+=decoder.decode(part.value,{stream:true});if(raw.length>2048){await reader.cancel();return NextResponse.json({error:"Evento grande demais"},{status:413});}}
  let event;
  try {event=validateTechnicalEvent(JSON.parse(raw));}catch{}
  if(!event) return NextResponse.json({error:"Evento inválido"},{status:400});
  try {
    await audit(session.role,session.dispatcherId||session.driverId||null,event.kind,"technical_event",null,{...event,companyId:session.companyId});
    console.error(JSON.stringify({event:"technical_event",...event}));
    return new NextResponse(null,{status:204,headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({error:"Registro temporariamente indisponível"},{status:503}); }
}
