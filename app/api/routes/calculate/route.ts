import { NextResponse } from "next/server";
import { routeRequestSchema } from "@/lib/validation";
export async function POST(request:Request){try{const input=routeRequestSchema.parse(await request.json());if(!process.env.MAPBOX_ACCESS_TOKEN)return NextResponse.json({message:"Routing is not configured. Add MAPBOX_ACCESS_TOKEN on the server.",input},{status:503});return NextResponse.json({message:"Routing provider integration is ready for configured Mapbox credentials."},{status:501});}catch{return NextResponse.json({message:"Invalid route request."},{status:400});}}
