import type { PrismaClient } from "@prisma/client";
import { canDeliverEmail, deliverEmail } from "../auth/email";

/**
 * Notifies administrators about toll-data events. Every notice is recorded in the audit log (shown on
 * the admin dashboard); it is also e-mailed to ADMIN users when e-mail delivery is configured.
 * A notification failure never interrupts the update job.
 */
export async function notifyAdmins(prisma: PrismaClient, subject: string, body: string) {
  try {
    await prisma.auditLog.create({ data: { actorId: "toll-monitor", action: "TOLL_DATA_ALERT", entityType: "TollData", entityId: "notification", reason: `${subject}: ${body}` } });
    if (!canDeliverEmail()) return;
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
    await Promise.all(admins.map((admin) => deliverEmail({ to: admin.email, subject: `[LUZON TOLLMAP] ${subject}`, text: `${body}\n\nReview it in the admin Toll Data Management page.` }).catch(() => undefined)));
  } catch {
    // Alerts are best-effort; the source check record still shows the outcome.
  }
}
