import { StateGraph, Annotation, START, END, Send } from "@langchain/langgraph";
import { route } from "./agents/parent.js";
import { runSpecialist } from "./agents/specialist.js";
import { renderMarkdown, sortFindings, dedupe } from "./render.js";

const concat = { reducer: (a, b) => a.concat(b), default: () => [] };

const State = Annotation.Root({
  project: Annotation(),
  files: Annotation(),                 // [{filename, patch?, content?}]
  routing: Annotation(),               // parent's decision
  findings: Annotation(concat),        // filled by specialists in parallel
  consulted: Annotation(concat),       // docs the specialists read
  notes: Annotation(concat),
  markdown: Annotation(),
});

export function buildGraph(llm) {
  const specialistNode = (agent) => async (s) => {
    try {
      const r = await runSpecialist({ agent, llm, files: s.routing[agent], kinds: s.routing.kinds[agent] });
      const note = r.parsed === false ? [`${agent} agent: the model reply could not be parsed, no findings from it.`] : [];
      return { findings: r.findings, consulted: r.consulted, notes: note };
    } catch (e) {
      return { notes: [`${agent} agent failed: ${e.message}`] };
    }
  };

  return new StateGraph(State)
    // PARENT: decide who to call
    .addNode("parent", async (s) => ({ routing: await route(s.files, llm) }))
    .addNode("cap", specialistNode("cap"))
    .addNode("btp", specialistNode("btp"))
    // MERGE: dedupe + sort + render
    .addNode("merge", (s) => {
      const uniqConsulted = [...new Map(s.consulted.map((c) => [c.url, c])).values()];
      const findings = sortFindings(dedupe(s.findings));
      return {
        findings,
        markdown: renderMarkdown({ project: s.project, findings, consulted: uniqConsulted, routing: s.routing, notes: s.notes }),
      };
    })
    .addEdge(START, "parent")
    // run only the specialists the parent chose, in parallel
    .addConditionalEdges(
      "parent",
      (s) => {
        const calls = ["cap", "btp"].filter((a) => s.routing[a].length).map((a) => new Send(a, s));
        return calls.length ? calls : "merge";
      },
      ["cap", "btp", "merge"],
    )
    .addEdge("cap", "merge")
    .addEdge("btp", "merge")
    .addEdge("merge", END)
    .compile();
}
