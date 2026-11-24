/**
 * Runs the toll-rate monitor once. Schedule it (or call POST /api/internal/toll-monitor) daily and weekly.
 *   npx tsx --env-file=.env scripts/run-toll-monitor.ts [daily|weekly|manual]
 */
import { PrismaClient } from "@prisma/client";
import { runTollMonitor, type MonitorTrigger } from "../lib/toll-data/monitor";

const trigger = (process.argv[2] ?? "daily") as MonitorTrigger;
if (!["daily", "weekly", "manual"].includes(trigger)) { console.error("Trigger must be daily, weekly, or manual."); process.exit(2); }
const prisma = new PrismaClient();
runTollMonitor(prisma, { trigger })
  .then((result) => { console.log(JSON.stringify(result, null, 1)); })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
