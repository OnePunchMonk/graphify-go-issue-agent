def score_file_predictions(predicted_files: list[str], accepted_files: list[str]) -> dict:
    accepted = set(accepted_files)
    predicted = list(dict.fromkeys(predicted_files))
    hits = [file for file in predicted if file in accepted]
    precision_at_5 = _fraction(len([file for file in hits if predicted.index(file) < 5]), min(5, len(predicted)))
    recall_at_5 = _fraction(len([file for file in accepted_files if file in predicted[:5]]), len(accepted))
    recall_at_10 = _fraction(len([file for file in accepted_files if file in predicted[:10]]), len(accepted))
    first_rank = _first_accepted_rank(predicted, accepted)
    return {
        "acceptedFiles": accepted_files,
        "predictedFiles": predicted,
        "hits": hits,
        "hitAt1": first_rank == 1,
        "hitAt5": first_rank > 0 and first_rank <= 5,
        "recallAt5": round(recall_at_5, 3),
        "recallAt10": round(recall_at_10, 3),
        "precisionAt5": round(precision_at_5, 3),
        "mrr": round(1 / first_rank, 3) if first_rank > 0 else 0,
        "firstAcceptedRank": first_rank or None,
    }


def aggregate_scores(results: list[dict]) -> dict:
    completed = [result for result in results if result.get("status") == "ok"]
    return {
        "total": len(results),
        "completed": len(completed),
        "failed": len(results) - len(completed),
        "avgRecallAt5": _average([result["metrics"]["recallAt5"] for result in completed]),
        "avgRecallAt10": _average([result["metrics"]["recallAt10"] for result in completed]),
        "avgPrecisionAt5": _average([result["metrics"]["precisionAt5"] for result in completed]),
        "avgMrr": _average([result["metrics"]["mrr"] for result in completed]),
        "hitAt1": len([result for result in completed if result["metrics"]["hitAt1"]]),
        "hitAt5": len([result for result in completed if result["metrics"]["hitAt5"]]),
    }


def _first_accepted_rank(predicted: list[str], accepted: set[str]) -> int:
    for index, value in enumerate(predicted, start=1):
        if value in accepted:
            return index
    return 0


def _average(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0


def _fraction(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0
