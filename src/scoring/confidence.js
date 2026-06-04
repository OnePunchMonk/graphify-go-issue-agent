export function computeConfidence({ review, testResult, proposal, plan }) {
  let confidence = 0;
  const evidence = [];

  if (proposal?.diff?.trim() || proposal?.workingDiff?.trim()) {
    confidence += 0.2;
    evidence.push("diff generated");
  }

  if (plan?.context?.files?.length) {
    confidence += 0.1;
    evidence.push("graph-ranked context retrieved");
  }

  if (testResult?.results?.length) {
    const passed = testResult.results.filter((result) => result.ok).length;
    const ratio = passed / testResult.results.length;
    confidence += 0.35 * ratio;
    evidence.push(`${passed}/${testResult.results.length} validation commands passed`);
  }

  if (review?.score != null) {
    confidence += Math.max(0, Math.min(1, Number(review.score))) * 0.35;
    evidence.push(`review score ${review.score}`);
  }

  const blockers = review?.findings?.filter((finding) => finding.severity === "blocker").length ?? 0;
  if (blockers) {
    confidence = Math.min(confidence, 0.49);
    evidence.push(`${blockers} blocker finding(s)`);
  }

  return {
    confidence: Number(confidence.toFixed(3)),
    evidence,
    approved: confidence >= 0.8 && !blockers
  };
}
