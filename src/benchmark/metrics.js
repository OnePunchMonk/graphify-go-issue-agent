export function scoreFilePredictions({ predictedFiles, acceptedFiles }) {
  const accepted = new Set(acceptedFiles);
  const predicted = [...new Set(predictedFiles)];
  const hits = predicted.filter((file) => accepted.has(file));
  const precisionAt5 = fraction(hits.filter((file) => predicted.indexOf(file) < 5).length, Math.min(5, predicted.length));
  const recallAt5 = fraction(acceptedFiles.filter((file) => predicted.slice(0, 5).includes(file)).length, accepted.size);
  const recallAt10 = fraction(acceptedFiles.filter((file) => predicted.slice(0, 10).includes(file)).length, accepted.size);
  const firstRank = firstAcceptedRank(predicted, accepted);

  return {
    acceptedFiles,
    predictedFiles: predicted,
    hits,
    hitAt1: firstRank === 1,
    hitAt5: firstRank > 0 && firstRank <= 5,
    recallAt5: Number(recallAt5.toFixed(3)),
    recallAt10: Number(recallAt10.toFixed(3)),
    precisionAt5: Number(precisionAt5.toFixed(3)),
    mrr: firstRank > 0 ? Number((1 / firstRank).toFixed(3)) : 0,
    firstAcceptedRank: firstRank || null
  };
}

export function aggregateScores(results) {
  const completed = results.filter((result) => result.status === "ok");
  return {
    total: results.length,
    completed: completed.length,
    failed: results.length - completed.length,
    avgRecallAt5: average(completed.map((result) => result.metrics.recallAt5)),
    avgRecallAt10: average(completed.map((result) => result.metrics.recallAt10)),
    avgPrecisionAt5: average(completed.map((result) => result.metrics.precisionAt5)),
    avgMrr: average(completed.map((result) => result.metrics.mrr)),
    hitAt1: completed.filter((result) => result.metrics.hitAt1).length,
    hitAt5: completed.filter((result) => result.metrics.hitAt5).length
  };
}

function firstAcceptedRank(predicted, accepted) {
  for (let index = 0; index < predicted.length; index += 1) {
    if (accepted.has(predicted[index])) {
      return index + 1;
    }
  }
  return 0;
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function fraction(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}
