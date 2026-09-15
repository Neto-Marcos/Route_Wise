import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const getSecretKey = () => {
  const envSecret = process.env.SESSION_SECRET;
  if (!envSecret && process.env.NODE_ENV === "production") {
    console.warn("CRITICAL SECURITY WARNING: SESSION_SECRET is not set in production. Using fallback secret.");
    throw new Error("FATAL: SESSION_SECRET must be set in production.");
  }
  return new TextEncoder().encode(envSecret || "routewise-dev-secret-change-me");
};
const secret = () => getSecretKey();
export type UserRole = "superadmin" | "admin" | "route_creator" | "office" | "driver";
export type Session = {
  role: "dispatcher" | "driver";
  userRole?: UserRole;
  companyId: string;
  dispatcherId?: string;
  driverId?: string;
};
export async function makeSession(value: Session) { return new SignJWT(value).setProtectedHeader({ alg:"HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret()); }
export async function getSession(role: Session["role"] = "dispatcher"): Promise<Session | null> { const token=(await cookies()).get(`rw_${role}_session`)?.value; if(!token)return null; try{return (await jwtVerify(token,secret())).payload as Session}catch{return null} }
export function sessionCookie(token:string,role:Session["role"]){return {name:`rw_${role}_session`,value:token,httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:60*60*12}}
export function clearSessionCookie(role: Session["role"]) { return { name: `rw_${role}_session`, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 }; }
