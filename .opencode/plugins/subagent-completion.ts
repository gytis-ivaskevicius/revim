import type { Plugin } from "@opencode-ai/plugin"

export const SubagentCompletion: Plugin = async ({ client, $, directory }) => {

  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "task") return

      const agents = await client.app.agents()
      const hooks = (agents.data ?? []).reduce<Record<string, string>>((acc, it) => {
        const script = (it.options as any)?.on_complete
        return script ? { ...acc, [it.name]: script } : acc
      }, {})

      const command = hooks[input.args.subagent_type]
      if (!command) return

      try {
        const clean = output.output
          .replace(/^task_id:.*\n?/, "")
          .replace(/<task_result>\n?/g, "")
          .replace(/<\/task_result>\n?/g, "")
          .trim()
        output.output = await $`${{ raw: command }} < ${Buffer.from(clean)}`.cwd(directory).text()
      } catch (err: unknown) {
        const exitCode = err && typeof err === "object" && "exitCode" in err ? (err as any).exitCode : "?"
        const stderr = err && typeof err === "object" && "stderr" in err ? (err as any).stderr?.toString().trim() : ""
        const detail = stderr ? `: ${stderr}` : ""
        output.output = `[subagent-completion] on_complete hook "${command}" failed (exit ${exitCode})${detail}\n\n${output.output}`
      }
    }
  }
}
