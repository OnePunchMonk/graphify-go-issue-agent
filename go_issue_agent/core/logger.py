def create_logger(verbose: bool = False):
    class Logger:
        def info(self, message: str) -> None:
            print(message)

        def warn(self, message: str) -> None:
            print(message)

        def debug(self, message: str) -> None:
            if verbose:
                print(f"[debug] {message}")

    return Logger()
