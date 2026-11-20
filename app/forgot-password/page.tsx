import { AuthForm } from "@/components/auth-form";
import { Suspense } from "react";
import { isAuthEnabled } from "@/lib/auth/config";
import { redirect } from "next/navigation";
export default function ForgotPasswordPage() { if (!isAuthEnabled()) redirect("/"); return <Suspense><AuthForm mode="forgot" /></Suspense>; }
