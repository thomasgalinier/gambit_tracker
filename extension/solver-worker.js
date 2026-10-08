// Runs the WASM postflop solver off the main thread. One worker per analysis: the page terminates it
// when done or cancelled, which also releases the (up to ~500 MB) solver memory.
// Message in: { jobs, chain } — with chain, each street starts from the ranges that reached it in the previous solve.
importScripts('engine.js', 'solver/gambit_solver.js');
const ready = wasm_bindgen({ module_or_path: 'solver/gambit_solver_bg.wasm' });
const tick = () => new Promise(r => setTimeout(r));
const NEXT = { flop: 'turn', turn: 'river' };

onmessage = async ({ data: { jobs, chain } }) => {
  try {
    await ready;
    let prev = null;
    for (let job of jobs) {
      if (chain && prev && NEXT[prev.street] === job.street) job = chainJob(job, prev.result.next);
      const result = await runGtoJob(job, wasm_bindgen.Solver, async (progress, exploitability) => {
        postMessage({ id: job.id, street: job.street, progress, exploitability });
        await tick();
      });
      result.chained = !!job.chained;
      result.precise = !!job.precise;
      result.approx = job.approx;
      prev = { street: job.street, result };
      postMessage({ id: job.id, street: job.street, result });
    }
    postMessage({ done: true });
  } catch (e) {
    postMessage({ error: String(e?.message || e) });
  }
};
