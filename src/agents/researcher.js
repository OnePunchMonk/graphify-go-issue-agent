export class ResearchAgent {
  constructor({ model, logger } = {}) {
    this.model = model;
    this.logger = logger;
  }

  async run(state) {
    const localSignals = collectLocalSignals(state);
    if (this.model && state.intent.needsExternalResearch) {
      return await this.fromModel(state, localSignals);
    }
    return {
      authorities: localSignals.authorities,
      projectConventions: localSignals.projectConventions,
      notes: state.intent.needsExternalResearch
        ? ["External research is requested, but offline mode is active; verify standards before final PR submission."]
        : ["Issue appears repository-local; prefer local tests and existing implementation patterns."]
    };
  }

  async fromModel(state, localSignals) {
    const prompt = `Research only the minimum outside context needed for this Go issue.

Repository: ${state.repoFullName}
Issue: #${state.issue.number} ${state.issue.title}
Intent:
${JSON.stringify(state.intent, null, 2)}
Local signals:
${JSON.stringify(localSignals, null, 2)}

Return strict JSON:
{
  "authorities": [{"title": "source or standard", "url": "url if known", "relevance": "why it matters"}],
  "projectConventions": ["repo-local convention"],
  "notes": ["short actionable note"]
}

Do not invent external facts. If you are not sure, say verification is needed.`;

    return await this.model.generateJson({
      system: "You are a software standards and repository-convention researcher. Keep context minimal.",
      prompt,
      temperature: 0.1,
      googleSearch: process.env.GEMINI_ENABLE_SEARCH === "1"
    });
  }
}

function collectLocalSignals(state) {
  const docs = state.graph.nodes
    ?.filter((node) => node.type === "doc-heading")
    .map((node) => `${node.path}: ${node.name}`)
    .slice(0, 20) ?? [];
  const authorities = [];
  const issueText = `${state.issue.title}\n${state.issue.body}`;
  for (const match of issueText.matchAll(/https?:\/\/\S+/g)) {
    authorities.push({
      title: "Issue-linked source",
      url: match[0].replace(/[),.]+$/, ""),
      relevance: "Linked from the issue text"
    });
  }
  for (const match of issueText.matchAll(/\bRFC\s?(\d+)\b/gi)) {
    authorities.push({
      title: `RFC ${match[1]}`,
      url: `https://www.rfc-editor.org/rfc/rfc${match[1]}`,
      relevance: "Referenced by the issue text"
    });
  }
  return {
    authorities,
    projectConventions: docs
  };
}
