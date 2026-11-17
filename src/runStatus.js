// How a finished run is described everywhere in the console.
// In QC a run can finish with failing test cases and that is a normal result - the run itself did its job.
//   "Completed"  = the run went to the end and executed test cases (some may have failed)
//   "Run error"  = nothing could be executed (crash, no scenarios, timeout)
// `stats` is { tests, passes, failures } of the run.
export function runBadge(stats) {
  if (!stats) return null;
  const tests = Number(stats.tests) || 0;
  const passes = Number(stats.passes) || 0;
  const failures = Number(stats.failures) || 0;
  if (tests <= 0) return { label: "Run error", tone: "danger", error: true, detail: "No test case could be executed" };
  return { label: "Completed", tone: failures ? "accent" : "success", error: false, detail: `${passes} passed · ${failures} failed` };
}

// Adds up the stats of several screens (module runs).
export function sumStats(list) {
  const out = { tests: 0, passes: 0, failures: 0 };
  let any = false;
  for (const s of list || []) {
    if (!s) continue;
    any = true;
    out.tests += Number(s.tests) || 0;
    out.passes += Number(s.passes) || 0;
    out.failures += Number(s.failures) || 0;
  }
  return any ? out : null;
}