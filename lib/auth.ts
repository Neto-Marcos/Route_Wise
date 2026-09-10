import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || "routewise-dev-secret-change-me");
export type Session = { role: "dispatcher" | "driver"; companyId: string; dispatcherId?: string; driverId?: string };
export async function makeSession(value: Session) { return new SignJWT(value).setProtectedHeader({ alg:"HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret()); }
export async function getSession(role: Session["role"] = "dispatcher"): Promise<Session | null> { const token=(await cookies()).get(`rw_${role}_session`)?.value; if(!token)return null; try{return (await jwtVerify(token,secret())).payload as Session}catch{return null} }
export function sessionCookie(token:string,role:Session["role"]){return {name:`rw_${role}_session`,value:token,httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:60*60*12}}
