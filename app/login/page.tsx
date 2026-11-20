import { AuthForm } from "@/components/auth-form";
import { Suspense } from "react";
import { isAuthEnabled } from "@/lib/auth/config";
import { redirect } from "next/navigation";
export default function LoginPage() { if (!isAuthEnabled()) redirect("/"); return <Suspense><AuthForm mode="login" /></Suspense>; }
