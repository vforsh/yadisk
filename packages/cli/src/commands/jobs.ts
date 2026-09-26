import type { Command } from "commander"
import { examples, parseCount } from "../context"
import { formatJob, formatJobList } from "../format"
import { jobExitCode, listJobs, readJob, waitForJob } from "../jobs"
import { emit } from "../output"
import { withTask } from "../progress"

export function registerJobCommands(program: Command): void {
  program
    .command("job")
    .description("Status of a background job (--detach); its result once finished. Exit 9 = still running")
    .argument("<id>", "Job id printed by --detach")
    .option("--wait <seconds>", "Wait up to this long for the job to finish", parseCount("--wait", 0))
    .addHelpText(
      "after",
      examples([
        "yadisk upload ./big.zip /releases/ --skip-if-same --detach --json   # → {job_id, …}",
        "yadisk job 1f2e3d4c --wait 100 --json   # exit 9 while running; the upload's own exit code once done",
      ])
    )
    .action(async (id: string, options) => {
      let report = readJob(id)
      if (report.status === "running" && options.wait) {
        report = await withTask(`Waiting for job ${id}`, () => waitForJob(id, options.wait * 1000), {
          status: () => readJob(id).progress ?? "",
        })
      }
      emit(report, formatJob(report))
      process.exitCode = jobExitCode(report)
    })

  program
    .command("jobs")
    .description("List background jobs, newest first (finished jobs are kept 7 days)")
    .action(() => {
      const jobs = listJobs()
      emit(jobs, formatJobList(jobs))
    })
}
