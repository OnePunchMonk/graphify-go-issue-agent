from __future__ import annotations

def compute_confidence(review: dict | None, test_result: dict | None, proposal: dict | None, plan: dict | None) -> dict:
    confidence = 0.0
    evidence = []

    if (proposal or {}).get("diff", "").strip() or (proposal or {}).get("workingDiff", "").strip():
        confidence += 0.2
        evidence.append("diff generated")

    if ((plan or {}).get("context") or {}).get("files"):
        confidence += 0.1
        evidence.append("graph-ranked context retrieved")

    results = (test_result or {}).get("results") or []
    if results:
        passed = len([result for result in results if result.get("ok")])
        ratio = passed / len(results)
        confidence += 0.35 * ratio
        evidence.append(f"{passed}/{len(results)} validation commands passed")

    if review and review.get("score") is not None:
        score = max(0.0, min(1.0, float(review["score"])))
        confidence += score * 0.35
        evidence.append(f"review score {review['score']}")

    blockers = len([finding for finding in (review or {}).get("findings", []) if finding.get("severity") == "blocker"])
    if blockers:
        confidence = min(confidence, 0.49)
        evidence.append(f"{blockers} blocker finding(s)")

    confidence = round(confidence, 3)
    return {"confidence": confidence, "evidence": evidence, "approved": confidence >= 0.8 and blockers == 0}
