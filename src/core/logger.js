export function createLogger({ verbose = false } = {}) {
  return {
    info(message) {
      console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    debug(message) {
      if (verbose) {
        console.error(`[debug] ${message}`);
      }
    }
  };
}
