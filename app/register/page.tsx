import { AuthForm } from "@/components/auth-form";
import { Suspense } from "react";
import { isAuthEnabled } from "@/lib/auth/config";
import { redirect } from "next/navigation";
export default function RegisterPage() { if (!isAuthEnabled()) redirect("/"); return <Suspense><AuthForm mode="register" /></Suspense>; }
